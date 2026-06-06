package com.aimindmesh.wakeword

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Background Service for Wake Word Detection.
 * Keeps the microphone active and runs inference while the app is in the background.
 */
class BackgroundService : Service() {

    companion object {
        const val TAG = "WakeWordService"
        const val CHANNEL_ID = "WakeWordServiceChannel"
        const val ACTION_START_LISTENING = "START_LISTENING"
        const val ACTION_STOP_LISTENING = "STOP_LISTENING"
        const val ACTION_UPDATE_CONFIG = "UPDATE_CONFIG"
        const val ACTION_START_TRAINING = "START_TRAINING"
        const val ACTION_STOP_TRAINING = "STOP_TRAINING"
        const val ACTION_SAVE_PROFILE = "SAVE_PROFILE"
        const val ACTION_CLEAR_TRAINING = "CLEAR_TRAINING"
        
        // Broadcast actions
        const val BROADCAST_WAKE_WORD_DETECTED = "com.aimindmesh.wakeword.DETECTED"
        const val EXTRA_WAKE_WORD = "wakeWord"
        const val EXTRA_CONFIDENCE = "confidence"
        
        var isRunning = false
        private var instance: BackgroundService? = null

        fun getTrainingAudio(): String? {
             return instance?.wakeWordDetector?.getTrainingAudio()
        }
        
        fun ingestTrainingSample(base64Pcm: String): Boolean {
            return instance?.wakeWordDetector?.ingestTrainingSample(base64Pcm) ?: false
        }
        
        fun getDebugDiagnostics(): WakeWordDetector.DebugDiagnosticResult? {
            return instance?.wakeWordDetector?.getDebugDiagnostics()
        }
    }

    private var wakeWordDetector: WakeWordDetector? = null
    private var audioProcessor: AudioProcessor? = null
    private var wakeLock: PowerManager.WakeLock? = null
    
    // Config
    private var modelName: String? = null
    private var threshold: Float = 0.5f
    private var bufferSize: Int = 20
    private var cooldownMs: Long = 2000
    private var consecutiveFrames: Int = 8

    private val serviceScope = CoroutineScope(Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        
        // Acquire WakeLock to keep CPU running
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIMindMesh:WakeWordLock")
        wakeLock?.acquire(10*60*1000L /* 10 minutes timeout */)
        
        Log.i(TAG, "BackgroundService created")
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) return START_NOT_STICKY

        when (intent.action) {
            ACTION_START_LISTENING -> {
                handleStartListening(intent)
            }
            ACTION_STOP_LISTENING -> {
                stopSelf()
            }
            ACTION_UPDATE_CONFIG -> {
                handleUpdateConfig(intent)
            }
            ACTION_START_TRAINING -> {
                startTrainingSession()
            }
            ACTION_STOP_TRAINING -> {
                wakeWordDetector?.stopTraining()
                stopSelf()
            }
            ACTION_SAVE_PROFILE -> {
                val name = intent.getStringExtra("name")
                if (wakeWordDetector == null) {
                    Log.w(TAG, "WakeWordDetector not initialized for saving profile")
                    // Try to initialize? Probably too late if samples weren't collected. 
                    // But if we are in this state, previous steps might have failed or service was killed.
                }
                if (name != null) {
                    val success = wakeWordDetector?.saveCustomWakeWord(name) ?: false
                    Log.i(TAG, "Save profile $name result: $success")
                }
            }
            ACTION_CLEAR_TRAINING -> {
                wakeWordDetector?.clearTrainingData()
            }
        }
        
        isRunning = true
        return START_STICKY
    }

    private fun handleStartListening(intent: Intent) {
        val newModelName = intent.getStringExtra("modelName")
        threshold = intent.getFloatExtra("threshold", 0.5f)
        bufferSize = intent.getIntExtra("bufferSize", 20)
        cooldownMs = intent.getLongExtra("cooldownMs", 2000)
        consecutiveFrames = intent.getIntExtra("consecutiveFrames", 8)

        // Show foreground notification
        startForeground(1, createNotification("In ascolto...", "AMM Mobile è pronto"))

        if (newModelName != null) {
            modelName = newModelName
        }

        if (modelName == null) {
            Log.e(TAG, "No model name provided")
            return
        }

        startDetection()
    }
    
    private fun handleUpdateConfig(intent: Intent) {
        threshold = intent.getFloatExtra("threshold", threshold)
        val newCooldown = intent.getLongExtra("cooldownMs", -1)
        if (newCooldown != -1L) cooldownMs = newCooldown
        
        val newBufferSize = intent.getIntExtra("bufferSize", -1)
        if (newBufferSize != -1) bufferSize = newBufferSize

        val newConsecutiveFrames = intent.getIntExtra("consecutiveFrames", -1)
        if (newConsecutiveFrames != -1) consecutiveFrames = newConsecutiveFrames

        wakeWordDetector?.setThreshold(threshold)
        wakeWordDetector?.setCooldownMs(cooldownMs)
        wakeWordDetector?.setBufferSize(bufferSize)
        wakeWordDetector?.setMinConsecutiveFrames(consecutiveFrames)
        
        Log.i(TAG, "Config updated: T=$threshold, C=$cooldownMs, B=$bufferSize, CF=$consecutiveFrames")
    }

    private fun startDetection() {
        if (audioProcessor?.isRecording == true) {
            Log.i(TAG, "Already recording, restarting with new config if needed")
             // Here we could optimize, but for safety lets stop and start if models changed
             stopDetection()
        }

        val currentModel = modelName ?: return
        
        serviceScope.launch {
            try {
                if (wakeWordDetector == null) {
                    wakeWordDetector = WakeWordDetector(this@BackgroundService)
                }
                
                // Configure detector
                wakeWordDetector?.apply {
                    setThreshold(this@BackgroundService.threshold)
                    setCooldownMs(this@BackgroundService.cooldownMs)
                    setBufferSize(this@BackgroundService.bufferSize)
                }

                // Load models
                val loaded = wakeWordDetector?.loadModels(currentModel)
                if (loaded != true) {
                    Log.e(TAG, "Failed to load models in background service")
                    stopSelf()
                    return@launch
                }

                // Start Audio
                audioProcessor = AudioProcessor(
                    onAudioChunk = { rawAudio, amplifiedAudio ->
                        processAudio(rawAudio, amplifiedAudio)
                    },
                    onAudioLevel = { 
                        // We could broadcast levels if needed, but maybe too spammy for background
                    },
                    onError = { error ->
                        Log.e(TAG, "Audio error: $error")
                        stopSelf()
                    }
                )
                
                audioProcessor?.start()
                Log.i(TAG, "Background detection started")
                
            } catch (e: Exception) {
                Log.e(TAG, "Error starting detection", e)
                stopSelf()
            }
        }
    }

    private fun processAudio(rawAudio: FloatArray, amplifiedAudio: FloatArray) {
        val result = wakeWordDetector?.processAudio(rawAudio, amplifiedAudio)
        if (result?.detected == true) {
            Log.i(TAG, "BACKGROUND WAKE WORD DETECTED: ${result.modelName}")
            onWakeWordDetected(result.modelName, result.confidence)
        }
    }

    private fun onWakeWordDetected(wakeWord: String, confidence: Float) {
        // 1. Send broadcast to app (if running)
        val broadcastIntent = Intent(BROADCAST_WAKE_WORD_DETECTED).apply {
            putExtra(EXTRA_WAKE_WORD, wakeWord)
            putExtra(EXTRA_CONFIDENCE, confidence)
            setPackage(packageName)
        }
        sendBroadcast(broadcastIntent)
        
        // 2. Launch Main Activity if not on top
        // We use a full screen intent or just a start activity intent
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("wakeWordDetected", true)
                putExtra("wakeWord", wakeWord)
            }
            if (launchIntent != null) {
                startActivity(launchIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch activity", e)
        }
    }

    private fun stopDetection() {
        audioProcessor?.stop()
        audioProcessor = null
        wakeWordDetector?.release()
        wakeWordDetector = null
    }

    private fun stopService() {
        stopDetection()
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing wake lock", e)
        }
        stopForeground(true)
        isRunning = false
    }

    override fun onDestroy() {
        super.onDestroy()
        stopService()
        Log.i(TAG, "BackgroundService destroyed")
        if (instance == this) instance = null
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Voice Activation Service",
                NotificationManager.IMPORTANCE_LOW
            )
            serviceChannel.description = "Listening for wake word"
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    private fun createNotification(title: String, body: String): Notification {
        val notificationIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE
        )
        
        // Add a "Stop" action
        val stopIntent = Intent(this, BackgroundService::class.java).apply {
            action = ACTION_STOP_LISTENING
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun startTrainingSession() {
        if (wakeWordDetector != null && audioProcessor?.isRecording == true) {
            wakeWordDetector?.startTraining()
            return
        }

        serviceScope.launch {
            try {
                if (wakeWordDetector == null) {
                    wakeWordDetector = WakeWordDetector(this@BackgroundService)
                    // Load base models only for training
                    if (!wakeWordDetector!!.loadModels("TRAINING_MODE")) {
                        Log.e(TAG, "Failed to load models for training")
                        return@launch
                    }
                }

                if (audioProcessor == null || audioProcessor?.isRecording != true) {
                    audioProcessor = AudioProcessor(
                        onAudioChunk = { rawAudio, amplifiedAudio ->
                            processAudio(rawAudio, amplifiedAudio)
                        },
                        onAudioLevel = {},
                        onError = { error -> Log.e(TAG, "Audio error in training: $error") }
                    )
                    audioProcessor?.start()
                }

                wakeWordDetector?.startTraining()
                Log.i(TAG, "Training session started (lazy init)")
                
                // Ensure we have a notification so service doesn't get killed
                startForeground(1, createNotification("Training...", "Recording wake word samples"))

            } catch (e: Exception) {
                Log.e(TAG, "Failed to start training session", e)
            }
        }
    }
}
