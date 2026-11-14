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
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class TicketMonitorService extends Service {

    private static final String TAG = "EtiketMonitorService";
    public static final String PREFS_NAME = "etiket_prefs";
    public static final String KEY_SERVER_URL = "server_url";
    public static final String KEY_MONITOR_ENABLED = "monitor_enabled";
    public static final String KEY_LAST_SEEN_ID = "last_seen_id";
    public static final String KEY_LAST_NOTIFIED_ID = "last_notified_id";
    public static final String KEY_TICKET_SNAPSHOTS = "ticket_snapshots_json";
    public static final String KEY_EVENT_DEDUP = "event_dedup_json";
    private static final Object SNAPSHOT_LOCK = new Object();

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
        String lowerServer = serverUrl.toLowerCase();
        if (lowerServer.contains("workers.dev") || lowerServer.contains("://localhost") || lowerServer.contains("://127.0.0.1")) {
            pollSupabaseDirectFallback(lastSeenId);
            return;
        }
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
            JSONArray recentTickets = json.optJSONArray("recentTickets");
            if (recentTickets != null && recentTickets.length() > 0) {
                processPolledTickets(recentTickets, lastSeenId);
                return;
            }

            if (lastSeenId < 0) {
                prefs.edit().putInt(KEY_LAST_SEEN_ID, latestId).apply();
                return;
            }

            JSONArray newTickets = json.optJSONArray("newTickets");
            if (newTickets != null && newTickets.length() > 0) {
                processPolledTickets(newTickets, lastSeenId);
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
        String supaUrl = "https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/tickets?select=id,ticket_no,room_name,title,reporter_name,priority,status,assigned_to,assigned_to_name,updated_at&order=updated_at.desc.nullslast,id.desc&limit=30";
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
            processPolledTickets(tickets, lastSeenId);
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static JSONObject parseJsonObjectSafe(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static String buildSnapshotValue(JSONObject t) {
        String status = t.optString("status", "open");
        if ("null".equalsIgnoreCase(status) || status.isEmpty()) status = "open";
        int assignedTo = t.optInt("assigned_to", 0);
        return status + "|" + assignedTo;
    }

    private static void pruneSnapshotMap(JSONObject snaps, int maxKeep) {
        if (snaps == null || snaps.length() <= maxKeep) return;
        List<Integer> ids = new ArrayList<>();
        Iterator<String> keys = snaps.keys();
        while (keys.hasNext()) {
            try {
                ids.add(Integer.parseInt(keys.next()));
            } catch (NumberFormatException ignored) {}
        }
        Collections.sort(ids);
        int removeCount = ids.size() - maxKeep;
        for (int i = 0; i < removeCount; i++) {
            snaps.remove(String.valueOf(ids.get(i)));
        }
    }

    private static void recordEventState(Context ctx, int ticketId, String status, int assignedTo) {
        if (ctx == null || ticketId <= 0) return;
        String safeStatus = (status == null || status.isEmpty() || "null".equalsIgnoreCase(status)) ? "open" : status;
        String snapVal = safeStatus + "|" + assignedTo;
        String dedupKey = ticketId + "|" + snapVal;
        long now = System.currentTimeMillis();

        synchronized (SNAPSHOT_LOCK) {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            JSONObject snaps = parseJsonObjectSafe(prefs.getString(KEY_TICKET_SNAPSHOTS, "{}"));
            JSONObject dedups = parseJsonObjectSafe(prefs.getString(KEY_EVENT_DEDUP, "{}"));
            try {
                snaps.put(String.valueOf(ticketId), snapVal);
                pruneSnapshotMap(snaps, 120);

                // Prune dedup entries older than 2 minutes
                List<String> stale = new ArrayList<>();
                Iterator<String> dk = dedups.keys();
                while (dk.hasNext()) {
                    String k = dk.next();
                    long ts = dedups.optLong(k, 0L);
                    if (now - ts > 120_000L) {
                        stale.add(k);
                    }
                }
                for (String s : stale) dedups.remove(s);
                dedups.put(dedupKey, now);
            } catch (Exception ignored) {}

            prefs.edit()
                .putString(KEY_TICKET_SNAPSHOTS, snaps.toString())
                .putString(KEY_EVENT_DEDUP, dedups.toString())
                .apply();
        }
    }

    private static boolean wasEventRecentlyDispatched(Context ctx, int ticketId, String status, int assignedTo) {
        if (ctx == null || ticketId <= 0) return false;
        String safeStatus = (status == null || status.isEmpty() || "null".equalsIgnoreCase(status)) ? "open" : status;
        String dedupKey = ticketId + "|" + safeStatus + "|" + assignedTo;
        long now = System.currentTimeMillis();

        synchronized (SNAPSHOT_LOCK) {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            JSONObject dedups = parseJsonObjectSafe(prefs.getString(KEY_EVENT_DEDUP, "{}"));
            long ts = dedups.optLong(dedupKey, 0L);
            return ts > 0 && (now - ts) <= 120_000L;
        }
    }

    private void processPolledTickets(JSONArray tickets, int lastSeenId) {
        if (tickets == null) return;
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        if (lastSeenId < 0) {
            int highest = 0;
            JSONObject initialSnaps = new JSONObject();
            for (int i = 0; i < tickets.length(); i++) {
                JSONObject t = tickets.optJSONObject(i);
                if (t == null) continue;
                int id = t.optInt("id", 0);
                if (id > highest) highest = id;
                if (id > 0) {
                    try {
                        initialSnaps.put(String.valueOf(id), buildSnapshotValue(t));
                    } catch (Exception ignored) {}
                }
            }
            pruneSnapshotMap(initialSnaps, 120);
            synchronized (SNAPSHOT_LOCK) {
                prefs.edit()
                    .putInt(KEY_LAST_SEEN_ID, highest)
                    .putString(KEY_TICKET_SNAPSHOTS, initialSnaps.toString())
                    .apply();
            }
            return;
        }

        final boolean hasSnapshotBaseline;
        final JSONObject snaps;
        synchronized (SNAPSHOT_LOCK) {
            hasSnapshotBaseline = prefs.contains(KEY_TICKET_SNAPSHOTS);
            snaps = parseJsonObjectSafe(prefs.getString(KEY_TICKET_SNAPSHOTS, "{}"));
        }

        int maxSeen = lastSeenId;
        // Iterate from oldest item in batch to newest
        for (int i = tickets.length() - 1; i >= 0; i--) {
            JSONObject t = tickets.optJSONObject(i);
            if (t == null) continue;
            int id = t.optInt("id", 0);
            if (id <= 0) continue;

            String ticketNo = t.optString("ticket_no", "");
            String roomName = t.optString("room_name", "Ruangan RSUD");
            String title = t.optString("title", "Laporan Kendala IT Baru");
            String reporter = t.optString("reporter_name", "Staf RSUD");
            String priority = t.optString("priority", "medium");
            String curStatus = t.optString("status", "open");
            if ("null".equalsIgnoreCase(curStatus) || curStatus.isEmpty()) curStatus = "open";
            int curAssignedTo = t.optInt("assigned_to", 0);
            String curAssignedName = t.optString("assigned_to_name", "");
            if ("null".equalsIgnoreCase(curAssignedName)) curAssignedName = "";

            String idKey = String.valueOf(id);
            String prevSnap = snaps.optString(idKey, "");

            if (id > lastSeenId) {
                if (id > maxSeen) maxSeen = id;
                if (!"resolved".equalsIgnoreCase(curStatus) && !"closed".equalsIgnoreCase(curStatus)) {
                    showTicketNotification(this, id, ticketNo, roomName, title, reporter, priority);
                }
            } else if (hasSnapshotBaseline && !prevSnap.isEmpty()) {
                String[] parts = prevSnap.split("\\|", -1);
                String prevStatus = parts.length > 0 ? parts[0] : "";
                int prevAssignedTo = 0;
                if (parts.length > 1) {
                    try {
                        prevAssignedTo = Integer.parseInt(parts[1]);
                    } catch (NumberFormatException ignored) {}
                }

                boolean wasDone = "resolved".equalsIgnoreCase(prevStatus) || "closed".equalsIgnoreCase(prevStatus);
                boolean isNowDone = "resolved".equalsIgnoreCase(curStatus) || "closed".equalsIgnoreCase(curStatus);

                if (isNowDone && !wasDone) {
                    if (!wasEventRecentlyDispatched(this, id, curStatus, curAssignedTo)) {
                        String who = !curAssignedName.isEmpty() ? curAssignedName : "Tim IT";
                        String body = (ticketNo.isEmpty() ? "" : ticketNo + " ") + "selesai dikerjakan oleh " + who + " • " + title;
                        showEventNotification(
                            this,
                            id,
                            "resolved",
                            curStatus,
                            curAssignedTo,
                            "✅ Tiket Selesai: " + roomName,
                            body.trim(),
                            true
                        );
                    }
                } else if (curAssignedTo > 0 && curAssignedTo != prevAssignedTo) {
                    if (!wasEventRecentlyDispatched(this, id, curStatus, curAssignedTo)) {
                        String who = !curAssignedName.isEmpty() ? curAssignedName : "Teknisi IT";
                        String body = (ticketNo.isEmpty() ? "" : ticketNo + " ") + "didisposisikan ke " + who + " • " + title;
                        showEventNotification(
                            this,
                            id,
                            "assigned",
                            curStatus,
                            curAssignedTo,
                            "👨‍🔧 Disposisi Tiket: " + roomName,
                            body.trim(),
                            true
                        );
                    }
                }
            }

            try {
                snaps.put(idKey, curStatus + "|" + curAssignedTo);
            } catch (Exception ignored) {}
        }

        pruneSnapshotMap(snaps, 120);
        synchronized (SNAPSHOT_LOCK) {
            SharedPreferences.Editor editor = prefs.edit().putString(KEY_TICKET_SNAPSHOTS, snaps.toString());
            if (maxSeen > lastSeenId) {
                editor.putInt(KEY_LAST_SEEN_ID, maxSeen);
            }
            editor.apply();
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
                "Tiket Baru, Disposisi & Selesai",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Notifikasi banner beranda HP & layar kunci untuk tiket baru, disposisi, dan selesai");
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

    public static synchronized void showEventNotification(
        Context ctx,
        int ticketId,
        String eventType,
        String status,
        int assignedTo,
        String notifTitle,
        String notifBody,
        boolean highPriority
    ) {
        ensureChannels(ctx);
        if (ticketId > 0) {
            recordEventState(ctx, ticketId, status, assignedTo);
        }

        int baseOffset = 40000;
        if ("resolved".equalsIgnoreCase(eventType) || "resolved".equalsIgnoreCase(status) || "closed".equalsIgnoreCase(status)) {
            baseOffset = 20000;
        } else if ("assigned".equalsIgnoreCase(eventType)) {
            baseOffset = 30000;
        }
        int safeId = ticketId > 0 ? (baseOffset + ticketId) : ((int) (System.currentTimeMillis() % 9000) + baseOffset);
        dispatchNotification(ctx, safeId, notifTitle, notifBody, highPriority);
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

