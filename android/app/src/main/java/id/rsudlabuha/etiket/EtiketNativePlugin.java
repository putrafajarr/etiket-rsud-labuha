package id.rsudlabuha.etiket;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.core.content.pm.PackageInfoCompat;
import android.net.Uri;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;

@CapacitorPlugin(
    name = "EtiketNative",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class EtiketNativePlugin extends Plugin {

    @PluginMethod
    public void configure(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        Boolean monitorEnabled = call.getBoolean("monitorEnabled");

        SharedPreferences prefs = getContext().getSharedPreferences(TicketMonitorService.PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        if (serverUrl != null && !serverUrl.trim().isEmpty()) {
            String lower = serverUrl.trim().toLowerCase();
            if (!lower.contains("://localhost") && !lower.contains("://127.0.0.1")) {
                editor.putString(TicketMonitorService.KEY_SERVER_URL, serverUrl.trim());
            }
        }
        if (monitorEnabled != null) {
            editor.putBoolean(TicketMonitorService.KEY_MONITOR_ENABLED, monitorEnabled);
        }
        editor.apply();

        boolean shouldMonitor = prefs.getBoolean(TicketMonitorService.KEY_MONITOR_ENABLED, true);
        startOrStopMonitorService(shouldMonitor);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("serverUrl", prefs.getString(TicketMonitorService.KEY_SERVER_URL, ""));
        ret.put("monitorEnabled", shouldMonitor);
        call.resolve(ret);
    }

    @PluginMethod
    public void setMonitorEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        SharedPreferences prefs = getContext().getSharedPreferences(TicketMonitorService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(TicketMonitorService.KEY_MONITOR_ENABLED, enabled).apply();
        startOrStopMonitorService(enabled);

        JSObject ret = new JSObject();
        ret.put("monitorEnabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void notifyTicketNow(PluginCall call) {
        int id = call.getInt("id", 0);
        String ticketNo = call.getString("ticketNo", "");
        String roomName = call.getString("roomName", "Ruangan RSUD");
        String title = call.getString("title", "Laporan Kendala IT");
        String reporter = call.getString("reporterName", "Staf RSUD");
        String priority = call.getString("priority", "medium");

        TicketMonitorService.showTicketNotification(getContext(), id, ticketNo, roomName, title, reporter, priority);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void notifyEventNow(PluginCall call) {
        int ticketId = call.getInt("ticketId", call.getInt("id", 0));
        String eventType = call.getString("eventType", "status");
        String status = call.getString("status", "");
        int assignedTo = call.getInt("assignedTo", 0);
        String title = call.getString("title", "Pembaruan Tiket IT");
        String body = call.getString("body", "Ada pembaruan status tiket.");
        boolean highPriority = Boolean.TRUE.equals(call.getBoolean("highPriority", true));

        TicketMonitorService.showEventNotification(
            getContext(),
            ticketId,
            eventType,
            status,
            assignedTo,
            title,
            body,
            highPriority
        );

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void testNotification(PluginCall call) {
        long delayMs = call.getInt("delayMs", 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "onTestPermissionCallback");
            return;
        }
        triggerTestViaService(delayMs);
        JSObject ret = new JSObject();
        ret.put("scheduled", true);
        ret.put("delayMs", delayMs);
        call.resolve(ret);
    }

    @PermissionCallback
    private void onTestPermissionCallback(PluginCall call) {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            long delayMs = call.getInt("delayMs", 0);
            triggerTestViaService(delayMs);
            JSObject ret = new JSObject();
            ret.put("scheduled", true);
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            JSObject ret = new JSObject();
            ret.put("scheduled", false);
            ret.put("granted", false);
            call.resolve(ret);
        }
    }

    private void triggerTestViaService(long delayMs) {
        if (delayMs > 0) {
            try {
                Intent svc = new Intent(getContext(), TicketMonitorService.class);
                svc.setAction(TicketMonitorService.ACTION_TEST_NOTIFICATION);
                svc.putExtra("delayMs", delayMs);
                ContextCompat.startForegroundService(getContext(), svc);
                return;
            } catch (Exception ignored) {}
        }
        TicketMonitorService.fireSampleTestNotification(getContext());
    }

    @PluginMethod
    public void checkStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(TicketMonitorService.PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        boolean permGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED;

        JSObject ret = new JSObject();
        ret.put("notificationsEnabled", enabled);
        ret.put("permissionGranted", permGranted);
        ret.put("monitorEnabled", prefs.getBoolean(TicketMonitorService.KEY_MONITOR_ENABLED, true));
        ret.put("serverUrl", prefs.getString(TicketMonitorService.KEY_SERVER_URL, ""));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
            JSObject ret = new JSObject();
            ret.put("granted", enabled);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "onPermissionCallback");
    }

    @PermissionCallback
    private void onPermissionCallback(PluginCall call) {
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if (enabled) {
            startOrStopMonitorService(true);
        }
        JSObject ret = new JSObject();
        ret.put("granted", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                }
                getActivity().startActivity(intent);
            } catch (Exception ignored) {}
        });
        call.resolve();
    }

    @PluginMethod
    public void promptServerUrl(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).showServerUrlDialog();
        }
        call.resolve();
    }

    @PluginMethod
    public void exportBase64File(PluginCall call) {
        String rawName = call.getString("filename", "export.xlsx");
        String safeName = new File(rawName != null ? rawName : "export.xlsx").getName();
        String base64 = call.getString("base64", "");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (base64 == null || base64.isEmpty()) {
            call.reject("Data file kosong");
            return;
        }
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File outFile = new File(getContext().getCacheDir(), safeName);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(bytes);
                fos.flush();
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                outFile
            );
            getActivity().runOnUiThread(() -> {
                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(uri, mimeType);
                viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, "Simpan atau Bagikan " + safeName);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { viewIntent });
                getActivity().startActivity(chooser);
            });
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("filename", safeName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Gagal mengekspor file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html", "");
        String title = call.getString("title", "Dokumen SIM-ETIKET RSUD Labuha");
        if (html == null || html.trim().isEmpty()) {
            call.reject("Konten cetak kosong");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                WebView printWebView = new WebView(getActivity());
                printWebView.getSettings().setJavaScriptEnabled(false);
                printWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        if (pm != null) {
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(title);
                            pm.print(title, adapter, new PrintAttributes.Builder().build());
                        }
                    }
                });
                printWebView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
                call.resolve();
            } catch (Exception e) {
                call.reject("Gagal membuka pencetakan: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void shareToWhatsApp(PluginCall call) {
        String phone = call.getString("phone", "");
        String message = call.getString("message", "");
        String imageBase64 = call.getString("imageBase64", "");
        String mimeType = call.getString("mimeType", "image/jpeg");
        String rawName = call.getString("filename", "bukti-etiket.jpg");

        if (imageBase64 == null || imageBase64.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no_image");
            call.resolve(ret);
            return;
        }

        try {
            String pureBase64 = imageBase64.contains(",") ? imageBase64.substring(imageBase64.indexOf(',') + 1) : imageBase64;
            byte[] bytes = Base64.decode(pureBase64, Base64.DEFAULT);
            String safeName = new File(rawName != null && !rawName.isEmpty() ? rawName : "bukti-etiket.jpg").getName();
            File outFile = new File(getContext().getCacheDir(), safeName);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(bytes);
                fos.flush();
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                outFile
            );

            String digits = phone != null ? phone.replaceAll("\\D+", "") : "";
            if (digits.startsWith("0")) {
                digits = "62" + digits.substring(1);
            } else if (digits.startsWith("8") && digits.length() >= 8) {
                digits = "62" + digits;
            }
            final String cleanPhone = digits;
            final String safeMime = (mimeType != null && mimeType.startsWith("image/")) ? mimeType : "image/*";
            final String finalMsg = message != null ? message : "";

            getActivity().runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.putExtra(Intent.EXTRA_TEXT, finalMsg);
                intent.setClipData(ClipData.newRawUri("Lampiran Bukti", uri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                if (cleanPhone.length() >= 8) {
                    intent.putExtra("jid", cleanPhone + "@s.whatsapp.net");
                }

                String launchedPkg = null;
                PackageManager pm = getContext().getPackageManager();
                String[] candidates = new String[] { "com.whatsapp", "com.whatsapp.w4b" };
                for (String pkg : candidates) {
                    try {
                        pm.getPackageInfo(pkg, 0);
                        getContext().grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        Intent pkgIntent = new Intent(intent);
                        pkgIntent.setPackage(pkg);
                        getActivity().startActivity(pkgIntent);
                        launchedPkg = pkg;
                        break;
                    } catch (PackageManager.NameNotFoundException | ActivityNotFoundException ignored) {
                    } catch (Exception ex) {
                        // Retry same package cleanly without undocumented jid extra if OEM/WA rejects it
                        try {
                            Intent fallbackPkgIntent = new Intent(Intent.ACTION_SEND);
                            fallbackPkgIntent.setType(safeMime);
                            fallbackPkgIntent.putExtra(Intent.EXTRA_STREAM, uri);
                            fallbackPkgIntent.putExtra(Intent.EXTRA_TEXT, finalMsg);
                            fallbackPkgIntent.setClipData(ClipData.newRawUri("Lampiran Bukti", uri));
                            fallbackPkgIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            fallbackPkgIntent.setPackage(pkg);
                            getActivity().startActivity(fallbackPkgIntent);
                            launchedPkg = pkg;
                            break;
                        } catch (Exception ignored2) {
                        }
                    }
                }

                if (launchedPkg == null) {
                    Intent chooserBase = new Intent(Intent.ACTION_SEND);
                    chooserBase.setType("image/*");
                    chooserBase.putExtra(Intent.EXTRA_STREAM, uri);
                    chooserBase.putExtra(Intent.EXTRA_TEXT, finalMsg);
                    chooserBase.setClipData(ClipData.newRawUri("Lampiran Bukti", uri));
                    chooserBase.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent chooser = Intent.createChooser(chooserBase, "Kirim Foto & Penjelasan via WhatsApp");
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(chooser);
                    launchedPkg = "chooser";
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("targetPackage", launchedPkg);
                call.resolve(ret);
            });
        } catch (Exception e) {
            call.reject("Gagal membagikan gambar ke WhatsApp: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(getContext().getPackageName(), 0);
            long versionCode = PackageInfoCompat.getLongVersionCode(pInfo);
            ret.put("packageName", getContext().getPackageName());
            ret.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.5");
            ret.put("versionCode", versionCode);
            ret.put("hasWhatsAppPhotoShare", true);
        } catch (Exception e) {
            ret.put("packageName", getContext().getPackageName());
            ret.put("versionName", "1.5");
            ret.put("versionCode", 6);
            ret.put("hasWhatsAppPhotoShare", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openApkUpdateUrl(PluginCall call) {
        String url = call.getString("url", MainActivity.DEFAULT_CLOUD_WEB_URL + "/downloads/ETIKET-RSUD-LABUHA.apk");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL APK kosong");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Gagal membuka tautan APK: " + e.getMessage());
            }
        });
    }

    private void startOrStopMonitorService(boolean enable) {
        try {
            Intent svc = new Intent(getContext(), TicketMonitorService.class);
            if (enable) {
                svc.setAction(TicketMonitorService.ACTION_START_MONITOR);
                ContextCompat.startForegroundService(getContext(), svc);
            } else {
                svc.setAction(TicketMonitorService.ACTION_STOP_MONITOR);
                getContext().startService(svc);
            }
        } catch (Exception ignored) {}
    }
}

