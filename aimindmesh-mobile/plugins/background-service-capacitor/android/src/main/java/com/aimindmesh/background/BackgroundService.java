package com.aimindmesh.background;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;

public class BackgroundService extends Service {
    private static final String TAG = "BackgroundService";
    public static final String CHANNEL_ID = "BackgroundServiceChannel";
    public static final String ACTION_STOP = "STOP_SERVICE";
    public static volatile boolean isRunning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent != null ? intent.getStringExtra("title") : null;
        String body = intent != null ? intent.getStringExtra("body") : null;

        Intent notificationIntent = new Intent();
        try {
            // Try to open the main activity
            notificationIntent = new Intent(this, Class.forName(getPackageName() + ".MainActivity"));
            notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        } catch (ClassNotFoundException e) {
            Log.w(TAG, "MainActivity not found for the notification tap", e);
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(this,
                0, notificationIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title != null ? title : "AMM Mobile")
                .setContentText(body != null ? body : "Sempre attivo in background")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();

        if (!enterForeground(notification)) {
            // Without startForeground the system would kill the app for a missed FGS deadline
            isRunning = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        isRunning = true;
        return START_STICKY;
    }

    /**
     * Android 14+ needs an explicit service type: microphone when RECORD_AUDIO is granted
     * (recording keeps working with the screen off), otherwise specialUse (keep-alive only).
     */
    private boolean enterForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            boolean hasMic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            if (hasMic && tryStartForeground(notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)) {
                return true;
            }
            return tryStartForeground(notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        }
        try {
            startForeground(1, notification);
            return true;
        } catch (RuntimeException e) {
            // e.g. ForegroundServiceStartNotAllowedException when restarted from the background
            Log.e(TAG, "startForeground failed", e);
            return false;
        }
    }

    @RequiresApi(34)
    private boolean tryStartForeground(Notification notification, int type) {
        try {
            startForeground(1, notification, type);
            return true;
        } catch (RuntimeException e) {
            // SecurityException (type not allowed now) or ForegroundServiceStartNotAllowedException
            Log.w(TAG, "startForeground with type " + type + " refused", e);
            return false;
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Background Service Channel",
                    NotificationManager.IMPORTANCE_LOW);
            serviceChannel.setDescription("Mantiene AMM Mobile attivo in background");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
