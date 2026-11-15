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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MusiiMediaService extends Service {
    public static final String ACTION_PLAY_STREAM = "com.musii.app.ACTION_PLAY_STREAM";
    public static final String ACTION_UPDATE = "com.musii.app.ACTION_UPDATE";
    public static final String ACTION_PLAY = "com.musii.app.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.musii.app.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.musii.app.ACTION_NEXT";
    public static final String ACTION_PREV = "com.musii.app.ACTION_PREV";
    public static final String ACTION_SEEK = "com.musii.app.ACTION_SEEK";
    public static final String ACTION_STOP = "com.musii.app.ACTION_STOP";

    public static final String EXTRA_STREAM_URL = "extra_stream_url";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_ARTIST = "extra_artist";
    public static final String EXTRA_IS_PLAYING = "extra_is_playing";
    public static final String EXTRA_COVER_URL = "extra_cover_url";
    public static final String EXTRA_DURATION = "extra_duration";
    public static final String EXTRA_POSITION = "extra_position";

    private static final String CHANNEL_ID = "musii_media_playback";
    private static final int NOTIFICATION_ID = 4040;

    private MediaPlayer mediaPlayer;
    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private Handler progressHandler;
    private Runnable progressRunnable;

    private String currentStreamUrl = null;
    private String currentTitle = "MUSII";
    private String currentArtist = "Hi-Fi Lossless";
    private boolean isPlaying = false;
    private String currentCoverUrl = null;
    private Bitmap cachedArtwork = null;
    private long currentDurationMs = 210000L;
    private long currentPositionMs = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        initMediaSession();
        initAudioManager();
        initMediaPlayer();
        initWakeLock();
        initProgressTracker();
    }

    private void initWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MUSII:AudioPlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
    }

    private void initAudioManager() {
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    private void initMediaPlayer() {
        mediaPlayer = new MediaPlayer();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build());
        } else {
            mediaPlayer.setAudioStreamType(AudioManager.STREAM_MUSIC);
        }
        mediaPlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);

        mediaPlayer.setOnPreparedListener(mp -> {
            mp.start();
            isPlaying = true;
            if (mp.getDuration() > 0) {
                currentDurationMs = mp.getDuration();
            }
            acquireWakeLock();
            updatePlaybackState();
            updateNotification();
            startProgressTracker();
            MainActivity.dispatchMediaAction("native_playing");
        });

        mediaPlayer.setOnCompletionListener(mp -> {
            isPlaying = false;
            stopProgressTracker();
            updatePlaybackState();
            updateNotification();
            MainActivity.dispatchMediaAction("next");
        });

        mediaPlayer.setOnErrorListener((mp, what, extra) -> {
            isPlaying = false;
            stopProgressTracker();
            updatePlaybackState();
            updateNotification();
            return false;
        });
    }

    private void initProgressTracker() {
        progressHandler = new Handler(Looper.getMainLooper());
        progressRunnable = new Runnable() {
            @Override
            public void run() {
                if (mediaPlayer != null && isPlaying) {
                    try {
                        int pos = mediaPlayer.getCurrentPosition();
                        int dur = mediaPlayer.getDuration();
                        currentPositionMs = pos;
                        if (dur > 0) currentDurationMs = dur;
                        MainActivity.dispatchNativeProgress(pos / 1000.0, dur / 1000.0);
                        progressHandler.postDelayed(this, 1000);
                    } catch (Exception ignored) {
                    }
                }
            }
        };
    }

    private void startProgressTracker() {
        stopProgressTracker();
        if (progressHandler != null && progressRunnable != null) {
            progressHandler.post(progressRunnable);
        }
    }

    private void stopProgressTracker() {
        if (progressHandler != null && progressRunnable != null) {
            progressHandler.removeCallbacks(progressRunnable);
        }
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS ||
                            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            pausePlayback();
                        } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                            resumePlayback();
                        }
                    })
                    .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            audioManager.requestAudioFocus(
                    focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS ||
                            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            pausePlayback();
                        }
                    },
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
            );
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "MUSII_MEDIA_SESSION");
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                resumePlayback();
            }

            @Override
            public void onPause() {
                pausePlayback();
            }

            @Override
            public void onSkipToNext() {
                MainActivity.dispatchMediaAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                MainActivity.dispatchMediaAction("prev");
            }

            @Override
            public void onStop() {
                pausePlayback();
                stopForeground(true);
                stopSelf();
            }

            @Override
            public void onSeekTo(long pos) {
                seekPlayback(pos);
            }
        });

        mediaSession.setActive(true);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "MUSII Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Controls for MUSII background audio playback on Samsung lock screen and status bar");
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

        if (ACTION_PLAY_STREAM.equals(action)) {
            String streamUrl = intent.getStringExtra(EXTRA_STREAM_URL);
            currentTitle = intent.getStringExtra(EXTRA_TITLE);
            if (currentTitle == null || currentTitle.isEmpty()) currentTitle = "MUSII";
            currentArtist = intent.getStringExtra(EXTRA_ARTIST);
            if (currentArtist == null || currentArtist.isEmpty()) currentArtist = "Playing Lossless Stream";
            currentDurationMs = intent.getLongExtra(EXTRA_DURATION, 210000L);
            String newCoverUrl = intent.getStringExtra(EXTRA_COVER_URL);

            if (newCoverUrl != null && !newCoverUrl.equals(currentCoverUrl)) {
                currentCoverUrl = newCoverUrl;
                loadArtworkAsync(currentCoverUrl);
            }

            playStreamUrl(streamUrl);
        } else if (ACTION_UPDATE.equals(action)) {
            currentTitle = intent.getStringExtra(EXTRA_TITLE);
            if (currentTitle == null || currentTitle.isEmpty()) currentTitle = "MUSII";
            currentArtist = intent.getStringExtra(EXTRA_ARTIST);
            if (currentArtist == null || currentArtist.isEmpty()) currentArtist = "Playing Lossless Stream";
            isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, isPlaying);
            currentDurationMs = intent.getLongExtra(EXTRA_DURATION, currentDurationMs);
            currentPositionMs = intent.getLongExtra(EXTRA_POSITION, currentPositionMs);
            String newCoverUrl = intent.getStringExtra(EXTRA_COVER_URL);

            if (newCoverUrl != null && !newCoverUrl.equals(currentCoverUrl)) {
                currentCoverUrl = newCoverUrl;
                loadArtworkAsync(currentCoverUrl);
            } else {
                updatePlaybackState();
                updateNotification();
            }
        } else if (ACTION_PLAY.equals(action)) {
            resumePlayback();
        } else if (ACTION_PAUSE.equals(action)) {
            pausePlayback();
        } else if (ACTION_NEXT.equals(action)) {
            MainActivity.dispatchMediaAction("next");
        } else if (ACTION_PREV.equals(action)) {
            MainActivity.dispatchMediaAction("prev");
        } else if (ACTION_SEEK.equals(action)) {
            long pos = intent.getLongExtra(EXTRA_POSITION, 0L);
            seekPlayback(pos);
        } else if (ACTION_STOP.equals(action)) {
            pausePlayback();
            releaseWakeLock();
            stopForeground(true);
            stopSelf();
        }

        return START_STICKY;
    }

    private void playStreamUrl(String url) {
        if (url == null || url.isEmpty()) return;
        currentStreamUrl = url;
        requestAudioFocus();
        acquireWakeLock();

        try {
            if (mediaPlayer == null) initMediaPlayer();
            mediaPlayer.reset();
            mediaPlayer.setDataSource(url);
            mediaPlayer.prepareAsync();
            updatePlaybackState();
            updateNotification();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void resumePlayback() {
        requestAudioFocus();
        acquireWakeLock();
        if (mediaPlayer != null) {
            try {
                mediaPlayer.start();
            } catch (Exception ignored) {
            }
        }
        isPlaying = true;
        startProgressTracker();
        updatePlaybackState();
        updateNotification();
        MainActivity.dispatchMediaAction("play");
    }

    private void pausePlayback() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.pause();
                }
            } catch (Exception ignored) {
            }
        }
        isPlaying = false;
        stopProgressTracker();
        releaseWakeLock();
        updatePlaybackState();
        updateNotification();
        MainActivity.dispatchMediaAction("pause");
    }

    private void seekPlayback(long posMs) {
        currentPositionMs = posMs;
        if (mediaPlayer != null) {
            try {
                mediaPlayer.seekTo((int) posMs);
            } catch (Exception ignored) {
            }
        }
        updatePlaybackState();
        MainActivity.dispatchSeekAction(posMs / 1000.0);
    }

    private void updatePlaybackState() {
        if (mediaSession == null) return;

        long actions = PlaybackStateCompat.ACTION_PLAY |
                       PlaybackStateCompat.ACTION_PAUSE |
                       PlaybackStateCompat.ACTION_PLAY_PAUSE |
                       PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                       PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                       PlaybackStateCompat.ACTION_SEEK_TO |
                       PlaybackStateCompat.ACTION_STOP;

        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, currentPositionMs, 1.0f);

        mediaSession.setPlaybackState(stateBuilder.build());

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "MUSII")
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs);

        if (cachedArtwork != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cachedArtwork);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, cachedArtwork);
        }

        mediaSession.setMetadata(metaBuilder.build());
        mediaSession.setActive(true);
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
            updatePlaybackState();
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

        PendingIntent pStop = PendingIntent.getService(
                this, 4, new Intent(this, MusiiMediaService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int playPauseIcon = isPlaying
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
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
                        .setMediaSession(mediaSession != null ? mediaSession.getSessionToken() : null)
                        .setShowActionsInCompactView(0, 1, 2)
                        .setShowCancelButton(true)
                        .setCancelButtonIntent(pStop));

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
    public void onTaskRemoved(Intent rootIntent) {
        // Keep playing music even when user swipes away app from recents
        if (isPlaying) {
            // Keep service alive
            return;
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopProgressTracker();
        releaseWakeLock();
        if (mediaPlayer != null) {
            try {
                mediaPlayer.release();
            } catch (Exception ignored) {
            }
            mediaPlayer = null;
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        if (audioManager != null && audioFocusRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
