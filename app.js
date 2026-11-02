"use strict";
const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");

const cfg = require("./lib/config");
const db = require("./lib/db");
const vault = require("./lib/vault");
const render = require("./lib/render");
const U = require("./lib/util");

const app = express();
app.set("trust proxy", cfg.trustProxyHops);
app.disable("x-powered-by");
app.set("etag", false);

// ---------- security headers ----------
const csp = {
  useDefaults: false,
  directives: {
    "default-src": ["'none'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'"],
    "font-src": ["'self'"],
    "manifest-src": ["'none'"],
    "media-src": ["'none'"],
    "frame-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
  },
};
if (cfg.isProd) csp.directives["upgrade-insecure-requests"] = [];
app.use(helmet({
  contentSecurityPolicy: csp,
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  hsts: cfg.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
}));
app.use((req, res, next) => {
  res.set({
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=()",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "X-Download-Options": "noopen",
  });
  next();
});
app.use(compression({ filter: (req, res) => !/^image\//.test(res.getHeader("Content-Type") || "") && compression.filter(req, res) }));
app.use(cookieParser());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

// ---------- CSRF defence in depth: same-origin only for anything that changes state ----------
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  // Modern browsers state the request's origin relationship themselves and it cannot be forged by page scripts.
  const sfs = req.get("sec-fetch-site");
  if (sfs) return sfs === "same-origin" || sfs === "none" ? next() : res.status(403).json({ error: "Cross-origin request blocked" });
  // Fallback for older clients. Note: with Referrer-Policy: no-referrer, browsers send "Origin: null" on same-site form posts.
  const origin = req.get("origin");
  if (origin === "null") return req.path.startsWith("/api") || req.path.startsWith("/admin") ? res.status(403).json({ error: "Bad origin" }) : next();
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin request blocked" }); }
    catch { return res.status(403).json({ error: "Bad origin" }); }
  }
  next();
});

// ---------- routes ----------
app.get("/healthz", (req, res) => res.type("text").send("ok"));
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), { index: false, etag: true, maxAge: "10m", fallthrough: false }));
app.use("/", require("./routes/admin"));
app.use("/s", require("./routes/viewer"));
app.get("/", (req, res) => res.status(404).type("text").send("Not found"));
app.use((req, res) => res.status(404).type("text").send("Not found"));
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `File too large (max ${cfg.maxUploadMb} MB)` });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
  if (err && err.status === 404) return res.status(404).type("text").send("Not found");
  console.error("[error]", err && err.stack || err);
  if (!res.headersSent) res.status(500).json({ error: "Server error" });
});

// ---------- housekeeping ----------
function purge() {
  try {
    const cut = U.nowSql(new Date(Date.now() - cfg.retentionDays * 864e5));
    const a = db.prepare("DELETE FROM logs WHERE created_at < ? AND event NOT LIKE 'admin_%'").run(cut).changes;
    const b = db.prepare("DELETE FROM viewer_sessions WHERE started_at < ? AND ended = 1").run(cut).changes;
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(U.nowSql());
    // sessions that stopped sending heartbeats are over
    db.prepare("UPDATE viewer_sessions SET ended = 1, ended_reason = 'timeout', ended_at = ? WHERE ended = 0 AND expires_at < ?").run(U.nowSql(), U.nowSql());
    if (a || b) console.log(`[purge] removed ${a} log rows, ${b} old sessions`);
    fs.readdirSync(path.join(cfg.dataDir, "tmp")).forEach((f) => { const p = path.join(cfg.dataDir, "tmp", f); try { if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p); } catch {} });
  } catch (e) { console.error("[purge]", e.message); }
}

/** v1 -> v2: encrypt plaintext PDFs, and fill in page counts for old documents. */
async function migrate() {
  const PDF_DIR = path.join(cfg.dataDir, "pdfs");
  for (const d of db.prepare("SELECT * FROM docs").all()) {
    const file = path.join(PDF_DIR, path.basename(d.stored_name));
    if (!fs.existsSync(file)) continue;
    try {
      if (!d.pages || !d.ratios) {
        const info = await render.inspect(file, 100000);
        db.prepare("UPDATE docs SET pages = ?, ratios = ? WHERE id = ?").run(info.pages, JSON.stringify(info.ratios), d.id);
        console.log(`[migrate] doc ${d.id}: ${info.pages} pages`);
      }
      if (await vault.encryptFileInPlace(file)) { render.forget(file); console.log(`[migrate] doc ${d.id}: encrypted at rest`); }
    } catch (e) { console.error(`[migrate] doc ${d.id} failed:`, e.message); }
  }
}

(async () => {
  await migrate();
  purge();
  setInterval(purge, 6 * 3600e3).unref();
  const server = app.listen(cfg.port, () => console.log(`${cfg.appName} listening on :${cfg.port} (${cfg.isProd ? "production" : "development"})`));
  server.requestTimeout = 120000; server.headersTimeout = 30000; server.keepAliveTimeout = 65000;
  const stop = () => { console.log("shutting down…"); server.close(async () => { try { await require("./lib/persist").flush(); } catch (e) { console.error("[persist] flush:", e.message); } try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 12000).unref(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
})();
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
// an unknown fatal error leaves the process in an undefined state: log it and exit so the host restarts a clean instance
process.on("uncaughtException", (e) => { console.error("[fatal]", e); process.exit(1); });
