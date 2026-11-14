package id.rsudlabuha.etiket;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.content.ContextCompat;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            SharedPreferences prefs = context.getSharedPreferences(TicketMonitorService.PREFS_NAME, Context.MODE_PRIVATE);
            boolean enabled = prefs.getBoolean(TicketMonitorService.KEY_MONITOR_ENABLED, true);
            if (enabled) {
                try {
                    Intent svc = new Intent(context, TicketMonitorService.class);
                    svc.setAction(TicketMonitorService.ACTION_START_MONITOR);
                    ContextCompat.startForegroundService(context, svc);
                } catch (Exception ignored) {}
            }
        }
    }
}

