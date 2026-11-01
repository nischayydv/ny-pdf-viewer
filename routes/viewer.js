"use strict";
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const core = require("../lib/core");
const U = require("../lib/util");
const views = require("../lib/views");
const render = require("../lib/render");
const { notify } = require("../lib/notify");
const { db, cfg, log, addFlag, recomputeFlags, geoFillSession, getLinkByToken, linkState, isLocked, ipAllowed, isBlockedIp } = core;

const router = express.Router();
const PDF_DIR = path.join(cfg.dataDir, "pdfs");
const TIERS = [240, 640, 1000, 1400, 1900];

const MSG = {
  missing: "This link is not valid.",
  revoked: "This link has been disabled by the owner.",
  expired: "This link has expired.",
  limit: "This link has reached its maximum number of openings.",
  locked: "Too many incorrect password attempts. This link is temporarily locked — please try again in a few minutes.",
  blocked: "Access from your network has been blocked.",
  ip: "This document cannot be opened from your network location.",
  device: "This link is already in use on the maximum number of devices.",
};

const unlockLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).type("html").send(views.unavailablePage("Too many attempts from your network. Please try again later.", "warn")) });
const beaconLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false });
const imageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false });

const noStore = (res) => res.set({ "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" });
const html = (res, status, body) => noStore(res).status(status).type("html").send(body);

// ---------- cookies ----------
const SECURE = cfg.isProd;
const cookieOpts = (maxAge, sameSite = "lax") => ({ httpOnly: true, sameSite, secure: SECURE, maxAge, path: "/" });
const vsName = (link) => (SECURE ? "__Secure-" : "") + "vs_" + link.id;
const VID = SECURE ? "__Secure-vid" : "vid";

function ensureVisitor(req, res) {
  let vid = req.cookies[VID];
  if (typeof vid !== "string" || !/^[A-Za-z0-9_-]{16,40}$/.test(vid)) {
    vid = U.rand(18);
    res.cookie(VID, vid, cookieOpts(365 * 24 * 3600 * 1000));
  }
  return vid;
}

// ---------- session resolution ----------
const getSession = db.prepare("SELECT * FROM viewer_sessions WHERE id = ?");
const touch = db.prepare("UPDATE viewer_sessions SET last_seen = ? WHERE id = ?");
const endSession = db.prepare("UPDATE viewer_sessions SET ended = 1, ended_reason = ?, ended_at = ? WHERE id = ? AND ended = 0");

/** -> { s, reason }  (s is null when the visitor has no valid session) */
function resolve(req, link) {
  const raw = req.cookies[vsName(link)];
  if (typeof raw !== "string") return { s: null, reason: "none" };
  const [sid, secret] = raw.split(".");
  if (!sid || !secret) return { s: null, reason: "none" };
  const s = getSession.get(sid);
  if (!s || s.link_id !== link.id || !U.safeEqual(U.sha256(secret), s.secret_hash)) return { s: null, reason: "none" };
  if (s.ended) return { s: null, reason: s.ended_reason || "ended" };
  if (s.pw_tag !== link.password_hash.slice(-16)) { endSession.run("password_changed", U.nowSql(), s.id); return { s: null, reason: "password_changed" }; }
  if (U.parseSql(s.expires_at) < new Date()) { endSession.run("timeout", U.nowSql(), s.id); return { s: null, reason: "timeout" }; }
  const st = linkState(link);
  if (st !== "ok" && st !== "limit") { endSession.run(st, U.nowSql(), s.id); return { s: null, reason: st }; } // revoked / expired kills live sessions
  touch.run(U.nowSql(), s.id);
  return { s, reason: null };
}

const REASON_TEXT = {
  admin: "This session was ended by the document owner.",
  revoked: "This link has been disabled by the owner.",
  expired: "This link has expired.",
  timeout: "Your viewing session timed out. Reload and unlock again to continue.",
  password_changed: "The access password was changed. Please unlock again.",
  device_limit: "This link is already in use on the maximum number of devices.",
  blocked_ip: "Access from your network has been blocked.",
  none: "Your session is no longer valid. Reload and unlock again.",
  ended: "Your session has ended.",
};

// ---------- common gate checks ----------
function gateCheck(req, res, link, { json = false, allowLimit = false } = {}) {
  const deny = (status, key, event) => {
    if (link) log(req, link.id, event);
    if (json) return res.status(status).json({ error: key, ended: true, reason: key, message: MSG[key] });
    html(res, status, views.unavailablePage(MSG[key], key === "locked" ? "warn" : "ban"));
    return true;
  };
  if (!link) { if (json) res.status(404).json({ error: "missing" }); else html(res, 404, views.unavailablePage(MSG.missing)); return true; }
  const ip = U.normIp(req.ip);
  if (isBlockedIp.get(ip)) return deny(403, "blocked", "blocked_ip");
  const st = linkState(link);
  // an already-open session keeps working after the unlock limit is reached; only NEW unlocks are refused
  if (st !== "ok" && !(st === "limit" && allowLimit)) return deny(410, st, "blocked_" + st);
  if (!ipAllowed(link, ip)) return deny(403, "ip", "blocked_ip_policy");
  return false;
}

// ---------- pages ----------
router.get("/:token", (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (gateCheck(req, res, link, { allowLimit: true })) return;
  ensureVisitor(req, res);
  const { s } = resolve(req, link);
  if (s) return html(res, 200, views.viewerPage({ title: link.title, token: link.token }));
  if (linkState(link) === "limit") return html(res, 410, views.unavailablePage(MSG.limit));
  if (isLocked(link)) return html(res, 429, views.unavailablePage(MSG.locked, "warn"));
  html(res, 200, views.unlockPage({ link, token: link.token }));
});

router.post("/:token/unlock", unlockLimiter, (req, res, next) => { unlock(req, res).catch(next); });
async function unlock(req, res) {
  const link = getLinkByToken.get(req.params.token);
  if (gateCheck(req, res, link)) return;
  const vid = ensureVisitor(req, res);
  const ip = U.normIp(req.ip);
  if (isLocked(link)) { log(req, link.id, "blocked_locked"); return html(res, 429, views.unavailablePage(MSG.locked, "warn")); }

  const b = req.body || {};
  const values = { name: U.clip(b.name, 80) || "", email: (U.clip(b.email, 160) || "").toLowerCase() };
  const again = (error, status = 401) => html(res, status, views.unlockPage({ link, token: link.token, error, values }));

  if (link.require_identity) {
    if (values.name.trim().length < 2) return again("Please enter your full name.", 400);
    if (!U.EMAIL_RE.test(values.email)) return again("Please enter a valid email address.", 400);
  }
  if (link.require_ack && b.ack !== "1") return again("Please accept the confidentiality terms to continue.", 400);

  // password check (bcrypt compare is constant-time for a given hash)
  if (!(await bcrypt.compare(String(b.password || "").slice(0, 256), link.password_hash))) { // async: never blocks other viewers
    log(req, link.id, "unlock_failed", { note: values.email ? `as ${values.email}` : null });
    const fails = link.fail_count + 1;
    if (fails >= 10) {
      db.prepare("UPDATE links SET fail_count = 0, locked_until = ? WHERE id = ?").run(U.addMinutes(15), link.id);
      log(req, link.id, "link_locked");
      notify(`Link "${link.label || link.title}" locked for 15 min after 10 wrong passwords (last from ${ip}).`);
    } else {
      db.prepare("UPDATE links SET fail_count = ? WHERE id = ?").run(fails, link.id);
      if (fails === 3) notify(`3 wrong passwords on link "${link.label || link.title}" from ${ip}.`);
    }
    return again("Incorrect password.");
  }

  // device limit (first line of defence: browser cookie; second line: fingerprint, see beacon "hello")
  if (link.max_devices) {
    const known = db.prepare("SELECT DISTINCT visitor_id FROM viewer_sessions WHERE link_id = ? AND (ended_reason IS NULL OR ended_reason != 'device_limit')").all(link.id).map((r) => r.visitor_id);
    if (!known.includes(vid) && known.length >= link.max_devices) {
      log(req, link.id, "blocked_device_limit", { note: values.email || null });
      notify(`Device limit hit on link "${link.label || link.title}" from ${ip}.`);
      return html(res, 403, views.unavailablePage(MSG.device));
    }
  }

  // success -> create a server-side session (revocable)
  const info = core.clientInfo(req);
  const sid = U.rand(9).replace(/[-_]/g, "x").toLowerCase();
  const secret = U.rand(32);
  const mins = Math.min(Math.max(link.session_minutes || 60, 5), 24 * 60);
  db.prepare(`INSERT INTO viewer_sessions (id, link_id, secret_hash, pw_tag, visitor_id, name, email, ack, ip, forwarded_chain, country_code,
      user_agent, browser, os, device, language, referer, started_at, last_seen, expires_at)
    VALUES (@id,@link_id,@secret_hash,@pw_tag,@visitor_id,@name,@email,@ack,@ip,@fwd,@cc,@ua,@browser,@os,@device,@language,@referer,@t,@t,@exp)`)
    .run({ id: sid, link_id: link.id, secret_hash: U.sha256(secret), pw_tag: link.password_hash.slice(-16), visitor_id: vid,
      name: values.name || null, email: values.email || null, ack: link.require_ack ? 1 : 0, ip, fwd: info.forwarded_chain, cc: info.country,
      ua: info.user_agent, browser: info.browser, os: info.os, device: info.device, language: info.language, referer: info.referer,
      t: U.nowSql(), exp: U.addMinutes(mins) });
  db.prepare("UPDATE links SET view_count = view_count + 1, fail_count = 0 WHERE id = ?").run(link.id);
  log(req, link.id, "unlock_ok", { session_id: sid, note: values.email || null });
  geoFillSession(sid, ip);
  recomputeFlags(sid);
  notify(`${values.name || values.email || "Someone"} opened "${link.title}" (link "${link.label || "-"}") from ${ip} — ${info.browser || "?"} on ${info.os || "?"}.`);
  res.cookie(vsName(link), `${sid}.${secret}`, cookieOpts(mins * 60 * 1000));
  res.redirect(303, "/s/" + link.token);
}

// ---------- viewer data ----------
router.get("/:token/meta", (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (gateCheck(req, res, link, { json: true, allowLimit: true })) return;
  const { s, reason } = resolve(req, link);
  if (!s) return noStore(res).status(401).json({ error: "locked", reason, message: REASON_TEXT[reason] || REASON_TEXT.none });
  let ratios = []; try { ratios = JSON.parse(link.ratios || "[]"); } catch {}
  noStore(res).json({
    title: link.title, pages: link.pages || ratios.length, ratios, tiers: TIERS,
    sid: s.id, name: s.name, expiresAt: s.expires_at, startedAt: s.started_at,
  });
});

// LRU of rendered (already watermarked) pages, so zoom/scroll-back is instant
const cache = new Map(); let cacheBytes = 0;
const CACHE_MAX = 96 * 1024 * 1024;
function cacheGet(k) { const v = cache.get(k); if (v) { cache.delete(k); cache.set(k, v); } return v; }
function cacheSet(k, buf) {
  cache.set(k, buf); cacheBytes += buf.length;
  while (cacheBytes > CACHE_MAX && cache.size) { const [ok, ov] = cache.entries().next().value; cache.delete(ok); cacheBytes -= ov.length; }
}
const rate = new Map(); // sid -> {t, n}   per-session page-fetch ceiling (anti-scraping)
setInterval(() => { const cut = Date.now() - 120000; for (const [k, v] of rate) if (v.t < cut) rate.delete(k); }, 60000).unref();

router.get("/:token/p/:n", imageLimiter, async (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (gateCheck(req, res, link, { json: true, allowLimit: true })) return;
  const { s, reason } = resolve(req, link);
  if (!s) return noStore(res).status(401).json({ error: "locked", reason });
  // only our own viewer script may fetch pages: no plain navigation, no cross-site embedding
  if (req.get("x-viewer") !== "1" || req.get("sec-fetch-dest") === "document" || (req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin")) return res.status(403).end();

  const n = parseInt(req.params.n, 10);
  const w = TIERS.includes(parseInt(req.query.w, 10)) ? parseInt(req.query.w, 10) : 1000;
  if (!Number.isInteger(n) || n < 1 || n > (link.pages || 0)) return res.status(404).end();

  const r = rate.get(s.id) || { t: Date.now(), n: 0 };
  if (Date.now() - r.t > 60000) { r.t = Date.now(); r.n = 0; }
  if (++r.n > 160) { rate.set(s.id, r); addFlag(s.id, "bulk_fetch"); return res.status(429).end(); }
  rate.set(s.id, r);

  try {
    const key = `${s.id}:${n}:${w}`;
    let buf = cacheGet(key);
    if (!buf) {
      const who = s.name || s.email || "Viewer";
      const lines = [who, `${s.ip}  ·  ${s.started_at.slice(0, 16)} UTC`, `Session ${s.id.slice(0, 8)}`];
      buf = await render.renderPage(path.join(PDF_DIR, path.basename(link.stored_name)), n, w, lines, w <= 300 ? 72 : 84);
      cacheSet(key, buf);
    }
    noStore(res).set({ "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Content-Length": buf.length }).end(buf);
  } catch (err) {
    console.error("render failed", err.message);
    res.status(500).json({ error: "render_failed" });
  }
});

// ---------- telemetry ----------
const S = (v, n = 160) => (typeof v === "string" ? v.slice(0, n) : undefined);
const N = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const B = (v) => (typeof v === "boolean" ? v : undefined);
function sanitizeFp(o) {
  o = o && typeof o === "object" ? o : {};
  const out = {};
  for (const k of ["timezone", "locale", "platform", "vendor", "webglVendor", "webglRenderer", "canvasHash", "orientation", "colorScheme", "connType", "uaBrands", "uaPlatform", "uaPlatformVersion", "uaModel", "uaArch", "uaBitness", "uaFullVersion", "referrer", "dnt", "gamut"]) { const v = S(o[k], k === "uaBrands" ? 300 : 160); if (v !== undefined) out[k] = v; }
  for (const k of ["screenW", "screenH", "availW", "availH", "viewW", "viewH", "outerW", "outerH", "dpr", "colorDepth", "cores", "memory", "touch", "tzOffsetMin", "clientTime", "downlink", "rtt", "loadMs"]) { const v = N(o[k]); if (v !== undefined) out[k] = v; }
  for (const k of ["webdriver", "cookies", "online", "reducedMotion", "saveData", "pdfViewer"]) { const v = B(o[k]); if (v !== undefined) out[k] = v; }
  if (Array.isArray(o.languages)) out.languages = o.languages.slice(0, 8).map((x) => S(x, 20)).filter(Boolean);
  return out;
}
const deviceIdOf = (fp) => U.sha256(JSON.stringify([fp.canvasHash, fp.webglRenderer, fp.webglVendor, fp.screenW, fp.screenH, fp.colorDepth, fp.cores, fp.memory, fp.platform, fp.uaModel, fp.uaArch, fp.timezone, fp.touch, (fp.languages || []).join("|")])).slice(0, 16);

const EVENTS = new Set(["blocked_action", "devtools", "tab_hidden", "tab_visible", "closed", "fullscreen", "print_attempt", "copy_attempt", "screenshot_key"]);
const FLAG_FOR_EVENT = { devtools: "devtools" };

router.post("/:token/beacon", beaconLimiter, (req, res) => {
  const link = getLinkByToken.get(req.params.token);
  if (!link) return res.status(404).json({ ended: true, reason: "missing" });
  // allow beacons from live sessions even when the link just got revoked, so the client learns why
  const raw = req.cookies[vsName(link)];
  const sid = typeof raw === "string" ? raw.split(".")[0] : null;
  const { s, reason } = resolve(req, link);
  if (!s) {
    if (sid) return res.status(401).json({ ended: true, reason, message: REASON_TEXT[reason] || REASON_TEXT.none });
    return res.status(401).json({ ended: true, reason: "none", message: REASON_TEXT.none });
  }
  const b = req.body || {};
  const type = b.type;

  if (type === "hello") {
    const fp = sanitizeFp(b.fp);
    const deviceId = deviceIdOf(fp);
    db.prepare("UPDATE viewer_sessions SET fp = ?, device_id = ? WHERE id = ?").run(JSON.stringify(fp), deviceId, s.id);
    log(req, link.id, "device_info", { session_id: s.id, screen: fp.screenW ? `${fp.screenW}x${fp.screenH} @${fp.dpr || 1}x` : null, timezone: fp.timezone || null, platform: fp.platform || null });
    recomputeFlags(s.id);
    if (link.max_devices) {
      const others = db.prepare("SELECT DISTINCT device_id FROM viewer_sessions WHERE link_id = ? AND id != ? AND device_id IS NOT NULL AND (ended_reason IS NULL OR ended_reason != 'device_limit')").all(link.id, s.id).map((r) => r.device_id);
      if (!others.includes(deviceId) && others.length >= link.max_devices) {
        endSession.run("device_limit", U.nowSql(), s.id);
        log(req, link.id, "blocked_device_limit", { session_id: s.id, note: "fingerprint" });
        return res.json({ ended: true, reason: "device_limit", message: REASON_TEXT.device_limit });
      }
    }
    if (isBlockedIp.get(U.normIp(req.ip))) { endSession.run("blocked_ip", U.nowSql(), s.id); return res.json({ ended: true, reason: "blocked_ip", message: REASON_TEXT.blocked_ip }); }
    return res.json({ ok: true });
  }

  if (type === "hb") {
    const page = Math.min(Math.max(parseInt(b.page, 10) || 1, 1), link.pages || 1);
    const secs = Math.min(Math.max(parseInt(b.secs, 10) || 0, 0), 30);
    if (b.visible === true && secs) {
      let dwell = {}; try { dwell = JSON.parse(s.dwell || "{}"); } catch {}
      dwell[page] = (dwell[page] || 0) + secs;
      db.prepare("UPDATE viewer_sessions SET active_seconds = active_seconds + ?, dwell = ?, max_page = MAX(max_page, ?) WHERE id = ?").run(secs, JSON.stringify(dwell), page, s.id);
    } else db.prepare("UPDATE viewer_sessions SET max_page = MAX(max_page, ?) WHERE id = ?").run(page, s.id);
    return res.json({ ok: true });
  }

  if (EVENTS.has(type)) {
    log(req, link.id, type, { session_id: s.id, note: U.clip(b.note, 200) });
    if (FLAG_FOR_EVENT[type]) addFlag(s.id, FLAG_FOR_EVENT[type]);
    if (type === "screenshot_key") addFlag(s.id, "capture_attempt");
    if (type === "closed") db.prepare("UPDATE viewer_sessions SET last_seen = ? WHERE id = ?").run(U.nowSql(), s.id);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: "bad_event" });
});

module.exports = router;
