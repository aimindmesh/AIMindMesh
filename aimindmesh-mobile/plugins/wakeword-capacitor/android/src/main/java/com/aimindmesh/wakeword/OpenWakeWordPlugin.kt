package com.aimindmesh.wakeword

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.PermissionState
import java.io.File

/**
 * Capacitor plugin for OpenWakeWord wake word detection.
 * Delegates actual detection to BackgroundService for persistence.
 */
@CapacitorPlugin(
    name = "OpenWakeWord",
    permissions = [
        Permission(
            alias = "microphone",
            strings = [Manifest.permission.RECORD_AUDIO]
        ),
        Permission(
            alias = "notifications",
            strings = [Manifest.permission.POST_NOTIFICATIONS]
        )
    ]
)
class OpenWakeWordPlugin : Plugin() {
    
    companion object {
        private const val TAG = "OpenWakeWord"
    }
    
    // Configurable parameters
    private var threshold = 0.5f
    private var cooldownMs = 2000L
    private var bufferSize = 20
    private var debugMode = false
    private var consecutiveFrames = 8  // Required consecutive high-confidence frames for custom wake words
    
    override fun load() {
        super.load()
        Log.i(TAG, "OpenWakeWord plugin loaded")
    }
    
    @PluginMethod
    fun loadModel(call: PluginCall) {
        // Just validation here, actual load happens in Service
        val modelName = call.getString("modelName")
        if (modelName.isNullOrEmpty()) {
            call.reject("modelName is required")
            return
        }
        
        threshold = call.getFloat("threshold", 0.5f) ?: 0.5f
        cooldownMs = (call.getInt("cooldownMs", 2000) ?: 2000).toLong()
        bufferSize = call.getInt("bufferSize", 20) ?: 20
        debugMode = call.getBoolean("debug", false) ?: false
        consecutiveFrames = call.getInt("consecutiveFrames", 8) ?: 8
        
        // We assume success if file exists, service will handle the rest
        val exists: Boolean
        
        if (modelName.startsWith("custom:")) {
            val cleanName = modelName.substring(7)
            val customDir = File(context.filesDir, "custom_wakewords")
            val modelFile = File(customDir, "$cleanName.json")
            exists = modelFile.exists()
        } else {
            val modelsDir = File(context.filesDir, "wakeword-models")
            val modelFile = File(modelsDir, modelName)
            exists = modelFile.exists()
        }
        
        if (exists) { 
             call.resolve(JSObject().apply {
                put("loaded", true)
                put("modelName", modelName)
                put("inferenceTimeMs", 0) // Placeholder
            })
        } else {
             call.reject("Model file not found: $modelName")
        }
    }
    
    @PluginMethod
    fun unloadModel(call: PluginCall) {
        stopListeningInternal()
        call.resolve()
    }
    
    @PluginMethod
    fun isModelLoaded(call: PluginCall) {
        // Optimistic check
        call.resolve(JSObject().apply {
            put("loaded", true) 
        })
    }
    
    @PluginMethod
    fun startListening(call: PluginCall) {
        // Check microphone permission
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }
        
        // Check notification permission (for foreground service)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
             if (getPermissionState("notifications") != PermissionState.GRANTED) {
                 requestPermissionForAlias("notifications", call, "notificationPermissionCallback")
                 return
             }
        }
        
        startListeningInternal(call)
    }
    
    @PermissionCallback
    private fun microphonePermissionCallback(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startListeningInternal(call)
        } else {
            call.reject("Microphone permission denied")
        }
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) {
        // We can proceed even without notifications potentially, but better to have it
         if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startListeningInternal(call)
         } else {
             startListeningInternal(call) // Try anyway?
         }
    }
    
    private fun startListeningInternal(call: PluginCall) {
        // Start Background Service
        try {
            val serviceIntent = Intent(context, BackgroundService::class.java).apply {
                action = BackgroundService.ACTION_START_LISTENING
                putExtra("modelName", call.getString("modelName") ?: "hey_jarvis_v0.1.tflite") // Need to pass this or cache it
                putExtra("threshold", threshold)
                putExtra("cooldownMs", cooldownMs)
                putExtra("bufferSize", bufferSize)
                putExtra("consecutiveFrames", consecutiveFrames)
            }
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            
            call.resolve(JSObject().apply { put("status", "listening") })
            
            // Listen for broadcasts from service to update UI
            // Implementation note: Capacitor usually handles events internally, 
            // but we need a BroadcastReceiver here to forward to WebView
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start background service", e)
            call.reject("Failed to start service: ${e.message}")
        }
    }
    
    @PluginMethod
    fun stopListening(call: PluginCall) {
        stopListeningInternal()
        call.resolve()
    }
    
    private fun stopListeningInternal() {
        val serviceIntent = Intent(context, BackgroundService::class.java).apply {
            action = BackgroundService.ACTION_STOP_LISTENING
        }
        context.startService(serviceIntent)
    }
    
    @PluginMethod
    fun isListening(call: PluginCall) {
        // Check if service is running
        call.resolve(JSObject().apply {
            put("listening", BackgroundService.isRunning)
        })
    }
    
    @PluginMethod
    fun setThreshold(call: PluginCall) {
        threshold = call.getFloat("threshold", 0.5f) ?: 0.5f
        updateServiceConfig()
        call.resolve(JSObject().apply { put("threshold", threshold.toDouble()) })
    }
    
    @PluginMethod
    fun setCooldown(call: PluginCall) {
        cooldownMs = (call.getInt("cooldownMs", 2000) ?: 2000).toLong()
        updateServiceConfig()
        call.resolve(JSObject().apply { put("cooldownMs", cooldownMs) })
    }
    
    @PluginMethod
    fun setBufferSize(call: PluginCall) {
        bufferSize = call.getInt("bufferSize", 20) ?: 20
        updateServiceConfig()
        call.resolve(JSObject().apply { put("bufferSize", bufferSize) })
    }
    
    private fun updateServiceConfig() {
        if (BackgroundService.isRunning) {
            val serviceIntent = Intent(context, BackgroundService::class.java).apply {
                action = BackgroundService.ACTION_UPDATE_CONFIG
                putExtra("threshold", threshold)
                putExtra("cooldownMs", cooldownMs)
                putExtra("bufferSize", bufferSize)
            }
            context.startService(serviceIntent)
        }
    }
    
    // --- Training API ---
    
    @PluginMethod
    fun startTraining(call: PluginCall) {
        val serviceIntent = Intent(context, BackgroundService::class.java).apply {
            action = BackgroundService.ACTION_START_TRAINING
        }
        context.startService(serviceIntent)
        call.resolve()
    }
    
    @PluginMethod
    fun stopTraining(call: PluginCall) {
        val serviceIntent = Intent(context, BackgroundService::class.java).apply {
            action = BackgroundService.ACTION_STOP_TRAINING
        }
        context.startService(serviceIntent)
        call.resolve()
    }

    @PluginMethod
    fun clearTrainingData(call: PluginCall) {
        val serviceIntent = Intent(context, BackgroundService::class.java).apply {
            action = BackgroundService.ACTION_CLEAR_TRAINING
        }
        context.startService(serviceIntent)
        call.resolve()
    }

    @PluginMethod
    fun getTrainingAudio(call: PluginCall) {
        if (!BackgroundService.isRunning) {
            call.reject("Service not running")
            return
        }
        // This is tricky because we need a return value from the service.
        // We can bind to the service, or use a broadcast, or a static reference (dirty but works for same process).
        // Since BackgroundService is a singleton-ish service in the same process, we can access the instance if we expose it,
        // OR we can use a ResultReceiver. 
        // For simplicity in this architecture, let's access the static detector instance via BackgroundService ONLY IF strictly necessary, 
        // BUT BackgroundService holds the detector instance privately.
        
        // Better approach: Send an intent to the service with a ResultReceiver.
        // Or simpler: BackgroundService has a companion object method to get the audio if running.
        
        val audio = BackgroundService.getTrainingAudio()
        if (audio != null) {
            call.resolve(JSObject().apply {
                put("audioBase64", audio)
            })
        } else {
            call.resolve(JSObject().apply {
                put("audioBase64", null)
            })
        }
    }
    
    @PluginMethod
    fun saveProfile(call: PluginCall) {
        val name = call.getString("name")
        if (name.isNullOrEmpty()) {
            call.reject("Name is required")
            return
        }
        
        val serviceIntent = Intent(context, BackgroundService::class.java).apply {
            action = BackgroundService.ACTION_SAVE_PROFILE
            putExtra("name", name)
        }
        context.startService(serviceIntent)
        call.resolve()
    }
    
    @PluginMethod
    fun provideTrainingSample(call: PluginCall) {
        val sample = call.getString("sample")
        if (sample.isNullOrEmpty()) {
            call.reject("sample (Base64 PCM) is required")
            return
        }
        
        val success = BackgroundService.ingestTrainingSample(sample)
        call.resolve(JSObject().apply {
            put("success", success)
        })
    }

    @PluginMethod
    fun getDebugDiagnostics(call: PluginCall) {
        val diagnostics = BackgroundService.getDebugDiagnostics()
        
        if (diagnostics == null) {
            call.resolve(JSObject().apply {
                put("available", false)
                put("error", "No diagnostics available. Ensure a custom model is loaded and has processed audio.")
            })
            return
        }
        
        // Convert FloatArray to JSArray for JavaScript
        val templateFirst10 = JSArray()
        diagnostics.templateFirst10.forEach { templateFirst10.put(it.toDouble()) }
        
        val liveFirst10 = JSArray()
        diagnostics.lastEmbeddingFirst10.forEach { liveFirst10.put(it.toDouble()) }
        
        call.resolve(JSObject().apply {
            put("available", true)
            
            // Template (enrollment) info
            put("templateMagnitude", diagnostics.templateMagnitude.toDouble())
            put("templateDimension", diagnostics.templateDimension)
            put("templateFirst10", templateFirst10)
            
            // Live embedding info
            put("lastEmbeddingMagnitude", diagnostics.lastEmbeddingMagnitude.toDouble())
            put("lastEmbeddingFirst10", liveFirst10)
            put("lastChunkSize", diagnostics.lastChunkSize)
            put("lastRms", diagnostics.lastRms.toDouble())
            
            // Comparison
            put("similarity", diagnostics.lastSimilarity.toDouble())
            put("threshold", diagnostics.currentThreshold.toDouble())
            put("vadProbability", diagnostics.vadProbability.toDouble())
            put("bufferSize", diagnostics.bufferSize)
            put("isMatch", diagnostics.isMatch)
            put("enrollmentSampleCount", diagnostics.enrollmentSampleCount)
            put("consecutiveDetections", diagnostics.consecutiveDetections)
            put("minConsecutiveFrames", diagnostics.minConsecutiveFrames)
            put("debugInfo", diagnostics.debugInfo)
        })
    }

    // Existing model management methods (getAvailableModels, copyModelFile, etc) remain valid
    // as they operate on the file system.

    @PluginMethod
    fun getAvailableModels(call: PluginCall) {
         val modelsDir = File(context.filesDir, "wakeword-models")
        val models = JSArray()
        
        // List of known OpenWakeWord models
        val knownModels = listOf(
            Triple("hey_jarvis_v0.1.tflite", "Hey Jarvis", "General purpose wake word"),
            Triple("alexa_v0.1.tflite", "Alexa", "Amazon Alexa style wake word"),
            Triple("hey_mycroft_v0.1.tflite", "Hey Mycroft", "Mycroft assistant wake word"),
            Triple("hey_rhasspy_v0.1.tflite", "Hey Rhasspy", "Rhasspy assistant wake word"),
            Triple("timer_v0.1.tflite", "Timer", "Timer command detection"),
            Triple("weather_v0.1.tflite", "Weather", "Weather query detection")
        )
        
        // Scan for all tflite files recursively
        val allTfliteFiles = mutableListOf<File>()
        if (modelsDir.exists()) {
             modelsDir.walk()
                 .filter { it.isFile && it.extension == "tflite" }
                 .forEach { allTfliteFiles.add(it) }
        }
        
        // Scan for custom profiles (JSON)
        val customDir = File(context.filesDir, "custom_wakewords")
        val customFiles = mutableListOf<File>()
        if (customDir.exists()) {
            customDir.walk()
                .filter { it.isFile && it.extension == "json" }
                .forEach { customFiles.add(it) }
        }
        
        // Process known models (these are expected to be at root)
        for ((fileName, displayName, description) in knownModels) {
            val modelFile = File(modelsDir, fileName)
            models.put(JSObject().apply {
                put("name", fileName)
                put("displayName", displayName)
                put("description", description)
                put("isDownloaded", modelFile.exists())
                if (modelFile.exists()) {
                    put("fileSize", modelFile.length())
                    put("path", modelFile.absolutePath)
                }
            })
        }
        
        // Add custom/imported models
        allTfliteFiles.forEach { file ->
            // Calculate relative path from modelsDir
            // Helper to get relative path manually since toRelativeString might behave differently across versions
            val relativePath = file.absolutePath.substring(modelsDir.absolutePath.length + 1)
            
            // Check if this file is one of the known models (or base models)
            val isKnown = knownModels.any { it.first == file.name && file.parentFile == modelsDir }
            val isBaseModel = file.name == "melspectrogram.tflite" || file.name == "embedding_model.tflite"
            
            if (!isKnown && !isBaseModel) {
                models.put(JSObject().apply {
                    put("name", relativePath) // Use relative path for loading
                    put("displayName", file.nameWithoutExtension.replace("_", " ").capitalize())
                    put("description", "Imported wake word model")
                    put("isDownloaded", true)
                    put("fileSize", file.length())
                    put("path", file.absolutePath)
                })
            }
        }
        
        // Add custom profiles
        customFiles.forEach { file ->
             models.put(JSObject().apply {
                put("name", "custom:${file.nameWithoutExtension}") 
                put("displayName", file.nameWithoutExtension)
                put("description", "Custom voice wake word")
                put("isDownloaded", true)
                put("fileSize", file.length())
                put("path", file.absolutePath)
            })
        }
        
        call.resolve(JSObject().apply { put("models", models) })
    }
    
    @PluginMethod
    fun copyModelFile(call: PluginCall) {
        val sourcePath = call.getString("sourcePath")
        val fileName = call.getString("fileName")
        
        if (sourcePath.isNullOrEmpty() || fileName.isNullOrEmpty()) {
            call.reject("sourcePath and fileName are required")
            return
        }
        
        try {
            val modelsDir = File(context.filesDir, "wakeword-models")
            if (!modelsDir.exists()) {
                modelsDir.mkdirs()
            }
            
            val destFile = File(modelsDir, fileName)
            
            // Robust input stream usage
            val inputStream = if (sourcePath.startsWith("content://")) {
                val uri = android.net.Uri.parse(sourcePath)
                context.contentResolver.openInputStream(uri)
            } else {
                var sourceFile = File(sourcePath)
                if (!sourceFile.exists() && sourcePath.startsWith("file://")) {
                    sourceFile = File(sourcePath.substring(7))
                }
                if (!sourceFile.exists()) {
                    call.reject("Source file does not exist: $sourcePath")
                    return
                }
                java.io.FileInputStream(sourceFile)
            }
            
            if (inputStream == null) {
                call.reject("Could not open input stream from source")
                return
            }
            
            destFile.outputStream().use { output ->
                inputStream.copyTo(output)
            }
            inputStream.close()
            
            Log.i(TAG, "Model file copied to: ${destFile.absolutePath}")
            call.resolve(JSObject().apply {
                put("path", destFile.absolutePath)
            })
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to copy model file", e)
            call.reject("Copy failed: ${e.message}")
        }
    }
    
    @PluginMethod
    fun checkBaseModels(call: PluginCall) {
         val modelsDir = File(context.filesDir, "wakeword-models")
        val melFile = File(modelsDir, "melspectrogram.tflite")
        val embFile = File(modelsDir, "embedding_model.tflite")
        
        call.resolve(JSObject().apply {
            put("hasMelSpectrogram", melFile.exists())
            put("hasEmbedding", embFile.exists())
            if (melFile.exists()) {
                put("melSpectrogramPath", melFile.absolutePath)
            }
            if (embFile.exists()) {
                put("embeddingPath", embFile.absolutePath)
            }
        })
    }
    
    @PluginMethod
    fun importModelZip(call: PluginCall) {
        val sourcePath = call.getString("sourcePath")
        val fileName = call.getString("fileName")
        
        if (sourcePath.isNullOrEmpty() || fileName.isNullOrEmpty()) {
            call.reject("sourcePath and fileName are required")
            return
        }
        
        Thread {
            try {
                Log.i(TAG, "Importing model from: $sourcePath to: $fileName")
                
                val modelsDir = File(context.filesDir, "wakeword-models")
                if (!modelsDir.exists()) modelsDir.mkdirs()
                
                // Temp file for zip
                val tempZip = File(context.cacheDir, fileName)
                
                val inputStream = if (sourcePath.startsWith("content://")) {
                    val uri = android.net.Uri.parse(sourcePath)
                    context.contentResolver.openInputStream(uri)
                } else {
                    var sourceFile = File(sourcePath)
                    if (!sourceFile.exists() && sourcePath.startsWith("file://")) {
                        sourceFile = File(sourcePath.substring(7))
                    }
                    if (!sourceFile.exists()) {
                        call.reject("Source file does not exist: $sourcePath")
                        return@Thread
                    }
                    java.io.FileInputStream(sourceFile)
                }
                
                if (inputStream == null) {
                    call.reject("Failed to open input stream")
                    return@Thread
                }
                
                // Copy to temp zip
                inputStream.use { input ->
                    tempZip.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                
                Log.i(TAG, "Zip downloaded to temp: ${tempZip.absolutePath}")
                
                 // Unzip if it's a ZIP file
                if (fileName.endsWith(".zip")) {
                    val unzipPath = fileName.substring(0, fileName.lastIndexOf('.'))
                    // Unzip to wakeword-models/<unzipPath>
                    val unzipDir = File(modelsDir, unzipPath)
                    if (!unzipDir.exists()) unzipDir.mkdirs()
                    
                    unzip(tempZip, unzipDir)
                    tempZip.delete()
                    
                    // Handle nested single-directory structure if present
                    val files = unzipDir.listFiles()
                    var finalPath = unzipPath
                    
                    // Recursive scan will pick it up anyway, but we return the path
                     call.resolve(JSObject().apply {
                        put("path", unzipDir.absolutePath)
                    })
                } else {
                    // Not a zip? Just move it to models dir
                    val destFile = File(modelsDir, fileName)
                    tempZip.copyTo(destFile, overwrite = true)
                    tempZip.delete()
                    
                    call.resolve(JSObject().apply {
                        put("path", destFile.absolutePath)
                    })
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "Import failed", e)
                call.reject("Import failed: ${e.message}")
            }
        }.start()
    }
    
    private fun unzip(zipFile: File, targetDirectory: File) {
        java.util.zip.ZipInputStream(java.io.BufferedInputStream(java.io.FileInputStream(zipFile))).use { zis ->
            var ze: java.util.zip.ZipEntry?
            val buffer = ByteArray(8192)
            while (zis.nextEntry.also { ze = it } != null) {
                val entry = ze!!
                val file = File(targetDirectory, entry.name)
                val dir = if (entry.isDirectory) file else file.parentFile
                if (dir != null && !dir.isDirectory && !dir.mkdirs()) {
                    throw java.io.FileNotFoundException("Failed to ensure directory: ${dir.absolutePath}")
                }
                if (entry.isDirectory) continue
                
                java.io.FileOutputStream(file).use { fout ->
                    var count: Int
                    while (zis.read(buffer).also { count = it } != -1) {
                        fout.write(buffer, 0, count)
                    }
                }
            }
        }
    }
    
    // Broadcast receiver registration to forward events to Capacitor
    private var receiver: android.content.BroadcastReceiver? = null
    
    override fun handleOnStart() {
        super.handleOnStart()
        // Register receiver
        if (receiver == null) {
            receiver = object : android.content.BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action == BackgroundService.BROADCAST_WAKE_WORD_DETECTED) {
                        val wakeWord = intent.getStringExtra(BackgroundService.EXTRA_WAKE_WORD)
                        val confidence = intent.getFloatExtra(BackgroundService.EXTRA_CONFIDENCE, 0f)
                        
                        notifyListeners("wakeWordDetected", JSObject().apply {
                            put("wakeWord", wakeWord)
                            put("confidence", confidence.toDouble())
                            put("timestamp", System.currentTimeMillis())
                        })
                    }
                }
            }
            val filter = android.content.IntentFilter(BackgroundService.BROADCAST_WAKE_WORD_DETECTED)
            // Listen for local broadcasts if possible, or global if service is separate process (it is same process)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
        }
    }
    
    override fun handleOnStop() {
        super.handleOnStop()
        // We don't unregister here if we want to keep receiving updates when app is in background 
        // BUT Capacitor plugins might not deliver events if webview is paused/killed.
        // The service brings the app to foreground anyway.
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        val modelName = call.getString("modelName")
        if (modelName.isNullOrEmpty()) {
            call.reject("modelName is required")
            return
        }

        try {
            var deleted = false
            
            // Protect base models
            if (modelName == "melspectrogram.tflite" || modelName == "embedding_model.tflite") {
                call.reject("Cannot delete base models")
                return
            }

            if (modelName.startsWith("custom:")) {
                // Delete custom profile (JSON)
                val cleanName = modelName.substring(7) // remove "custom:"
                val customDir = File(context.filesDir, "custom_wakewords")
                val file = File(customDir, "$cleanName.json")
                if (file.exists()) {
                    deleted = file.delete()
                } else {
                    call.reject("Custom model not found")
                    return
                }
            } else {
                // Delete tflite model
                val modelsDir = File(context.filesDir, "wakeword-models")
                val file = File(modelsDir, modelName)
                
                // Security check to prevent path traversal
                if (!file.canonicalPath.startsWith(modelsDir.canonicalPath)) {
                    call.reject("Invalid model path")
                    return
                }

                if (file.exists()) {
                    if (file.isDirectory) {
                        deleted = file.deleteRecursively()
                    } else {
                        deleted = file.delete()
                    }
                } else {
                    call.reject("Model not found")
                    return
                }
            }

            if (deleted) {
                // If the deleted model was current, stop listening
                val currentModel = call.getString("currentModel")
                if (currentModel == modelName && BackgroundService.isRunning) {
                     stopListeningInternal()
                }
                call.resolve()
            } else {
                call.reject("Failed to delete file")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete model", e)
            call.reject("Delete failed: ${e.message}")
        }
    }
}