import sqlite3 from 'sqlite3';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isPg = !!process.env.DATABASE_URL;

let dbSqlite = null;
let dbPgPool = null;

if (isPg) {
  console.log("Mode PostgreSQL activé. Connexion à Supabase...");
  dbPgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  console.log("Mode SQLite activé. Connexion locale...");
  const dbDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'coins.db');
  dbSqlite = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Erreur lors de la connexion à SQLite:', err.message);
    } else {
      console.log('Connecté à la base de données SQLite.');
    }
  });
}

function translateSql(sql) {
  if (!isPg) return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

export const run = (sql, params = []) => {
  const translated = translateSql(sql);
  
  if (isPg) {
    return new Promise((resolve, reject) => {
      dbPgPool.query(translated, params, (err, res) => {
        if (err) {
          reject(err);
        } else {
          const insertedId = res.rows && res.rows[0] ? res.rows[0].id : null;
          resolve({ id: insertedId, changes: res.rowCount });
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      dbSqlite.run(translated, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }
};

export const get = (sql, params = []) => {
  const translated = translateSql(sql);
  
  if (isPg) {
    return new Promise((resolve, reject) => {
      dbPgPool.query(translated, params, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res.rows[0] || null);
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      dbSqlite.get(translated, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
};

export const all = (sql, params = []) => {
  const translated = translateSql(sql);
  
  if (isPg) {
    return new Promise((resolve, reject) => {
      dbPgPool.query(translated, params, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res.rows);
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      dbSqlite.all(translated, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
};

export const initDb = async () => {
  if (isPg) {
    await run(`
      CREATE TABLE IF NOT EXISTS identified_coins (
        id SERIAL PRIMARY KEY,
        obverse_image TEXT,
        reverse_image TEXT,
        weight REAL,
        diameter REAL,
        axis TEXT,
        metal TEXT,
        detected_legend_obverse TEXT,
        detected_legend_reverse TEXT,
        detected_iconography TEXT,
        matched_coin_id TEXT,
        matched_title TEXT,
        matched_issuer TEXT,
        matched_year TEXT,
        matched_ref_url TEXT,
        matched_description TEXT,
        user_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  } else {
    await run(`
      CREATE TABLE IF NOT EXISTS identified_coins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        obverse_image TEXT,
        reverse_image TEXT,
        weight REAL,
        diameter REAL,
        axis TEXT,
        metal TEXT,
        detected_legend_obverse TEXT,
        detected_legend_reverse TEXT,
        detected_iconography TEXT,
        matched_coin_id TEXT,
        matched_title TEXT,
        matched_issuer TEXT,
        matched_year TEXT,
        matched_ref_url TEXT,
        matched_description TEXT,
        user_notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  }
  console.log('Tables initialisées avec succès.');
};

export default {
  run,
  get,
  all,
  initDb
};
