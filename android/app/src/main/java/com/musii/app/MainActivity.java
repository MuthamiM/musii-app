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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;

        // Request POST_NOTIFICATIONS permission on Android 13+
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

        setupWebView();
    }

    private void setupWebView() {
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Register native bridge for media notification
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
        // Do not pause webview timers to keep audio streaming in the background
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
        public void updateNotification(String title, String artist, boolean isPlaying, String coverUrl) {
            Intent intent = new Intent(MainActivity.this, MusiiMediaService.class);
            intent.setAction(MusiiMediaService.ACTION_UPDATE);
            intent.putExtra(MusiiMediaService.EXTRA_TITLE, title);
            intent.putExtra(MusiiMediaService.EXTRA_ARTIST, artist);
            intent.putExtra(MusiiMediaService.EXTRA_IS_PLAYING, isPlaying);
            intent.putExtra(MusiiMediaService.EXTRA_COVER_URL, coverUrl);
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
