package id.rsudlabuha.etiket;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

public class TicketMonitorService extends Service {

    private static final String TAG = "EtiketMonitorService";
    public static final String PREFS_NAME = "etiket_prefs";
    public static final String KEY_SERVER_URL = "server_url";
    public static final String KEY_MONITOR_ENABLED = "monitor_enabled";
    public static final String KEY_LAST_SEEN_ID = "last_seen_id";
    public static final String KEY_LAST_NOTIFIED_ID = "last_notified_id";

    public static final String CHANNEL_BG_ID = "etiket_monitor_bg_v1";
    public static final String CHANNEL_ALERT_ID = "etiket_urgent_alerts_v2";
    private static final int FOREGROUND_ID = 9001;
    private static final long POLL_INTERVAL_MS = 4500L;

    public static final String ACTION_START_MONITOR = "id.rsudlabuha.etiket.ACTION_START";
    public static final String ACTION_STOP_MONITOR = "id.rsudlabuha.etiket.ACTION_STOP";
    public static final String ACTION_TEST_NOTIFICATION = "id.rsudlabuha.etiket.ACTION_TEST";

    private volatile boolean isRunning = false;
    private Thread pollerThread = null;
    private Handler mainHandler;

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        ensureChannels(this);
        enterForegroundSafe();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannels(this);
        enterForegroundSafe();

        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP_MONITOR.equals(action)) {
                stopMonitorLoop();
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }
            if (ACTION_TEST_NOTIFICATION.equals(action)) {
                long delayMs = intent.getLongExtra("delayMs", 0L);
                if (delayMs > 0) {
                    mainHandler.postDelayed(() -> fireSampleTestNotification(this), delayMs);
                } else {
                    fireSampleTestNotification(this);
                }
            }
        }

        startMonitorLoop();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopMonitorLoop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void enterForegroundSafe() {
        try {
            Notification ongoing = buildOngoingNotification(this);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(FOREGROUND_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(FOREGROUND_ID, ongoing);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed startForeground: " + e.getMessage());
        }
    }

    private synchronized void startMonitorLoop() {
        if (isRunning && pollerThread != null && pollerThread.isAlive()) {
            return;
        }
        isRunning = true;
        pollerThread = new Thread(() -> {
            while (isRunning) {
                try {
                    checkServerForNewTickets();
                } catch (Exception e) {
                    Log.d(TAG, "Poll cycle error: " + e.getMessage());
                }
                try {
                    Thread.sleep(POLL_INTERVAL_MS);
                } catch (InterruptedException ie) {
                    break;
                }
            }
        }, "EtiketTicketPoller");
        pollerThread.setDaemon(true);
        pollerThread.start();
    }

    private synchronized void stopMonitorLoop() {
        isRunning = false;
        if (pollerThread != null) {
            pollerThread.interrupt();
            pollerThread = null;
        }
    }

    private void checkServerForNewTickets() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(KEY_MONITOR_ENABLED, true);
        if (!enabled) {
            return;
        }

        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        int lastSeenId = prefs.getInt(KEY_LAST_SEEN_ID, -1);

        if (serverUrl == null || serverUrl.trim().isEmpty()) {
            pollSupabaseDirectFallback(lastSeenId);
            return;
        }
        serverUrl = serverUrl.trim();
        if (serverUrl.endsWith("/")) {
            serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
        }

        String endpoint = lastSeenId >= 0
            ? serverUrl + "/api/tickets/latest-alert?sinceId=" + lastSeenId
            : serverUrl + "/api/tickets/latest-alert";

        HttpURLConnection conn = null;
        try {
            URL url = new URL(endpoint);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setUseCaches(false);

            int code = conn.getResponseCode();
            if (code != 200) {
                pollSupabaseDirectFallback(lastSeenId);
                return;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();

            JSONObject json = new JSONObject(sb.toString());
            int latestId = json.optInt("latestId", 0);

            if (lastSeenId < 0) {
                // First initialization: record baseline latestId without spamming old tickets
                prefs.edit().putInt(KEY_LAST_SEEN_ID, latestId).apply();
                return;
            }

            JSONArray newTickets = json.optJSONArray("newTickets");
            if (newTickets != null && newTickets.length() > 0) {
                int maxSeen = lastSeenId;
                for (int i = 0; i < newTickets.length(); i++) {
                    JSONObject t = newTickets.optJSONObject(i);
                    if (t == null) continue;
                    int id = t.optInt("id", 0);
                    if (id > maxSeen) {
                        maxSeen = id;
                    }
                    String ticketNo = t.optString("ticket_no", "");
                    String roomName = t.optString("room_name", "Ruangan RSUD");
                    String title = t.optString("title", "Laporan Kendala IT Baru");
                    String reporter = t.optString("reporter_name", "Staf RSUD");
                    String priority = t.optString("priority", "medium");

                    showTicketNotification(this, id, ticketNo, roomName, title, reporter, priority);
                }
                prefs.edit().putInt(KEY_LAST_SEEN_ID, Math.max(latestId, maxSeen)).apply();
            } else if (latestId > lastSeenId) {
                prefs.edit().putInt(KEY_LAST_SEEN_ID, latestId).apply();
            }
        } catch (Exception e) {
            Log.d(TAG, "Fetch failed (" + endpoint + "): " + e.getMessage() + ", trying Supabase direct...");
            pollSupabaseDirectFallback(lastSeenId);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void pollSupabaseDirectFallback(int lastSeenId) {
        String supaUrl = "https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/tickets?select=id,ticket_no,room_name,title,reporter_name,priority&order=id.desc&limit=10";
        String anonKey = "sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6";
        HttpURLConnection conn = null;
        try {
            URL url = new URL(supaUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("apikey", anonKey);
            conn.setRequestProperty("Authorization", "Bearer " + anonKey);
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3500);
            conn.setUseCaches(false);

            if (conn.getResponseCode() != 200) {
                return;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();

            JSONArray tickets = new JSONArray(sb.toString());
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (lastSeenId < 0) {
                int highest = 0;
                for (int i = 0; i < tickets.length(); i++) {
                    JSONObject t = tickets.optJSONObject(i);
                    if (t != null && t.optInt("id", 0) > highest) {
                        highest = t.optInt("id", 0);
                    }
                }
                prefs.edit().putInt(KEY_LAST_SEEN_ID, highest).apply();
                return;
            }

            int maxSeen = lastSeenId;
            for (int i = 0; i < tickets.length(); i++) {
                JSONObject t = tickets.optJSONObject(i);
                if (t == null) continue;
                int id = t.optInt("id", 0);
                if (id > lastSeenId) {
                    if (id > maxSeen) {
                        maxSeen = id;
                    }
                    String ticketNo = t.optString("ticket_no", "");
                    String roomName = t.optString("room_name", "Ruangan RSUD");
                    String title = t.optString("title", "Laporan Kendala IT Baru");
                    String reporter = t.optString("reporter_name", "Staf RSUD");
                    String priority = t.optString("priority", "medium");

                    showTicketNotification(this, id, ticketNo, roomName, title, reporter, priority);
                }
            }
            if (maxSeen > lastSeenId) {
                prefs.edit().putInt(KEY_LAST_SEEN_ID, maxSeen).apply();
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel bgChannel = new NotificationChannel(
                CHANNEL_BG_ID,
                "Status Pemantauan E-Tiket",
                NotificationManager.IMPORTANCE_LOW
            );
            bgChannel.setDescription("Menjaga aplikasi siap menerima laporan masuk di latar belakang");
            bgChannel.setShowBadge(false);
            bgChannel.enableVibration(false);
            bgChannel.setSound(null, null);
            nm.createNotificationChannel(bgChannel);

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ALERT_ID,
                "Tiket Masuk & Peringatan Darurat IT",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Notifikasi banner beranda HP & layar kunci saat ada laporan kendala baru");
            alertChannel.enableLights(true);
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 400, 200, 400});
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            alertChannel.setShowBadge(true);
            alertChannel.setSound(soundUri, audioAttrs);
            nm.createNotificationChannel(alertChannel);
        }
    }

    private static Notification buildOngoingNotification(Context ctx) {
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pendingIntent = PendingIntent.getActivity(ctx, 1, openIntent, flags);

        return new NotificationCompat.Builder(ctx, CHANNEL_BG_ID)
            .setSmallIcon(R.drawable.ic_stat_etiket)
            .setContentTitle("SIM-ETIKET IT RSUD Labuha")
            .setContentText("Aktif memantau laporan kendala masuk...")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pendingIntent)
            .build();
    }

    public static synchronized void showTicketNotification(
        Context ctx,
        int ticketId,
        String ticketNo,
        String roomName,
        String title,
        String reporterName,
        String priority
    ) {
        ensureChannels(ctx);

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        int lastNotifiedId = prefs.getInt(KEY_LAST_NOTIFIED_ID, 0);
        if (ticketId > 0 && ticketId <= lastNotifiedId) {
            return;
        }
        if (ticketId > 0) {
            int currentSeen = prefs.getInt(KEY_LAST_SEEN_ID, -1);
            SharedPreferences.Editor editor = prefs.edit();
            editor.putInt(KEY_LAST_NOTIFIED_ID, ticketId);
            if (ticketId > currentSeen) {
                editor.putInt(KEY_LAST_SEEN_ID, ticketId);
            }
            editor.apply();
        }

        boolean isUrgent = "critical".equalsIgnoreCase(priority) || "high".equalsIgnoreCase(priority);
        String prefix = "critical".equalsIgnoreCase(priority) ? "🚨 KRITIS: " : (isUrgent ? "⚠️ TINGGI: " : "🎫 Tiket Baru: ");
        String notifTitle = prefix + roomName;
        String bodyText = title + " • Pelapor: " + reporterName + (ticketNo != null && !ticketNo.isEmpty() ? " (" + ticketNo + ")" : "");

        dispatchNotification(ctx, 10000 + ticketId, notifTitle, bodyText, isUrgent);
    }

    public static void fireSampleTestNotification(Context ctx) {
        ensureChannels(ctx);
        int uniqueId = (int) (System.currentTimeMillis() % 100000) + 50000;
        dispatchNotification(
            ctx,
            uniqueId,
            "🔔 TES BERHASIL: SIM-ETIKET RSUD LABUHA",
            "Notifikasi beranda HP & layar kunci sudah aktif! Laporan dokter/perawat akan langsung tampil seperti ini.",
            true
        );
    }

    private static void dispatchNotification(Context ctx, int notifId, String title, String body, boolean highPriority) {
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pendingIntent = PendingIntent.getActivity(ctx, notifId, openIntent, flags);

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ALERT_ID)
            .setSmallIcon(R.drawable.ic_stat_etiket)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(highPriority ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setSound(soundUri)
            .setVibrate(new long[]{0, 400, 200, 400})
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        try {
            NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
            nm.notify(notifId, builder.build());
        } catch (SecurityException se) {
            Log.e(TAG, "POST_NOTIFICATIONS permission denied: " + se.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Notify error: " + e.getMessage());
        }
    }
}

