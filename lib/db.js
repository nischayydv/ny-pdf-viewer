"use strict";
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const cfg = require("./config");

fs.mkdirSync(path.join(cfg.dataDir, "pdfs"), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(cfg.dataDir, "tmp"), { recursive: true, mode: 0o700 });

const db = new Database(path.join(cfg.dataDir, "app.db"));
try { fs.chmodSync(path.join(cfg.dataDir, "app.db"), 0o600); } catch {}
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  original_name TEXT,
  stored_name TEXT NOT NULL,
  size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  password_hash TEXT NOT NULL,
  expires_at TEXT,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  ip TEXT, forwarded_chain TEXT, country TEXT, user_agent TEXT, browser TEXT, os TEXT, device TEXT,
  language TEXT, referer TEXT, screen TEXT, timezone TEXT, platform TEXT, session_id TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  ua_hash TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS viewer_sessions (
  id TEXT PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  pw_tag TEXT NOT NULL,
  visitor_id TEXT, device_id TEXT,
  name TEXT, email TEXT, ack INTEGER NOT NULL DEFAULT 0,
  ip TEXT, forwarded_chain TEXT,
  country TEXT, country_code TEXT, region TEXT, city TEXT, isp TEXT, asn TEXT, lat REAL, lon REAL, geo_tz TEXT, geo_tz_offset INTEGER,
  user_agent TEXT, browser TEXT, os TEXT, device TEXT, language TEXT, referer TEXT,
  fp TEXT, flags TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0, max_page INTEGER NOT NULL DEFAULT 0,
  dwell TEXT NOT NULL DEFAULT '{}',
  ended INTEGER NOT NULL DEFAULT 0, ended_reason TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocked_ips (
  ip TEXT PRIMARY KEY, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- migrations (safe on a v1 database: only adds what's missing) ----
function addColumn(table, col, def) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn("docs", "pages", "INTEGER NOT NULL DEFAULT 0");
addColumn("docs", "ratios", "TEXT");
addColumn("docs", "sha256", "TEXT");
addColumn("links", "require_identity", "INTEGER NOT NULL DEFAULT 0");
addColumn("links", "require_ack", "INTEGER NOT NULL DEFAULT 0");
addColumn("links", "ack_text", "TEXT");
addColumn("links", "max_devices", "INTEGER");
addColumn("links", "allow_ips", "TEXT");
addColumn("links", "fail_count", "INTEGER NOT NULL DEFAULT 0");
addColumn("links", "locked_until", "TEXT");
addColumn("links", "session_minutes", "INTEGER NOT NULL DEFAULT 60");
addColumn("links", "notes", "TEXT");
addColumn("logs", "city", "TEXT");
addColumn("logs", "region", "TEXT");
addColumn("logs", "geo_country", "TEXT");
addColumn("logs", "isp", "TEXT");

db.exec(`
CREATE INDEX IF NOT EXISTS idx_logs_link ON logs(link_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_vs_link ON viewer_sessions(link_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vs_ip ON viewer_sessions(ip);
CREATE INDEX IF NOT EXISTS idx_vs_seen ON viewer_sessions(last_seen);
`);

module.exports = db;
