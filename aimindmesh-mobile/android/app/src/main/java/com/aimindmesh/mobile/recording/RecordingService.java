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
 * Foreground service (type microphone) that keeps the process and the microphone alive while a
 * meeting is recorded with the screen off or the app in the background (separate from the app's
 * keep-alive service, so either can stop without ending the other). It owns no audio: the
 * capture lives in {@link RecordingEngine}, which starts and stops this service.
 */
public class RecordingService extends Service {
    private static final String TAG = "RecordingService";
    private static final String CHANNEL_ID = "meeting_recording";
    private static final int NOTIFICATION_ID = 4201;
    private static final long WAKE_LOCK_TIMEOUT_MS = 12L * 60 * 60 * 1000;
    /** Notification action: mark the current moment without opening the app. */
    static final String ACTION_BOOKMARK = "com.aimindmesh.mobile.recording.BOOKMARK";

    private PowerManager.WakeLock wakeLock;
    /** Position of the last mark made from the notification, shown as feedback; -1 if none. */
    private static volatile long lastMarkMs = -1;

    static void start(Context ctx) {
        ContextCompat.startForegroundService(ctx, new Intent(ctx, RecordingService.class));
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, RecordingService.class));
    }

    /** Re-renders the notification after a pause/resume. */
    @SuppressWarnings("MissingPermission") // notify() is a no-op without the notification permission
    static void refresh(Context ctx) {
        if (RecordingEngine.get(ctx).getState() == RecordingEngine.State.IDLE) {
            return;
        }
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, buildNotification(ctx));
        } catch (SecurityException e) {
            Log.w(TAG, "Notification permission not granted", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        RecordingEngine engine = RecordingEngine.get(this);
        if (intent != null && ACTION_BOOKMARK.equals(intent.getAction())) {
            if (engine.getState() == RecordingEngine.State.IDLE) {
                // A stale notification: never go foreground without a recording
                stopSelf(startId);
                return START_NOT_STICKY;
            }
            lastMarkMs = engine.addBookmark();
        } else {
            lastMarkMs = -1;
        }
        createChannel(this);
        Notification notification = buildNotification(this);
        // The microphone type exists from Android 11; before it the manifest's type applies
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIMindMesh:recording");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }

        // If the system kills the process, the engine is gone too: the leftover session is
        // offered for recovery at the next launch, so there is nothing to restart here.
        return START_NOT_STICKY;
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
                ctx.getString(R.string.recording_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(ctx.getString(R.string.recording_channel_description));
        channel.setShowBadge(false);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(channel);
    }

    private static Notification buildNotification(Context ctx) {
        RecordingEngine engine = RecordingEngine.get(ctx);
        boolean paused = engine.getState() == RecordingEngine.State.PAUSED;
        long elapsedMs = engine.getDurationMs();

        String text = lastMarkMs >= 0
                ? ctx.getString(R.string.recording_moment_marked, formatClock(lastMarkMs))
                : ctx.getString(R.string.recording_tap_to_open);
        Intent mark = new Intent(ctx, RecordingService.class).setAction(ACTION_BOOKMARK);
        PendingIntent markIntent = PendingIntent.getService(ctx, 2, mark,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle(ctx.getString(paused ? R.string.recording_paused : R.string.recording_in_progress))
                .setContentText(text)
                .addAction(R.drawable.ic_stat_mic, ctx.getString(R.string.recording_mark_moment), markIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);

        if (paused) {
            builder.setShowWhen(false);
        } else {
            builder.setShowWhen(true)
                    .setUsesChronometer(true)
                    .setWhen(System.currentTimeMillis() - elapsedMs);
        }

        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            builder.setContentIntent(PendingIntent.getActivity(ctx, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    private static String formatClock(long ms) {
        long total = ms / 1000;
        long h = total / 3600, m = (total % 3600) / 60, sec = total % 60;
        return h > 0 ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, m, sec)
                : String.format(java.util.Locale.ROOT, "%d:%02d", m, sec);
    }
}
