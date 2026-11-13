const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const SUPABASE_DEFAULT_DB_URL = 'postgresql://postgres:itrsudlabuha@db.kwjmzugilxbuqlrgangt.supabase.co:5432/postgres';

const isPostgres = Boolean(
  process.env.DATABASE_URL || 
  process.env.SUPABASE_DB_URL || 
  process.env.NETLIFY || 
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

let db = null;
let pool = null;

// Convert SQLite '?' parameter placeholders to PostgreSQL '$1', '$2', ...
function convertPlaceholders(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

let query = {};

if (isPostgres) {
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || SUPABASE_DEFAULT_DB_URL;
  
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  query = {
    get: async (sql, params = []) => {
      const pgSql = convertPlaceholders(sql);
      const res = await pool.query(pgSql, params);
      return res.rows[0] || null;
    },
    all: async (sql, params = []) => {
      const pgSql = convertPlaceholders(sql);
      const res = await pool.query(pgSql, params);
      return res.rows || [];
    },
    run: async (sql, params = []) => {
      let pgSql = convertPlaceholders(sql);
      const isInsert = /^\s*insert\s+/i.test(pgSql);
      if (isInsert && !/returning\s+/i.test(pgSql)) {
        pgSql = `${pgSql} RETURNING id`;
      }
      const res = await pool.query(pgSql, params);
      return {
        lastID: res.rows && res.rows[0] ? res.rows[0].id : null,
        changes: res.rowCount
      };
    },
    exec: async (sql) => {
      return pool.query(sql);
    }
  };

  db = pool;
  console.log('[Database] Menggunakan mode PostgreSQL / Supabase');
} else {
  // Default to local SQLite when running locally without DB URL
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, '..', 'etiket.db');
  db = new sqlite3.Database(dbPath);

  query = {
    get: (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all: (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
    },
    run: (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    exec: (sql) => {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };

  console.log('[Database] Menggunakan mode SQLite lokal');
}

// Initialize schema and initial seed data
async function initDb() {
  if (isPostgres) {
    console.log('[Database] Supabase schema ready.');
  } else {
    await initSqliteDb();
  }
}

async function initSqliteDb() {
  await query.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      building TEXT,
      floor TEXT,
      pic_name TEXT,
      pic_phone TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT DEFAULT 'wrench',
      default_priority TEXT DEFAULT 'medium',
      sla_response_minutes INTEGER DEFAULT 30,
      sla_resolve_hours INTEGER DEFAULT 4,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      room_id INTEGER,
      specialization TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms (id)
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_no TEXT UNIQUE NOT NULL,
      room_id INTEGER,
      room_name TEXT NOT NULL,
      category_id INTEGER,
      category_name TEXT NOT NULL,
      reporter_name TEXT NOT NULL,
      reporter_phone TEXT NOT NULL,
      reporter_email TEXT,
      reporter_role TEXT DEFAULT 'Staff Ruangan',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      priority TEXT DEFAULT 'medium',
      channel TEXT DEFAULT 'web_qr',
      status TEXT DEFAULT 'open',
      assigned_to INTEGER,
      assigned_to_name TEXT,
      assigned_at DATETIME,
      target_response_time DATETIME,
      actual_response_time DATETIME,
      target_resolve_time DATETIME,
      actual_resolve_time DATETIME,
      sla_status TEXT DEFAULT 'on_track',
      pending_reason TEXT,
      resolution_notes TEXT,
      proof_photo_url TEXT,
      satisfaction_rating INTEGER,
      satisfaction_feedback TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      closed_at DATETIME,
      FOREIGN KEY (room_id) REFERENCES rooms (id),
      FOREIGN KEY (category_id) REFERENCES categories (id),
      FOREIGN KEY (assigned_to) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS ticket_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets (id)
    );

    CREATE TABLE IF NOT EXISTS notifications_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      title TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

module.exports = {
  db,
  query,
  initDb
};
