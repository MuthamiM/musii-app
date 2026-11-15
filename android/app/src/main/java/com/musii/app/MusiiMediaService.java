package com.musii.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MusiiMediaService extends Service {
    public static final String ACTION_UPDATE = "com.musii.app.ACTION_UPDATE";
    public static final String ACTION_PLAY = "com.musii.app.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.musii.app.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.musii.app.ACTION_NEXT";
    public static final String ACTION_PREV = "com.musii.app.ACTION_PREV";
    public static final String ACTION_STOP = "com.musii.app.ACTION_STOP";

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_ARTIST = "extra_artist";
    public static final String EXTRA_IS_PLAYING = "extra_is_playing";
    public static final String EXTRA_COVER_URL = "extra_cover_url";

    private static final String CHANNEL_ID = "musii_media_playback";
    private static final int NOTIFICATION_ID = 4040;

    private PowerManager.WakeLock wakeLock;
    private String currentTitle = "MUSII";
    private String currentArtist = "Connecting stream...";
    private boolean isPlaying = false;
    private String currentCoverUrl = null;
    private Bitmap cachedArtwork = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MUSII:AudioPlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "MUSII Media Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Controls for MUSII background audio playback");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_STICKY;
        }

        String action = intent.getAction();

        if (ACTION_UPDATE.equals(action)) {
            currentTitle = intent.getStringExtra(EXTRA_TITLE);
            if (currentTitle == null || currentTitle.isEmpty()) currentTitle = "MUSII";
            currentArtist = intent.getStringExtra(EXTRA_ARTIST);
            if (currentArtist == null || currentArtist.isEmpty()) currentArtist = "Playing Lossless Stream";
            isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false);
            String newCoverUrl = intent.getStringExtra(EXTRA_COVER_URL);

            if (isPlaying) {
                acquireWakeLock();
            } else {
                releaseWakeLock();
            }

            if (newCoverUrl != null && !newCoverUrl.equals(currentCoverUrl)) {
                currentCoverUrl = newCoverUrl;
                loadArtworkAsync(currentCoverUrl);
            } else {
                updateNotification();
            }
        } else if (ACTION_PLAY.equals(action)) {
            MainActivity.dispatchMediaAction("play");
            isPlaying = true;
            acquireWakeLock();
            updateNotification();
        } else if (ACTION_PAUSE.equals(action)) {
            MainActivity.dispatchMediaAction("pause");
            isPlaying = false;
            releaseWakeLock();
            updateNotification();
        } else if (ACTION_NEXT.equals(action)) {
            MainActivity.dispatchMediaAction("next");
        } else if (ACTION_PREV.equals(action)) {
            MainActivity.dispatchMediaAction("prev");
        } else if (ACTION_STOP.equals(action)) {
            MainActivity.dispatchMediaAction("pause");
            releaseWakeLock();
            stopForeground(true);
            stopSelf();
        }

        return START_STICKY;
    }

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(180 * 60 * 1000L); // 3 hours max safe timeout
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void loadArtworkAsync(final String urlString) {
        new Thread(() -> {
            Bitmap bmp = null;
            try {
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoInput(true);
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.connect();
                InputStream input = conn.getInputStream();
                bmp = BitmapFactory.decodeStream(input);
            } catch (Exception ignored) {
            }
            cachedArtwork = bmp;
            updateNotification();
        }).start();
    }

    private void updateNotification() {
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pContent = PendingIntent.getActivity(
                this, 0, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent pPrev = PendingIntent.getService(
                this, 1, new Intent(this, MusiiMediaService.class).setAction(ACTION_PREV),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent playPauseIntent = new Intent(this, MusiiMediaService.class)
                .setAction(isPlaying ? ACTION_PAUSE : ACTION_PLAY);
        PendingIntent pPlayPause = PendingIntent.getService(
                this, 2, playPauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent pNext = PendingIntent.getService(
                this, 3, new Intent(this, MusiiMediaService.class).setAction(ACTION_NEXT),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int playPauseIcon = isPlaying
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText("MUSII Hi-Fi")
                .setContentIntent(pContent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_previous, "Previous", pPrev)
                .addAction(playPauseIcon, isPlaying ? "Pause" : "Play", pPlayPause)
                .addAction(android.R.drawable.ic_media_next, "Next", pNext)
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setShowActionsInCompactView(0, 1, 2));

        if (cachedArtwork != null) {
            builder.setLargeIcon(cachedArtwork);
        }

        Notification notification = builder.build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
