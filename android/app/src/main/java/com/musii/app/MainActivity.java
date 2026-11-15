package com.musii.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MUSII_Main";
    private static MainActivity activeInstance = null;
    private boolean nativeBridgeInjected = false;
    private final Handler retryHandler = new Handler(Looper.getMainLooper());

    public static void dispatchMediaAction(String action) {
        if (activeInstance != null && activeInstance.getBridge() != null) {
            WebView webView = activeInstance.getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> {
                    String script;
                    if ("play".equals(action)) {
                        script = "if (window.audioController) window.audioController.play();";
                    } else if ("pause".equals(action)) {
                        script = "if (window.audioController) window.audioController.pause();";
                    } else if ("next".equals(action)) {
                        script = "if (window.audioController) window.audioController.next();";
                    } else if ("prev".equals(action)) {
                        script = "if (window.audioController) window.audioController.prev();";
                    } else if ("native_playing".equals(action)) {
                        script = "if (window.audioController) window.audioController.onNativePlaying();";
                    } else {
                        script = "";
                    }
                    if (!script.isEmpty()) {
                        webView.evaluateJavascript(script, null);
                    }
                });
            }
        }
    }

    public static void dispatchSeekAction(double seconds) {
        if (activeInstance != null && activeInstance.getBridge() != null) {
            WebView webView = activeInstance.getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> {
                    String script = "if (window.audioController) window.audioController.seekTo(" + seconds + ");";
                    webView.evaluateJavascript(script, null);
                });
            }
        }
    }

    public static void dispatchNativeProgress(double currentTime, double duration) {
        if (activeInstance != null && activeInstance.getBridge() != null) {
            WebView webView = activeInstance.getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> {
                    String script = "if (window.audioController && window.audioController.onNativeProgress) window.audioController.onNativeProgress(" + currentTime + ", " + duration + ");";
                    webView.evaluateJavascript(script, null);
                });
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;
        Log.d(TAG, "onCreate: Activity created");

        requestNotificationPermission();

        // Attempt immediate injection
        injectNativeBridge();

        // Schedule retries -- Capacitor WebView may not be ready until after layout
        retryHandler.postDelayed(this::injectNativeBridge, 300);
        retryHandler.postDelayed(this::injectNativeBridge, 800);
        retryHandler.postDelayed(this::injectNativeBridge, 1500);
        retryHandler.postDelayed(this::injectNativeBridge, 3000);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        1010
                );
            }
        }
    }

    /**
     * Injects the MusiiNative JavaScript interface into the Capacitor WebView.
     * Called multiple times with increasing delays to handle the race condition
     * where Capacitor's bridge/WebView is not yet fully initialized during onCreate.
     */
    private void injectNativeBridge() {
        if (nativeBridgeInjected) return;

        try {
            if (bridge == null) {
                Log.d(TAG, "injectNativeBridge: bridge is null, will retry");
                return;
            }

            WebView webView = bridge.getWebView();
            if (webView == null) {
                Log.d(TAG, "injectNativeBridge: WebView is null, will retry");
                return;
            }

            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);

            // Register the native bridge for background audio and media notifications
            webView.addJavascriptInterface(new MusiiNativeBridge(), "MusiiNative");
            nativeBridgeInjected = true;
            Log.d(TAG, "injectNativeBridge: MusiiNative bridge INJECTED SUCCESSFULLY");

            // Confirm injection to the JS side
            webView.post(() -> {
                webView.evaluateJavascript(
                    "console.log('[MUSII] Native bridge injected: ' + (typeof window.MusiiNative !== 'undefined'));",
                    null
                );
            });
        } catch (Exception e) {
            Log.e(TAG, "injectNativeBridge: Exception - " + e.getMessage());
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        activeInstance = this;
        // Re-inject on every start in case the WebView was recreated
        injectNativeBridge();
    }

    @Override
    public void onResume() {
        super.onResume();
        activeInstance = this;
        injectNativeBridge();
    }

    @Override
    public void onPause() {
        // Do NOT stop WebView -- keep background audio alive on Samsung One UI
        super.onPause();
    }

    @Override
    public void onDestroy() {
        retryHandler.removeCallbacksAndMessages(null);
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    public class MusiiNativeBridge {
        @JavascriptInterface
        public void playStream(String streamUrl, String title, String artist, String coverUrl, double durationSec) {
            Log.d(TAG, "playStream called: " + title + " by " + artist);
            requestNotificationPermission();
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_PLAY_STREAM);
            intent.putExtra(MusiiMediaService.EXTRA_STREAM_URL, streamUrl);
            intent.putExtra(MusiiMediaService.EXTRA_TITLE, title);
            intent.putExtra(MusiiMediaService.EXTRA_ARTIST, artist);
            intent.putExtra(MusiiMediaService.EXTRA_COVER_URL, coverUrl);
            intent.putExtra(MusiiMediaService.EXTRA_DURATION, (long)(durationSec * 1000));
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent);
                } else {
                    startService(intent);
                }
            } catch (Exception e) {
                Log.e(TAG, "playStream: Failed to start service - " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void pauseAudio() {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_PAUSE);
            try {
                startService(intent);
            } catch (Exception e) {
                Log.e(TAG, "pauseAudio: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void resumeAudio() {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_PLAY);
            try {
                startService(intent);
            } catch (Exception e) {
                Log.e(TAG, "resumeAudio: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void seekAudio(double seconds) {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_SEEK);
            intent.putExtra(MusiiMediaService.EXTRA_POSITION, (long)(seconds * 1000));
            try {
                startService(intent);
            } catch (Exception e) {
                Log.e(TAG, "seekAudio: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void updateNotification(String title, String artist, boolean isPlaying, String coverUrl) {
            updateNotification(title, artist, isPlaying, coverUrl, 210.0, 0.0);
        }

        @JavascriptInterface
        public void updateNotification(String title, String artist, boolean isPlaying, String coverUrl, double durationSec, double currentPosSec) {
            requestNotificationPermission();
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_UPDATE);
            intent.putExtra(MusiiMediaService.EXTRA_TITLE, title);
            intent.putExtra(MusiiMediaService.EXTRA_ARTIST, artist);
            intent.putExtra(MusiiMediaService.EXTRA_IS_PLAYING, isPlaying);
            intent.putExtra(MusiiMediaService.EXTRA_COVER_URL, coverUrl);
            intent.putExtra(MusiiMediaService.EXTRA_DURATION, (long)(durationSec * 1000));
            intent.putExtra(MusiiMediaService.EXTRA_POSITION, (long)(currentPosSec * 1000));
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent);
                } else {
                    startService(intent);
                }
            } catch (Exception e) {
                Log.e(TAG, "updateNotification: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void stopNotification() {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_STOP);
            try {
                startService(intent);
            } catch (Exception e) {
                Log.e(TAG, "stopNotification: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }
    }
}
