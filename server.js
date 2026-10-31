"use strict";
/**
 * Secure PDF Share
 * - Admin uploads PDFs and creates password-protected, revocable share links
 * - Viewers unlock with a password and can only VIEW (rendered on canvas, no file URL exposed)
 * - Every unlock attempt / view is logged with IP, device and browser details
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const UAParser = require("ua-parser-js");

// ---------- config ----------
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "50", 10);

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error("ADMIN_PASSWORD env var is required (min 8 chars).");
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 24) {
  console.error("SESSION_SECRET env var is required (min 24 chars).");
  process.exit(1);
}

const PDF_DIR = path.join(DATA_DIR, "pdfs");
fs.mkdirSync(PDF_DIR, { recursive: true });

// ---------- database ----------
const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
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
  ip TEXT,
  forwarded_chain TEXT,
  country TEXT,
  user_agent TEXT,
  browser TEXT,
  os TEXT,
  device TEXT,
  language TEXT,
  referer TEXT,
  screen TEXT,
  timezone TEXT,
  platform TEXT,
  session_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_link ON logs(link_id, id DESC);
`);

// ---------- helpers ----------
const app = express();
app.set("trust proxy", 1); // Render / Vercel sit behind one proxy hop
app.disable("x-powered-by");

const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token) {
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const cookieOpts = (maxAgeMs) => ({
  httpOnly: true, sameSite: "strict", secure: IS_PROD, maxAge: maxAgeMs, path: "/",
});

function clientInfo(req) {
  const ua = req.get("user-agent") || "";
  const p = new UAParser(ua).getResult();
  return {
    ip: req.ip,
    forwarded_chain: req.get("x-forwarded-for") || null,
    country: req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || null,
    user_agent: ua.slice(0, 500),
    browser: [p.browser.name, p.browser.version].filter(Boolean).join(" ") || null,
    os: [p.os.name, p.os.version].filter(Boolean).join(" ") || null,
    device: [p.device.vendor, p.device.model, p.device.type].filter(Boolean).join(" ") || "desktop/unknown",
    language: (req.get("accept-language") || "").slice(0, 100),
    referer: (req.get("referer") || "").slice(0, 300) || null,
  };
}
const insertLog = db.prepare(`
  INSERT INTO logs (link_id, event, ip, forwarded_chain, country, user_agent, browser, os, device,
    language, referer, screen, timezone, platform, session_id, note)
  VALUES (@link_id, @event, @ip, @forwarded_chain, @country, @user_agent, @browser, @os, @device,
    @language, @referer, @screen, @timezone, @platform, @session_id, @note)`);
function log(req, link_id, event, extra = {}) {
  insertLog.run({
    link_id, event, screen: null, timezone: null, platform: null, session_id: null, note: null,
    ...clientInfo(req), ...extra,
  });
}

function linkState(link) {
  if (!link) return "missing";
  if (link.revoked) return "revoked";
  if (link.expires_at && new Date(link.expires_at.replace(" ", "T") + (link.expires_at.endsWith("Z") ? "" : "Z")) < new Date()) return "expired";
  if (link.max_views && link.view_count >= link.max_views) return "limit";
  return "ok";
}
const getLinkByToken = db.prepare("SELECT l.*, d.stored_name, d.title FROM links l JOIN docs d ON d.id = l.doc_id WHERE l.token = ?");

// ---------- security headers ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "worker-src": ["'self'", "blob:"],
        "font-src": ["'self'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"], // cannot be embedded elsewhere
        "object-src": ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);
app.use((req, res, next) => { res.set("X-Robots-Tag", "noindex, nofollow, noarchive"); next(); });
app.use(cookieParser());
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

// ---------- static ----------
app.use("/vendor/pdfjs", express.static(path.join(__dirname, "node_modules/pdfjs-dist/build"), {
  index: false, setHeaders: (res) => res.set("Cache-Control", "public, max-age=86400"),
}));
app.use("/assets", express.static(path.join(__dirname, "public/assets"), { index: false }));

// ---------- rate limiters ----------
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try later." } });
const unlockLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: "Too many attempts. Try again later." });
const fileLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

// =====================================================================
//                              ADMIN
// =====================================================================
function requireAdmin(req, res, next) {
  const p = verify(req.cookies.adm);
  if (!p || p.role !== "admin") return res.status(401).json({ error: "Not authorised" });
  // lightweight CSRF defence on top of SameSite=Strict
  if (req.method !== "GET" && req.get("x-requested-with") !== "fetch") return res.status(403).json({ error: "Bad request" });
  next();
}

app.get("/admin", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public/admin.html"));
});
app.post("/admin/login", adminLoginLimiter, (req, res) => {
  const pw = (req.body && req.body.password) || "";
  if (!safeEqual(pw, ADMIN_PASSWORD)) {
    log(req, null, "admin_login_failed");
    return res.status(401).json({ error: "Wrong password" });
  }
  res.cookie("adm", sign({ role: "admin", exp: Date.now() + 8 * 3600 * 1000 }), cookieOpts(8 * 3600 * 1000));
  res.json({ ok: true });
});
app.post("/admin/logout", (req, res) => { res.clearCookie("adm", { path: "/" }); res.json({ ok: true }); });
app.get("/api/me", requireAdmin, (req, res) => res.json({ ok: true }));

// ---- docs ----
const upload = multer({
  storage: multer.diskStorage({
    destination: PDF_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + ".pdf"),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

app.get("/api/docs", requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT d.id, d.title, d.original_name, d.size, d.created_at,
    (SELECT COUNT(*) FROM links WHERE doc_id = d.id) AS links FROM docs d ORDER BY d.id DESC`).all());
});
app.post("/api/docs", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  // verify real PDF magic bytes
  const fd = fs.openSync(req.file.path, "r");
  const buf = Buffer.alloc(5); fs.readSync(fd, buf, 0, 5, 0); fs.closeSync(fd);
  if (buf.toString() !== "%PDF-") {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Not a valid PDF" });
  }
  const title = (req.body.title || req.file.originalname || "Untitled").toString().slice(0, 200);
  const r = db.prepare("INSERT INTO docs (title, original_name, stored_name, size) VALUES (?,?,?,?)")
    .run(title, (req.file.originalname || "").slice(0, 200), req.file.filename, req.file.size);
  res.json({ id: r.lastInsertRowid });
});
app.delete("/api/docs/:id", requireAdmin, (req, res) => {
  const d = db.prepare("SELECT * FROM docs WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM docs WHERE id = ?").run(d.id);
  fs.promises.unlink(path.join(PDF_DIR, d.stored_name)).catch(() => {});
  res.json({ ok: true });
});

// ---- links ----
app.get("/api/links", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT l.id, l.token, l.label, l.expires_at, l.max_views, l.view_count, l.revoked, l.created_at,
      d.title AS doc_title, d.id AS doc_id,
      (SELECT COUNT(*) FROM logs WHERE link_id = l.id AND event = 'unlock_failed') AS failed_attempts,
      (SELECT MAX(created_at) FROM logs WHERE link_id = l.id AND event = 'unlock_ok') AS last_opened
    FROM links l JOIN docs d ON d.id = l.doc_id ORDER BY l.id DESC`).all();
  res.json(rows.map((r) => ({ ...r, status: linkState(r), url: `${req.protocol}://${req.get("host")}/s/${r.token}` })));
});
app.post("/api/links", requireAdmin, (req, res) => {
  const { doc_id, label, password, expires_at, max_views } = req.body || {};
  if (!db.prepare("SELECT 1 FROM docs WHERE id = ?").get(doc_id)) return res.status(400).json({ error: "Pick a document" });
  if (typeof password !== "string" || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  let exp = null;
  if (expires_at) {
    const d = new Date(expires_at);
    if (isNaN(d)) return res.status(400).json({ error: "Bad expiry date" });
    exp = d.toISOString().replace("T", " ").slice(0, 19);
  }
  const mv = max_views ? Math.max(1, parseInt(max_views, 10) || 0) || null : null;
  const token = crypto.randomBytes(24).toString("base64url");
  const r = db.prepare("INSERT INTO links (doc_id, token, label, password_hash, expires_at, max_views) VALUES (?,?,?,?,?,?)")
    .run(doc_id, token, (label || "").toString().slice(0, 120), bcrypt.hashSync(password, 11), exp, mv);
  res.json({ id: r.lastInsertRowid, url: `${req.protocol}://${req.get("host")}/s/${token}` });
});
app.post("/api/links/:id/revoke", requireAdmin, (req, res) => {
  db.prepare("UPDATE links SET revoked = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
app.post("/api/links/:id/restore", requireAdmin, (req, res) => {
  db.prepare("UPDATE links SET revoked = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
app.post("/api/links/:id/password", requireAdmin, (req, res) => {
  const pw = req.body && req.body.password;
  if (typeof pw !== "string" || pw.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  db.prepare("UPDATE links SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(pw, 11), req.params.id);
  res.json({ ok: true });
});
app.delete("/api/links/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM links WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---- logs ----
app.get("/api/logs", requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "200", 10) || 200, 1000);
  const linkId = req.query.link_id ? parseInt(req.query.link_id, 10) : null;
  const rows = linkId
    ? db.prepare(`SELECT lg.*, l.label, l.token FROM logs lg LEFT JOIN links l ON l.id = lg.link_id WHERE lg.link_id = ? ORDER BY lg.id DESC LIMIT ?`).all(linkId, limit)
    : db.prepare(`SELECT lg.*, l.label, l.token FROM logs lg LEFT JOIN links l ON l.id = lg.link_id ORDER BY lg.id DESC LIMIT ?`).all(limit);
  res.json(rows);
});

// =====================================================================
//                              VIEWER
// =====================================================================
const unavailableMsg = {
  missing: "This link is not valid.",
  revoked: "This link has been disabled by the owner.",
  expired: "This link has expired.",
  limit: "This link has reached its view limit.",
};
function page(res, status, file, replacements = {}) {
  let html = fs.readFileSync(path.join(__dirname, "public", file), "utf8");
  for (const [k, v] of Object.entries(replacements)) html = html.split(`{{${k}}}`).join(escapeHtml(v));
  res.status(status).set({ "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" }).send(html);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function viewerSession(req, link) {
  const p = verify(req.cookies["v_" + link.id]);
  if (!p || p.role !== "viewer" || p.link !== link.id || p.pwv !== link.password_hash.slice(-12)) return null;
  return p;
}

app.get("/s/:token", (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  const st = linkState(link);
  if (st !== "ok") {
    if (link) log(req, link.id, "blocked_" + st);
    return page(res, 410, "unavailable.html", { MESSAGE: unavailableMsg[st] });
  }
  // already unlocked in this browser -> straight to viewer
  if (viewerSession(req, link)) return page(res, 200, "viewer.html", { TITLE: link.title, TOKEN: link.token });
  page(res, 200, "unlock.html", { TITLE: link.title, TOKEN: link.token, ERROR: "" });
});

app.post("/s/:token/unlock", unlockLimiter, (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  const st = linkState(link);
  if (st !== "ok") {
    if (link) log(req, link.id, "blocked_" + st);
    return page(res, 410, "unavailable.html", { MESSAGE: unavailableMsg[st] });
  }
  const pw = (req.body && req.body.password) || "";
  if (!bcrypt.compareSync(String(pw), link.password_hash)) {
    log(req, link.id, "unlock_failed");
    return page(res, 401, "unlock.html", { TITLE: link.title, TOKEN: link.token, ERROR: "Incorrect password." });
  }
  const sid = crypto.randomBytes(8).toString("hex");
  db.prepare("UPDATE links SET view_count = view_count + 1 WHERE id = ?").run(link.id);
  log(req, link.id, "unlock_ok", { session_id: sid });
  const ttl = 60 * 60 * 1000; // 1 hour viewing session
  res.cookie("v_" + link.id, sign({ role: "viewer", link: link.id, sid, pwv: link.password_hash.slice(-12), exp: Date.now() + ttl }), cookieOpts(ttl));
  res.redirect(303, "/s/" + link.token);
});

// Viewer metadata: gives the client the watermark text for this session
app.get("/s/:token/meta", (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (linkState(link) !== "ok") return res.status(410).json({ error: "unavailable" });
  const vs = viewerSession(req, link);
  if (!vs) return res.status(401).json({ error: "locked" });
  res.set("Cache-Control", "no-store").json({
    sid: vs.sid, ip: req.ip, at: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", title: link.title,
  });
});

// The PDF bytes. Needs: valid link, valid viewer cookie, custom header (blocks plain navigation / "open in new tab")
app.get("/s/:token/file", fileLimiter, (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (linkState(link) !== "ok") return res.status(410).end();
  const vs = viewerSession(req, link);
  if (!vs) return res.status(401).end();
  if (req.get("x-viewer") !== "1" || req.get("sec-fetch-dest") === "document") return res.status(403).end();
  const file = path.join(PDF_DIR, path.basename(link.stored_name));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  });
  res.type("application/pdf");
  res.sendFile(file, { acceptRanges: true, cacheControl: false, etag: false, lastModified: false });
});

// Client beacon: device details + activity (page views, blocked actions, closes)
app.post("/s/:token/beacon", (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (!link) return res.status(404).end();
  const vs = viewerSession(req, link);
  if (!vs) return res.status(401).end();
  const b = req.body || {};
  const allowed = ["device_info", "page_view", "blocked_action", "tab_hidden", "closed"];
  const event = allowed.includes(b.event) ? b.event : null;
  if (!event) return res.status(400).end();
  const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
  log(req, link.id, event, {
    session_id: vs.sid, screen: clip(b.screen, 40), timezone: clip(b.timezone, 60),
    platform: clip(b.platform, 60), note: clip(b.note, 200),
  });
  res.status(204).end();
});

app.get("/", (req, res) => res.status(404).type("text").send("Not found"));
app.use((req, res) => res.status(404).type("text").send("Not found"));
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `File too large (max ${MAX_UPLOAD_MB} MB)` });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => console.log(`Secure PDF Share running on :${PORT}`));
