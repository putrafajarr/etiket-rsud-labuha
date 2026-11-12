package id.rsudlabuha.etiket;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
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
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final int REQ_NOTIF_PERM = 1001;
    private static final String[] KNOWN_FALLBACK_URLS = new String[] {
        "http://192.168.0.235:3000",
        "http://192.168.1.9:3000"
    };

    private volatile boolean isCheckingFallback = false;
    private volatile boolean dialogShownThisSession = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EtiketNativePlugin.class);
        super.onCreate(savedInstanceState);

        TicketMonitorService.ensureChannels(this);
        requestNotificationPermissionIfNeeded();
        startBackgroundMonitorIfEnabled();
    }

    @Override
    protected void load() {
        CapConfig defaultConfig = CapConfig.loadDefault(this);
        SharedPreferences prefs = getSharedPreferences(TicketMonitorService.PREFS_NAME, MODE_PRIVATE);
        String savedUrl = prefs.getString(TicketMonitorService.KEY_SERVER_URL, null);
        String activeUrl = (savedUrl != null && !savedUrl.trim().isEmpty())
            ? savedUrl.trim()
            : defaultConfig.getServerUrl();

        if (activeUrl != null && !activeUrl.isEmpty() && (savedUrl == null || savedUrl.trim().isEmpty())) {
            prefs.edit().putString(TicketMonitorService.KEY_SERVER_URL, activeUrl).apply();
        }

        this.config = new CapConfig.Builder(this)
            .setServerUrl(activeUrl)
            .setAllowMixedContent(true)
            .setCaptureInput(true)
            .setWebContentsDebuggingEnabled(true)
            .setAndroidScheme("http")
            .create();

        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onReceivedError(WebView webView) {
                checkServerConnectivityAndRecover();
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
                String currentUrl = prefs.getString(TicketMonitorService.KEY_SERVER_URL, "");
                if (isServerReachable(currentUrl)) {
                    // Server is alive; error was only a missing external CDN script on offline LAN
                    return;
                }

                // Try fallback local IPs
                List<String> candidates = Arrays.asList(KNOWN_FALLBACK_URLS);
                for (String candidate : candidates) {
                    if (!candidate.equals(currentUrl) && isServerReachable(candidate)) {
                        prefs.edit().putString(TicketMonitorService.KEY_SERVER_URL, candidate).apply();
                        runOnUiThread(() -> recreate());
                        return;
                    }
                }

                // None reachable: offer quick Server IP/Domain dialog
                dialogShownThisSession = true;
                runOnUiThread(this::showServerUrlDialog);
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
            URL url = new URL(clean + "/api/tickets/latest-alert");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(1500);
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
            String currentUrl = prefs.getString(TicketMonitorService.KEY_SERVER_URL, "http://192.168.0.235:3000");

            final EditText input = new EditText(this);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            input.setText(currentUrl);
            int pad = (int) (16 * getResources().getDisplayMetrics().density);
            input.setPadding(pad, pad, pad, pad);

            new AlertDialog.Builder(this)
                .setTitle("Alamat Server E-Tiket RSUD")
                .setMessage("Masukkan alamat IP server lokal atau domain RSUD Labuha:")
                .setView(input)
                .setPositiveButton("Simpan & Hubungkan", (dialog, which) -> {
                    String nextUrl = input.getText().toString().trim();
                    if (!nextUrl.isEmpty()) {
                        if (!nextUrl.startsWith("http://") && !nextUrl.startsWith("https://")) {
                            nextUrl = "http://" + nextUrl;
                        }
                        prefs.edit().putString(TicketMonitorService.KEY_SERVER_URL, nextUrl).apply();
                        startBackgroundMonitorIfEnabled();
                        recreate();
                    }
                })
                .setNegativeButton("Tutup", null)
                .show();
        });
    }
}
