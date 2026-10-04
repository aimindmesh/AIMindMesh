package com.aimindmesh.mobile.recording;

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
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.aimindmesh.mobile.R;

/**
 * Keeps the process running (and the CPU awake) while a recording is transcribed after the
 * meeting, so it completes with the screen off or the app in background. The work itself runs
 * in the web layer and the native plugins; this service only holds the foreground state and
 * shows the progress.
 */
public class ProcessingService extends Service {
    private static final String TAG = "ProcessingService";
    private static final String CHANNEL_ID = "meeting_processing";
    private static final int NOTIFICATION_ID = 4202;
    private static final long WAKE_LOCK_TIMEOUT_MS = 3L * 60 * 60 * 1000;

    static final String EXTRA_KIND = "kind";
    static final String EXTRA_PERCENT = "percent";

    private PowerManager.WakeLock wakeLock;

    /** @param kind "transcribe" or "speakers"; @param percent 0-100, or -1 while preparing */
    static void startOrUpdate(Context ctx, String kind, int percent) {
        Intent intent = new Intent(ctx, ProcessingService.class)
                .putExtra(EXTRA_KIND, kind)
                .putExtra(EXTRA_PERCENT, percent);
        ContextCompat.startForegroundService(ctx, intent);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, ProcessingService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String kind = intent != null ? intent.getStringExtra(EXTRA_KIND) : null;
        int percent = intent != null ? intent.getIntExtra(EXTRA_PERCENT, -1) : -1;
        createChannel(this);
        Notification notification = buildNotification(this, kind, percent);

        if (Build.VERSION.SDK_INT >= 35) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIMindMesh:processing");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }
        return START_NOT_STICKY;
    }

    /** Android 15 limits media processing to 6 h per day: stop rather than be killed. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "Foreground time limit reached, stopping");
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                ctx.getString(R.string.processing_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        ctx.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private static Notification buildNotification(Context ctx, String kind, int percent) {
        String title = ctx.getString("speakers".equals(kind)
                ? R.string.processing_speakers : R.string.processing_transcript);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle(title)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(100, Math.max(0, percent), percent < 0);
        if (percent >= 0) {
            builder.setContentText(percent + "%");
        }
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            builder.setContentIntent(PendingIntent.getActivity(ctx, 1, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    /** Refreshes the progress without going through startForegroundService again. */
    @SuppressWarnings("MissingPermission")
    static void notifyProgress(Context ctx, String kind, int percent) {
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, buildNotification(ctx, kind, percent));
        } catch (SecurityException e) {
            Log.w(TAG, "Notification permission not granted", e);
        }
    }
}
