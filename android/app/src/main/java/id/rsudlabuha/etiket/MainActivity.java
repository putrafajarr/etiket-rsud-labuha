package id.rsudlabuha.etiket;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.WebViewListener;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {

    public static final String DEFAULT_CLOUD_WEB_URL = "https://etiket-rsud-labuha.etiket-itrsudlabuha.workers.dev";
    private static final int REQ_NOTIF_PERM = 1001;
    private static final String KEY_CONFIG_VERSION = "config_version";
    private static final int TARGET_CONFIG_VERSION = 5;

    private static volatile boolean sessionOfflineFallback = false;
    private volatile boolean isCheckingFallback = false;
    private volatile boolean dialogShownThisSession = false;
    private volatile boolean pendingCacheClearOnLoad = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EtiketNativePlugin.class);
        super.onCreate(savedInstanceState);

        TicketMonitorService.ensureChannels(this);
        requestNotificationPermissionIfNeeded();
        startBackgroundMonitorIfEnabled();
    }

    private boolean isLegacyOrBundledUrl(String url) {
        if (url == null || url.trim().isEmpty()) return false;
        String lower = url.trim().toLowerCase();
        return lower.contains("192.168.")
            || lower.contains("trycloudflare.com")
            || lower.contains("://localhost")
            || lower.contains("://127.0.0.1");
    }

    @Override
    protected void load() {
        SharedPreferences prefs = getSharedPreferences(TicketMonitorService.PREFS_NAME, MODE_PRIVATE);
        int configVersion = prefs.getInt(KEY_CONFIG_VERSION, 0);
        String savedUrl = prefs.getString(TicketMonitorService.KEY_SERVER_URL, "");

        // Default to live workers.dev URL so web updates reflect automatically in the APK
        if (configVersion < TARGET_CONFIG_VERSION || savedUrl == null || savedUrl.trim().isEmpty() || isLegacyOrBundledUrl(savedUrl)) {
            savedUrl = DEFAULT_CLOUD_WEB_URL;
            prefs.edit()
                .putString(TicketMonitorService.KEY_SERVER_URL, savedUrl)
                .putInt(KEY_CONFIG_VERSION, TARGET_CONFIG_VERSION)
                .apply();
            if (configVersion < TARGET_CONFIG_VERSION) {
                pendingCacheClearOnLoad = true;
            }
        }

        final String customServerUrl = sessionOfflineFallback ? "" : savedUrl.trim();

        if (!customServerUrl.isEmpty()) {
            this.config = new CapConfig.Builder(this)
                .setServerUrl(customServerUrl)
                .setAllowMixedContent(true)
                .setCaptureInput(true)
                .setWebContentsDebuggingEnabled(true)
                .setAndroidScheme("https")
                .create();
        } else {
            // Temporary offline fallback: serve bundled local web assets over https://localhost
            this.config = new CapConfig.Builder(this)
                .setAllowMixedContent(true)
                .setCaptureInput(true)
                .setWebContentsDebuggingEnabled(true)
                .setAndroidScheme("https")
                .create();
        }

        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                if (webView != null && webView.getSettings() != null) {
                    WebSettings settings = webView.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setDomStorageEnabled(true);
                    settings.setDatabaseEnabled(true);
                    settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                    if (pendingCacheClearOnLoad) {
                        webView.clearCache(true);
                        pendingCacheClearOnLoad = false;
                    }
                }
            }

            @Override
            public void onReceivedError(WebView webView) {
                if (!customServerUrl.isEmpty()) {
                    checkServerConnectivityAndRecover();
                }
            }
        });

        super.load();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    REQ_NOTIF_PERM
                );
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF_PERM) {
            startBackgroundMonitorIfEnabled();
        }
    }

    private void startBackgroundMonitorIfEnabled() {
        SharedPreferences prefs = getSharedPreferences(TicketMonitorService.PREFS_NAME, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(TicketMonitorService.KEY_MONITOR_ENABLED, true);
        if (enabled) {
            try {
                Intent svc = new Intent(this, TicketMonitorService.class);
                svc.setAction(TicketMonitorService.ACTION_START_MONITOR);
                ContextCompat.startForegroundService(this, svc);
            } catch (Exception ignored) {}
        }
    }

    private void checkServerConnectivityAndRecover() {
        if (isCheckingFallback || dialogShownThisSession) return;
        isCheckingFallback = true;

        new Thread(() -> {
            try {
                SharedPreferences prefs = getSharedPreferences(TicketMonitorService.PREFS_NAME, MODE_PRIVATE);
                String currentUrl = prefs.getString(TicketMonitorService.KEY_SERVER_URL, DEFAULT_CLOUD_WEB_URL);
                if (currentUrl == null || currentUrl.trim().isEmpty() || sessionOfflineFallback || isServerReachable(currentUrl)) {
                    return;
                }

                // Temporary offline fallback in memory only; keep saved live URL for next launch
                sessionOfflineFallback = true;
                dialogShownThisSession = true;
                runOnUiThread(this::recreate);
            } finally {
                isCheckingFallback = false;
            }
        }).start();
    }

    private boolean isServerReachable(String baseUrl) {
        if (baseUrl == null || baseUrl.trim().isEmpty()) return false;
        String clean = baseUrl.trim();
        if (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
        HttpURLConnection conn = null;
        try {
            URL url = new URL(clean + "/manifest.json");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2000);
            conn.setRequestMethod("GET");
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    public void showServerUrlDialog() {
        runOnUiThread(() -> {
            SharedPreferences prefs = getSharedPreferences(TicketMonitorService.PREFS_NAME, MODE_PRIVATE);
            String currentUrl = prefs.getString(TicketMonitorService.KEY_SERVER_URL, DEFAULT_CLOUD_WEB_URL);

            final EditText input = new EditText(this);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            input.setHint(DEFAULT_CLOUD_WEB_URL);
            input.setText(currentUrl);
            int pad = (int) (16 * getResources().getDisplayMetrics().density);
            input.setPadding(pad, pad, pad, pad);

            new AlertDialog.Builder(this)
                .setTitle("Pengaturan Mode Server APK")
                .setMessage("Default menunjuk ke Cloud Live (workers.dev) agar aplikasi auto-update, atau masukkan URL server lokal RSUD:")
                .setView(input)
                .setPositiveButton("Simpan & Terapkan", (dialog, which) -> {
                    String nextUrl = input.getText().toString().trim();
                    if (nextUrl.isEmpty()) {
                        nextUrl = DEFAULT_CLOUD_WEB_URL;
                    } else if (!nextUrl.startsWith("http://") && !nextUrl.startsWith("https://")) {
                        nextUrl = "https://" + nextUrl;
                    }
                    sessionOfflineFallback = false;
                    pendingCacheClearOnLoad = true;
                    prefs.edit().putString(TicketMonitorService.KEY_SERVER_URL, nextUrl).apply();
                    startBackgroundMonitorIfEnabled();
                    recreate();
                })
                .setNeutralButton("Reset ke Live Cloud", (dialog, which) -> {
                    sessionOfflineFallback = false;
                    pendingCacheClearOnLoad = true;
                    prefs.edit().putString(TicketMonitorService.KEY_SERVER_URL, DEFAULT_CLOUD_WEB_URL).apply();
                    startBackgroundMonitorIfEnabled();
                    recreate();
                })
                .setNegativeButton("Tutup", null)
                .show();
        });
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.evaluateJavascript(
                "(function() { " +
                "  if (typeof window.handleAppBack === 'function') { return window.handleAppBack(); } " +
                "  return false; " +
                "})()",
                result -> {
                    if (!"true".equals(result)) {
                        if (wv.canGoBack()) {
                            wv.goBack();
                        } else {
                            MainActivity.super.onBackPressed();
                        }
                    }
                }
            );
        } else {
            super.onBackPressed();
        }
    }
}
