const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const MAX_LOCAL_BACKUPS = 30;

function formatLocalDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Collects a complete JSON snapshot of SIM-ETIKET operational tables
 * (omitting sensitive user password hashes) and records `last_backup_at`.
 */
async function createDatabaseBackupBundle(options = {}) {
  const { recordTimestamp = true, source = 'manual' } = options;
  const generatedAt = new Date().toISOString();

  const [
    tickets,
    ticketLogs,
    rooms,
    categories,
    users,
    notificationsLog,
    systemSettings
  ] = await Promise.all([
    query.all('SELECT * FROM tickets ORDER BY id ASC'),
    query.all('SELECT * FROM ticket_logs ORDER BY id ASC'),
    query.all('SELECT * FROM rooms ORDER BY id ASC'),
    query.all('SELECT * FROM categories ORDER BY id ASC'),
    query.all('SELECT id, username, name, role, phone, email, specialization, is_active, created_at FROM users ORDER BY id ASC'),
    query.all('SELECT * FROM notifications_log ORDER BY id DESC LIMIT 1000'),
    query.all('SELECT * FROM system_settings ORDER BY key ASC')
  ]);

  if (recordTimestamp) {
    try {
      await query.run(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `, ['last_backup_at', generatedAt]);
    } catch (err) {
      console.warn('[Backup] Gagal mencatat last_backup_at:', err.message);
    }
  }

  return {
    backupVersion: '4.7',
    appName: 'SIM-ETIKET IT RSUD LABUHA',
    source,
    generatedAt,
    storageEngine: 'Supabase PostgreSQL Cloud / Local SQLite Mirror',
    counts: {
      tickets: tickets.length,
      ticket_logs: ticketLogs.length,
      rooms: rooms.length,
      categories: categories.length,
      users: users.length,
      notifications_log: notificationsLog.length,
      system_settings: systemSettings.length
    },
    tables: {
      tickets,
      ticket_logs: ticketLogs,
      rooms,
      categories,
      users,
      notifications_log: notificationsLog,
      system_settings: systemSettings
    }
  };
}

/**
 * Writes a daily automatic JSON backup under `server/backups/` when the Express
 * server is running and prunes backups older than 30 files.
 */
async function runDailyAutoBackup({ force = false, recordTimestamp = true } = {}) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const stamp = formatLocalDateStamp();
    const targetPath = path.join(BACKUP_DIR, `etiket-backup-${stamp}.json`);
    if (!force && fs.existsSync(targetPath)) {
      return { skipped: true, path: targetPath };
    }

    const bundle = await createDatabaseBackupBundle({
      recordTimestamp,
      source: 'server-daily-auto'
    });
    fs.writeFileSync(targetPath, JSON.stringify(bundle, null, 2), 'utf8');

    const files = fs.readdirSync(BACKUP_DIR)
      .filter((name) => /^etiket-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse();

    for (const staleFile of files.slice(MAX_LOCAL_BACKUPS)) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, staleFile));
      } catch (err) {
        console.warn('[Backup] Gagal menghapus backup lama:', staleFile, err.message);
      }
    }

    console.log(`[Backup] Backup harian tersimpan: ${targetPath}`);
    return { skipped: false, path: targetPath, generatedAt: bundle.generatedAt };
  } catch (err) {
    console.warn('[Backup] Gagal menjalankan auto-backup harian:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  BACKUP_DIR,
  createDatabaseBackupBundle,
  runDailyAutoBackup
};
