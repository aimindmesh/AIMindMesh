package com.aimindmesh.mobile.performance;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.net.wifi.WifiManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.aimindmesh.mobile.MainActivity;
import com.aimindmesh.mobile.R;

public class KeepAliveService extends Service {

    public static final String CHANNEL_ID = "KeepAliveChannel";
    public static final int NOTIFICATION_ID = 4554; // Random unique ID
    
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d("KeepAliveDebug", "KeepAliveService onCreate");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        android.util.Log.d("KeepAliveDebug", "KeepAliveService onStartCommand");
        createNotificationChannel();

        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this,
                0, notificationIntent, PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("AMM Mobile Running")
                .setContentText("Listening for wake words and maintaining background services active.")
                .setSmallIcon(R.mipmap.ic_launcher) // Ensure this resource exists or use
                                                    // android.R.drawable.ic_menu_info_details
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                if (Build.VERSION.SDK_INT >= 34) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                Log.d("KeepAliveDebug", "KeepAliveService startForeground called successfully");
            } catch (Exception e) {
                Log.e("KeepAliveDebug", "KeepAliveService startForeground failed", e);
            }
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Acquire WakeLock to prevent CPU sleeping
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (wakeLock == null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIMindMesh:WakeLock");
            wakeLock.acquire();
            Log.d("KeepAliveDebug", "WakeLock acquired");
        }

        // Acquire WifiLock to prevent network dropping
        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiLock == null) {
            wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "AIMindMesh:WifiLock");
            wifiLock.acquire();
            Log.d("KeepAliveDebug", "WifiLock acquired");
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d("KeepAliveDebug", "WakeLock released");
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
            Log.d("KeepAliveDebug", "WifiLock released");
        }
        super.onDestroy();
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
                    "AMM Mobile Keep Alive",
                    NotificationManager.IMPORTANCE_LOW);
            serviceChannel.setDescription("AMM Mobile Keep Alive");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
