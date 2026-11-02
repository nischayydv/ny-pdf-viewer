"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const core = require("../lib/core");
const U = require("../lib/util");
const totp = require("../lib/totp");
const vault = require("../lib/vault");
const render = require("../lib/render");
const { notify } = require("../lib/notify");
const qrcode = require("qrcode");
const { db, cfg, log, linkState, publicBase } = core;

const router = express.Router();
const PDF_DIR = path.join(cfg.dataDir, "pdfs");
const TMP_DIR = path.join(cfg.dataDir, "tmp");
const ADM = (cfg.isProd ? "__Host-" : "") + "adm";
const ADMIN_TTL_MS = 8 * 3600 * 1000;
const admCookie = (maxAge) => ({ httpOnly: true, sameSite: "strict", secure: cfg.isProd, maxAge, path: "/" });
// ---- two-factor secret: from the environment (ADMIN_TOTP_SECRET) or set up inside the panel (stored encrypted in the database)
const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
function storedTotp() {
  const r = getSetting.get("totp_secret"); if (!r) return "";
  try { return vault.decryptBuffer(Buffer.from(r.value, "base64")).toString(); } catch { return ""; }
}
const activeTotp = () => cfg.totpSecret || storedTotp();
const pending2fa = new Map(); // admin session id -> { secret, exp }  (never written to disk until confirmed)
const uaHash = (req) => U.sha256(req.get("user-agent") || "");

// ================= authentication =================
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again later." } });
const fails = new Map(); // ip -> {n, until}
function lockedOut(ip) { const f = fails.get(ip); return f && f.until && f.until > Date.now(); }
function recordFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60 * 1000; f.n = 0; }
  fails.set(ip, f);
}
setInterval(() => { for (const [k, v] of fails) if (!v.until || v.until < Date.now()) if (v.n === 0) fails.delete(k); }, 600000).unref();

function passwordOk(pw) {
  if (typeof pw !== "string" || !pw || pw.length > 256) return false;
  return cfg.adminIsHash ? bcrypt.compareSync(pw, cfg.adminPassword) : U.safeEqual(pw, cfg.adminPassword);
}

router.get("/admin", (req, res) => {
  res.set({ "Cache-Control": "no-store" }).sendFile(path.join(__dirname, "..", "public", "admin.html"));
});
router.get("/admin/status", (req, res) => res.set("Cache-Control", "no-store").json({ totp: !!activeTotp(), app: cfg.appName, signedIn: !!adminSession(req) }));

router.post("/admin/login", loginLimiter, async (req, res) => {
  const ip = U.normIp(req.ip);
  if (lockedOut(ip)) return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
  const { password, code } = req.body || {};
  const pwOk = passwordOk(password);
  // the one-time code is only consumed once the password is right, so a typo'd password never burns a valid code
  const secret2fa = activeTotp();
  const codeOk = secret2fa ? (pwOk && totp.verify(secret2fa, code)) : true;
  if (!pwOk || !codeOk) {
    recordFail(ip);
    log(req, null, "admin_login_failed", { note: !pwOk ? "bad password" : "bad 2FA code" });
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ error: secret2fa ? "Invalid password or authentication code." : "Invalid password." });
  }
  fails.delete(ip);
  const id = U.rand(9), secret = U.rand(32);
  db.prepare("INSERT INTO admin_sessions (id, secret_hash, ua_hash, ip, created_at, expires_at) VALUES (?,?,?,?,?,?)")
    .run(id, U.sha256(secret), uaHash(req), ip, U.nowSql(), U.nowSql(new Date(Date.now() + ADMIN_TTL_MS)));
  log(req, null, "admin_login");
  res.cookie(ADM, `${id}.${secret}`, admCookie(ADMIN_TTL_MS));
  res.json({ ok: true });
});

function adminSession(req) {
  const raw = req.cookies[ADM];
  if (typeof raw !== "string") return null;
  const [id, secret] = raw.split(".");
  if (!id || !secret) return null;
  const s = db.prepare("SELECT * FROM admin_sessions WHERE id = ?").get(id);
  if (!s || !U.safeEqual(U.sha256(secret), s.secret_hash) || U.parseSql(s.expires_at) < new Date() || s.ua_hash !== uaHash(req)) return null;
  return s;
}
function requireAdmin(req, res, next) {
  const s = adminSession(req);
  if (!s) return res.status(401).json({ error: "Not signed in" });
  if (req.method !== "GET" && req.get("x-requested-with") !== "fetch") return res.status(403).json({ error: "Bad request" });
  req.admin = s;
  res.set("Cache-Control", "no-store");
  next();
}
router.post("/admin/logout", (req, res) => {
  const s = adminSession(req);
  if (s) db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(s.id);
  res.clearCookie(ADM, { path: "/" });
  res.json({ ok: true });
});
router.post("/api/logout-everywhere", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM admin_sessions").run();
  res.clearCookie(ADM, { path: "/" });
  log(req, null, "admin_logout_all");
  res.json({ ok: true });
});
router.get("/api/me", requireAdmin, (req, res) => res.json({ ok: true, app: cfg.appName, totp: !!activeTotp() }));

// ================= two-factor setup (inside the panel) =================
const twofaLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again later." } });
router.post("/api/2fa/start", requireAdmin, twofaLimiter, async (req, res) => {
  if (cfg.totpSecret) return res.status(400).json({ error: "2FA is managed by the ADMIN_TOTP_SECRET environment variable on your host." });
  if (storedTotp()) return res.status(400).json({ error: "2FA is already on. Disable it first to set it up again." });
  const secret = totp.generateSecret();
  pending2fa.set(req.admin.id, { secret, exp: Date.now() + 10 * 60 * 1000 });
  const label = encodeURIComponent(cfg.appName);
  const uri = `otpauth://totp/${label}:admin?secret=${secret}&issuer=${label}&algorithm=SHA1&digits=6&period=30`;
  res.json({ secret, uri, qr: await qrcode.toDataURL(uri, { margin: 1, width: 232, errorCorrectionLevel: "M" }) });
});
router.post("/api/2fa/enable", requireAdmin, twofaLimiter, (req, res) => {
  const p = pending2fa.get(req.admin.id);
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: "Setup expired. Start again." });
  if (!totp.verify(p.secret, (req.body || {}).code)) return res.status(400).json({ error: "That code didn't match. Check the code in your app and try again." });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_secret', ?)").run(vault.encryptBuffer(Buffer.from(p.secret)).toString("base64"));
  pending2fa.delete(req.admin.id);
  log(req, null, "admin_2fa_enabled");
  res.json({ ok: true });
});
router.post("/api/2fa/disable", requireAdmin, twofaLimiter, (req, res) => {
  if (cfg.totpSecret) return res.status(400).json({ error: "2FA is managed by the ADMIN_TOTP_SECRET environment variable on your host." });
  const stored = storedTotp(); if (!stored) return res.json({ ok: true });
  const b = req.body || {};
  if (!passwordOk(b.password) || !totp.verify(stored, b.code)) return res.status(401).json({ error: "Wrong password or code." });
  db.prepare("DELETE FROM settings WHERE key = 'totp_secret'").run();
  log(req, null, "admin_2fa_disabled");
  res.json({ ok: true });
});

// ================= overview =================
router.get("/api/overview", requireAdmin, (req, res) => {
  const now = U.nowSql();
  const ago = (ms) => U.nowSql(new Date(Date.now() - ms));
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const activeLinks = one("SELECT COUNT(*) c FROM links WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > ?)", now).c;
  const totalLinks = one("SELECT COUNT(*) c FROM links").c;
  const opens7 = one("SELECT COUNT(*) c FROM logs WHERE event = 'unlock_ok' AND created_at >= ?", ago(7 * 864e5)).c;
  const opensPrev7 = one("SELECT COUNT(*) c FROM logs WHERE event = 'unlock_ok' AND created_at >= ? AND created_at < ?", ago(14 * 864e5), ago(7 * 864e5)).c;
  const live = one("SELECT COUNT(*) c FROM viewer_sessions WHERE ended = 0 AND last_seen >= ?", ago(60000)).c;
  const failed24 = one("SELECT COUNT(*) c FROM logs WHERE event IN ('unlock_failed','admin_login_failed') AND created_at >= ?", ago(864e5)).c;
  const days = [];
  const rowsOpen = db.prepare("SELECT substr(created_at,1,10) d, COUNT(*) c FROM logs WHERE event = 'unlock_ok' AND created_at >= ? GROUP BY d").all(ago(14 * 864e5));
  const rowsFail = db.prepare("SELECT substr(created_at,1,10) d, COUNT(*) c FROM logs WHERE event = 'unlock_failed' AND created_at >= ? GROUP BY d").all(ago(14 * 864e5));
  for (let i = 13; i >= 0; i--) {
    const d = U.nowSql(new Date(Date.now() - i * 864e5)).slice(0, 10);
    days.push({ d, opens: (rowsOpen.find((r) => r.d === d) || {}).c || 0, failed: (rowsFail.find((r) => r.d === d) || {}).c || 0 });
  }
  const sessCols = `s.id, s.name, s.email, s.ip, s.country, s.country_code, s.city, s.region, s.browser, s.os, s.device, s.started_at, s.last_seen, s.active_seconds, s.flags, s.ended, l.label, d.title AS doc_title`;
  const recent = db.prepare(`SELECT ${sessCols} FROM viewer_sessions s JOIN links l ON l.id = s.link_id JOIN docs d ON d.id = l.doc_id ORDER BY s.started_at DESC LIMIT 7`).all();
  const flagged = db.prepare(`SELECT ${sessCols} FROM viewer_sessions s JOIN links l ON l.id = s.link_id JOIN docs d ON d.id = l.doc_id WHERE s.flags != '' AND s.started_at >= ? ORDER BY s.started_at DESC LIMIT 5`).all(ago(30 * 864e5));
  const countries = db.prepare("SELECT COALESCE(country, country_code, 'Unknown') c, COUNT(*) n FROM viewer_sessions GROUP BY c ORDER BY n DESC LIMIT 6").all();
  res.json({ activeLinks, totalLinks, opens7, opensPrev7, live, failed24, days, recent, flagged, countries, docs: one("SELECT COUNT(*) c FROM docs").c, sessions: one("SELECT COUNT(*) c FROM viewer_sessions").c });
});

// ================= documents =================
const upload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: (req, f, cb) => cb(null, "up_" + crypto.randomBytes(12).toString("hex")) }),
  limits: { fileSize: cfg.maxUploadMb * 1024 * 1024, files: 1, fields: 5 },
});

router.get("/api/docs", requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT d.id, d.title, d.original_name, d.size, d.pages, d.created_at,
    (SELECT COUNT(*) FROM links WHERE doc_id = d.id) AS links FROM docs d ORDER BY d.id DESC`).all());
});

router.post("/api/docs", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received" });
  const tmp = req.file.path;
  const bail = (status, msg) => { fs.promises.unlink(tmp).catch(() => {}); return res.status(status).json({ error: msg }); };
  try {
    const fd = fs.openSync(tmp, "r"); const head = Buffer.alloc(5); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
    if (head.toString() !== "%PDF-") return bail(400, "That file is not a PDF.");
    let info;
    try { info = await render.inspect(tmp, cfg.maxPages); }
    catch (e) { return bail(400, /Too many pages/.test(e.message) ? e.message : "This PDF could not be read. It may be corrupt or password-protected — remove the password and try again."); }
    const plain = await fs.promises.readFile(tmp);
    const stored = crypto.randomBytes(16).toString("hex") + ".pdf";
    await fs.promises.writeFile(path.join(PDF_DIR, stored), vault.encryptBuffer(plain), { mode: 0o600 });
    await fs.promises.unlink(tmp);
    const title = (U.clip(req.body.title, 200) || U.clip(req.file.originalname, 200) || "Untitled").replace(/\.pdf$/i, "");
    const r = db.prepare("INSERT INTO docs (title, original_name, stored_name, size, pages, ratios, sha256) VALUES (?,?,?,?,?,?,?)")
      .run(title, U.clip(req.file.originalname, 200), stored, req.file.size, info.pages, JSON.stringify(info.ratios), U.sha256(plain));
    log(req, null, "admin_doc_uploaded", { note: `${title} (${info.pages} pages)` });
    res.json({ id: r.lastInsertRowid, pages: info.pages });
  } catch (e) { console.error(e); bail(500, "Upload failed"); }
});

const thumbCache = new Map();
router.get("/api/docs/:id/thumb", requireAdmin, async (req, res) => {
  const d = db.prepare("SELECT * FROM docs WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).end();
  try {
    let buf = thumbCache.get(d.id);
    if (!buf) {
      buf = await render.renderPage(path.join(PDF_DIR, path.basename(d.stored_name)), 1, 420, null, 78);
      if (thumbCache.size > 100) thumbCache.delete(thumbCache.keys().next().value);
      thumbCache.set(d.id, buf);
    }
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" }).end(buf);
  } catch { res.status(500).end(); }
});

router.delete("/api/docs/:id", requireAdmin, (req, res) => {
  const d = db.prepare("SELECT * FROM docs WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM docs WHERE id = ?").run(d.id);
  const file = path.join(PDF_DIR, path.basename(d.stored_name));
  render.forget(file); thumbCache.delete(d.id);
  fs.promises.unlink(file).catch(() => {});
  log(req, null, "admin_doc_deleted", { note: d.title });
  res.json({ ok: true });
});

// ================= links =================
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;
function readLinkOpts(b, { creating }) {
  const o = {};
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if ("label" in b) o.label = U.clip(b.label, 120) || "";
  if ("notes" in b) o.notes = U.clip(b.notes, 500);
  if ("expires_at" in b) {
    if (!b.expires_at) o.expires_at = null;
    else { const d = new Date(b.expires_at); if (isNaN(d)) err("Invalid expiry date"); if (d < new Date()) err("Expiry must be in the future"); o.expires_at = U.nowSql(d); }
  }
  const optInt = (k, min, max, label) => { if (k in b) { if (b[k] === "" || b[k] == null) o[k] = null; else { const n = parseInt(b[k], 10); if (!Number.isInteger(n) || n < min || n > max) err(`${label} must be between ${min} and ${max}`); o[k] = n; } } };
  optInt("max_views", 1, 100000, "Max unlocks");
  optInt("max_devices", 1, 100, "Max devices");
  if ("session_minutes" in b) { const n = parseInt(b.session_minutes, 10); if (!(n >= 5 && n <= 1440)) err("Session length must be 5–1440 minutes"); o.session_minutes = n; }
  if ("require_identity" in b) o.require_identity = b.require_identity ? 1 : 0;
  if ("require_ack" in b) o.require_ack = b.require_ack ? 1 : 0;
  if ("ack_text" in b) o.ack_text = U.clip(b.ack_text, 400);
  if ("allow_ips" in b) {
    const list = String(b.allow_ips || "").split(/[\s,]+/).filter(Boolean);
    if (list.some((x) => !IP_RE.test(x))) err("Allowed IPs must be valid IP addresses, separated by commas");
    o.allow_ips = list.length ? list.join(",") : null;
  }
  if (creating || "password" in b) {
    if (typeof b.password !== "string" || b.password.length < 6 || b.password.length > 128) err("Password must be 6–128 characters");
    o.password_hash = bcrypt.hashSync(b.password, 12);
  }
  return o;
}

router.get("/api/links", requireAdmin, (req, res) => {
  const base = publicBase(req);
  const rows = db.prepare(`SELECT l.id, l.token, l.label, l.notes, l.expires_at, l.max_views, l.view_count, l.revoked, l.created_at,
      l.require_identity, l.require_ack, l.ack_text, l.max_devices, l.allow_ips, l.session_minutes, l.locked_until,
      d.title AS doc_title, d.id AS doc_id, d.pages,
      (SELECT COUNT(*) FROM logs WHERE link_id = l.id AND event = 'unlock_failed') AS failed_attempts,
      (SELECT MAX(started_at) FROM viewer_sessions WHERE link_id = l.id) AS last_opened,
      (SELECT COUNT(DISTINCT COALESCE(device_id, visitor_id)) FROM viewer_sessions WHERE link_id = l.id) AS devices,
      (SELECT COUNT(*) FROM viewer_sessions WHERE link_id = l.id AND ended = 0 AND last_seen >= ?) AS live
    FROM links l JOIN docs d ON d.id = l.doc_id ORDER BY l.id DESC`).all(U.nowSql(new Date(Date.now() - 60000)));
  res.json(rows.map((r) => ({ ...r, status: linkState(r), url: `${base}/s/${r.token}` })));
});

router.post("/api/links", requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    if (!db.prepare("SELECT 1 FROM docs WHERE id = ?").get(b.doc_id)) return res.status(400).json({ error: "Choose a document" });
    const o = readLinkOpts(b, { creating: true });
    const token = U.rand(24);
    const r = db.prepare(`INSERT INTO links (doc_id, token, label, notes, password_hash, expires_at, max_views, max_devices, allow_ips, session_minutes, require_identity, require_ack, ack_text)
      VALUES (@doc_id,@token,@label,@notes,@password_hash,@expires_at,@max_views,@max_devices,@allow_ips,@session_minutes,@require_identity,@require_ack,@ack_text)`)
      .run({ doc_id: b.doc_id, token, label: "", notes: null, expires_at: null, max_views: null, max_devices: null, allow_ips: null, session_minutes: 60, require_identity: 0, require_ack: 0, ack_text: null, ...o });
    log(req, r.lastInsertRowid, "admin_link_created", { note: o.label || null });
    res.json({ id: r.lastInsertRowid, url: `${publicBase(req)}/s/${token}` });
  } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "Could not create link" }); }
});

router.patch("/api/links/:id", requireAdmin, (req, res) => {
  try {
    const link = db.prepare("SELECT * FROM links WHERE id = ?").get(req.params.id);
    if (!link) return res.status(404).json({ error: "Not found" });
    const o = readLinkOpts(req.body || {}, { creating: false });
    const keys = Object.keys(o);
    if (!keys.length) return res.json({ ok: true });
    db.prepare(`UPDATE links SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @__id`).run({ ...o, __id: link.id });
    if (o.password_hash) { db.prepare("UPDATE links SET fail_count = 0, locked_until = NULL WHERE id = ?").run(link.id); }
    log(req, link.id, o.password_hash ? "admin_password_changed" : "admin_link_edited");
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "Could not update link" }); }
});
router.post("/api/links/:id/revoke", requireAdmin, (req, res) => {
  db.prepare("UPDATE links SET revoked = 1 WHERE id = ?").run(req.params.id);
  log(req, +req.params.id, "admin_link_revoked");
  res.json({ ok: true });
});
router.post("/api/links/:id/restore", requireAdmin, (req, res) => {
  db.prepare("UPDATE links SET revoked = 0, fail_count = 0, locked_until = NULL WHERE id = ?").run(req.params.id);
  log(req, +req.params.id, "admin_link_restored");
  res.json({ ok: true });
});
router.post("/api/links/:id/unlock-lock", requireAdmin, (req, res) => {
  db.prepare("UPDATE links SET fail_count = 0, locked_until = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
router.delete("/api/links/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM links WHERE id = ?").run(req.params.id);
  log(req, null, "admin_link_deleted", { note: "#" + req.params.id });
  res.json({ ok: true });
});

// ================= viewer sessions ("who opened it") =================
const SESS_LIST = `s.id, s.link_id, s.name, s.email, s.ip, s.country, s.country_code, s.region, s.city, s.isp, s.browser, s.os, s.device,
  s.device_id, s.started_at, s.last_seen, s.active_seconds, s.max_page, s.flags, s.ended, s.ended_reason, s.ack, l.label, d.title AS doc_title, d.pages`;
router.get("/api/sessions", requireAdmin, (req, res) => {
  const where = [], p = [];
  if (req.query.link_id) { where.push("s.link_id = ?"); p.push(parseInt(req.query.link_id, 10) || 0); }
  if (req.query.flagged === "1") where.push("s.flags != ''");
  if (req.query.live === "1") { where.push("s.ended = 0 AND s.last_seen >= ?"); p.push(U.nowSql(new Date(Date.now() - 60000))); }
  if (req.query.q) { const q = `%${String(req.query.q).slice(0, 80)}%`; where.push("(s.ip LIKE ? OR s.name LIKE ? OR s.email LIKE ? OR s.city LIKE ? OR s.country LIKE ? OR l.label LIKE ? OR s.device_id LIKE ?)"); p.push(q, q, q, q, q, q, q); }
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const rows = db.prepare(`SELECT ${SESS_LIST} FROM viewer_sessions s JOIN links l ON l.id = s.link_id JOIN docs d ON d.id = l.doc_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.started_at DESC LIMIT ?`).all(...p, limit);
  const liveCut = Date.now() - 60000;
  res.json(rows.map((r) => ({ ...r, live: !r.ended && U.parseSql(r.last_seen).getTime() >= liveCut })));
});

router.get("/api/sessions/:id", requireAdmin, (req, res) => {
  const s = db.prepare(`SELECT s.*, l.label, l.token, d.title AS doc_title, d.pages FROM viewer_sessions s JOIN links l ON l.id = s.link_id JOIN docs d ON d.id = l.doc_id WHERE s.id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  let fp = {}, dwell = {}; try { fp = JSON.parse(s.fp || "{}"); } catch {} try { dwell = JSON.parse(s.dwell || "{}"); } catch {}
  delete s.secret_hash; delete s.pw_tag; delete s.fp; delete s.token;
  const events = db.prepare("SELECT id, event, note, created_at FROM logs WHERE session_id = ? ORDER BY id ASC LIMIT 400").all(s.id);
  const sameDevice = s.device_id ? db.prepare("SELECT COUNT(*) c, COUNT(DISTINCT link_id) l, COUNT(DISTINCT ip) i FROM viewer_sessions WHERE device_id = ?").get(s.device_id) : null;
  const sameIp = db.prepare("SELECT COUNT(*) c FROM viewer_sessions WHERE ip = ?").get(s.ip).c;
  const blocked = !!core.isBlockedIp.get(s.ip);
  res.json({ ...s, fp, dwell, events, sameDevice, sameIp, blocked, live: !s.ended && U.parseSql(s.last_seen).getTime() >= Date.now() - 60000 });
});
router.post("/api/sessions/:id/end", requireAdmin, (req, res) => {
  const r = db.prepare("UPDATE viewer_sessions SET ended = 1, ended_reason = 'admin', ended_at = ? WHERE id = ? AND ended = 0").run(U.nowSql(), req.params.id);
  log(req, null, "admin_session_ended", { session_id: req.params.id });
  res.json({ ok: true, changed: r.changes });
});

// ================= activity log =================
router.get("/api/logs", requireAdmin, (req, res) => {
  const where = [], p = [];
  if (req.query.link_id) { where.push("lg.link_id = ?"); p.push(parseInt(req.query.link_id, 10) || 0); }
  if (req.query.session_id) { where.push("lg.session_id = ?"); p.push(String(req.query.session_id).slice(0, 40)); }
  if (req.query.event) { const evs = String(req.query.event).split(",").slice(0, 20); where.push(`lg.event IN (${evs.map(() => "?").join(",")})`); p.push(...evs); }
  if (req.query.q) { const q = `%${String(req.query.q).slice(0, 80)}%`; where.push("(lg.ip LIKE ? OR lg.note LIKE ? OR lg.city LIKE ? OR lg.user_agent LIKE ?)"); p.push(q, q, q, q); }
  const limit = Math.min(parseInt(req.query.limit, 10) || 300, 2000);
  res.json(db.prepare(`SELECT lg.id, lg.link_id, lg.event, lg.ip, lg.forwarded_chain, lg.country, lg.geo_country, lg.city, lg.region, lg.isp, lg.browser, lg.os, lg.device,
      lg.language, lg.screen, lg.timezone, lg.platform, lg.session_id, lg.note, lg.user_agent, lg.created_at, l.label
    FROM logs lg LEFT JOIN links l ON l.id = lg.link_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY lg.id DESC LIMIT ?`).all(...p, limit));
});

// ================= security center =================
router.get("/api/security", requireAdmin, (req, res) => {
  res.json({
    https: req.secure || req.get("x-forwarded-proto") === "https",
    secureCookies: cfg.isProd,
    totp: !!activeTotp(), totpSource: cfg.totpSecret ? "env" : storedTotp() ? "panel" : null,
    persist: require("../lib/persist").status(),
    adminHash: cfg.adminIsHash,
    adminPwLen: cfg.adminIsHash ? null : cfg.adminPassword.length,
    separateDataKey: !!process.env.DATA_KEY,
    geo: cfg.geo, webhook: !!cfg.webhookUrl, retentionDays: cfg.retentionDays,
    trustProxyHops: cfg.trustProxyHops, publicUrl: cfg.publicUrl || null,
    connection: { ip: U.normIp(req.ip), xff: req.get("x-forwarded-for") || null, cfCountry: req.get("cf-ipcountry") || null, proto: req.get("x-forwarded-proto") || req.protocol, host: req.get("host") },
    blocked: db.prepare("SELECT ip, reason, created_at FROM blocked_ips ORDER BY created_at DESC").all(),
    adminSessions: db.prepare("SELECT COUNT(*) c FROM admin_sessions WHERE expires_at > ?").get(U.nowSql()).c,
  });
});
router.post("/api/blocked-ips", requireAdmin, (req, res) => {
  const ip = U.normIp((req.body || {}).ip);
  if (!IP_RE.test(ip)) return res.status(400).json({ error: "Enter a valid IP address" });
  db.prepare("INSERT OR REPLACE INTO blocked_ips (ip, reason) VALUES (?, ?)").run(ip, U.clip((req.body || {}).reason, 200));
  const n = db.prepare("UPDATE viewer_sessions SET ended = 1, ended_reason = 'blocked_ip', ended_at = ? WHERE ip = ? AND ended = 0").run(U.nowSql(), ip).changes;
  log(req, null, "admin_ip_blocked", { note: ip });
  res.json({ ok: true, ended: n });
});
router.delete("/api/blocked-ips/:ip", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM blocked_ips WHERE ip = ?").run(req.params.ip);
  log(req, null, "admin_ip_unblocked", { note: req.params.ip });
  res.json({ ok: true });
});

module.exports = router;
