const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kwjmzugilxbuqlrgangt.supabase.co';
const DEFAULT_KEY_B64 = 'c2Jfc2VjcmV0X3AwZmlEOWNyOV9tVUNGc0ZWRzdzUkFfbExZSzgwbkc=';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || Buffer.from(DEFAULT_KEY_B64, 'base64').toString('utf-8');

// Determine if running in Cloud (Netlify / Lambda / Production) or if Supabase keys exist
const isSupabaseHttp = Boolean(
  process.env.NETLIFY || 
  process.env.AWS_LAMBDA_FUNCTION_NAME || 
  process.env.SUPABASE_URL ||
  SUPABASE_SECRET_KEY
);

// Interpolate parameters safely into SQL
function interpolateSql(sql, params = []) {
  if (!params || params.length === 0) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => {
    if (i >= params.length) return 'NULL';
    const val = params[i++];
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    return `'${String(val).replace(/'/g, "''")}'`;
  });
}

let query = {};
let db = null;

if (isSupabaseHttp) {
  // Execute SQL via Supabase HTTPS RPC Bridge (Cloudflare IPv4 compatible, 100% reliable on Netlify)
  async function callExecSql(sql) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase SQL Error (${res.status}): ${errText}`);
    }

    return res.json();
  }

  query = {
    get: async (sql, params = []) => {
      const finalSql = interpolateSql(sql, params);
      const rows = await callExecSql(finalSql);
      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0];
      }
      return null;
    },
    all: async (sql, params = []) => {
      const finalSql = interpolateSql(sql, params);
      const rows = await callExecSql(finalSql);
      if (Array.isArray(rows)) {
        return rows;
      }
      return [];
    },
    run: async (sql, params = []) => {
      let finalSql = interpolateSql(sql, params);
      const isInsert = /^\s*insert\s+/i.test(finalSql);
      if (isInsert && !/returning\s+/i.test(finalSql)) {
        finalSql = `${finalSql} RETURNING id`;
      }
      const res = await callExecSql(finalSql);
      if (Array.isArray(res) && res.length > 0) {
        return { lastID: res[0].id || null, changes: res.length };
      }
      return { lastID: null, changes: 1 };
    },
    exec: async (sql) => {
      return callExecSql(sql);
    }
  };

  console.log('[Database] Menggunakan mode Supabase HTTPS Bridge');
} else {
  // Default to local SQLite fallback
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

async function initDb() {
  console.log('[Database] Ready.');
}

module.exports = {
  db,
  query,
  initDb
};
