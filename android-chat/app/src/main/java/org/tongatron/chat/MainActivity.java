package org.tongatron.chat;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowManager;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "ChatApp";
    private static final String APP_VERSION = "1.1";
    private static final String CHAT_URL = "https://chat.tongatron.org/chat";
    private static final String CHANNEL_ID = "chat_messages";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;
    private static final String PREFS_NAME = "chat_prefs";
    private static final String KEY_FCM_TOKEN = "fcm_token";

    public static boolean isActive = false;

    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        getWindow().setStatusBarColor(0xFF3B82F6);

        webView = new WebView(this);
        setContentView(webView);

        setupWebView();
        createNotificationChannel();
        requestNotificationPermission();
        initFCM();

        webView.loadUrl(CHAT_URL);
    }

    private void initFCM() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                Log.w(TAG, "FCM token failed", task.getException());
                return;
            }
            String token = task.getResult();
            Log.d(TAG, "FCM Token: " + token);
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
        });
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " ChatTongatronApp/" + APP_VERSION);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Add JavaScript bridge
        webView.addJavascriptInterface(new ChatBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.contains("tongatron.org")) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject FCM token into the page
                injectFCMToken();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileUploadCallback != null) fileUploadCallback.onReceiveValue(null);
                fileUploadCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
    }

    private void injectFCMToken() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(KEY_FCM_TOKEN, null);
        if (token != null) {
            String js = "window.__FCM_TOKEN__ = '" + token + "'; " +
                    "if (window.__onFCMToken) window.__onFCMToken('" + token + "');";
            webView.evaluateJavascript(js, null);
            Log.d(TAG, "Injected FCM token into WebView");
        }
    }

    // JavaScript bridge accessible from WebView
    class ChatBridge {
        @JavascriptInterface
        public String getFCMToken() {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            return prefs.getString(KEY_FCM_TOKEN, "");
        }

        @JavascriptInterface
        public boolean isApp() {
            return true;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Messaggi Chat", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Notifiche nuovi messaggi");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{100, 50, 100});
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        NOTIFICATION_PERMISSION_REQUEST);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                }
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        isActive = true;
        webView.onResume();
    }

    @Override
    protected void onPause() {
        isActive = false;
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
