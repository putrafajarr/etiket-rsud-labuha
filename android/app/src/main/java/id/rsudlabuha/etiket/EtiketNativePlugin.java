package id.rsudlabuha.etiket;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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
            if (!lower.contains("://localhost") && !lower.contains("://127.0.0.1") && !lower.contains("workers.dev")) {
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

