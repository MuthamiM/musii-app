package com.musii.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static MainActivity activeInstance = null;

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

        // Ensure POST_NOTIFICATIONS is requested on launch for Android 13+ (Samsung One UI 5+)
        requestNotificationPermission();
        setupWebView();
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

    private void setupWebView() {
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);

            // Register native bridge for background audio & media notifications
            webView.addJavascriptInterface(new MusiiNativeBridge(), "MusiiNative");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        activeInstance = this;
        setupWebView();
    }

    @Override
    public void onPause() {
        // Keep webview running continuously so background audio playback never stops on Samsung devices
        super.onPause();
    }

    @Override
    public void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    public class MusiiNativeBridge {
        @JavascriptInterface
        public void playStream(String streamUrl, String title, String artist, String coverUrl, double durationSec) {
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
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void pauseAudio() {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_PAUSE);
            try {
                startService(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void resumeAudio() {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_PLAY);
            try {
                startService(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void seekAudio(double seconds) {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_SEEK);
            intent.putExtra(MusiiMediaService.EXTRA_POSITION, (long)(seconds * 1000));
            try {
                startService(intent);
            } catch (Exception ignored) {
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
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void stopNotification() {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_STOP);
            try {
                startService(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }
    }
}
