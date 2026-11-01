"use strict";
/** Shared building blocks: request fingerprinting, event log, session flags, link state. */
const UAParser = require("ua-parser-js");
const cfg = require("./config");
const db = require("./db");
const geo = require("./geo");
const U = require("./util");

function clientInfo(req) {
  const ua = req.get("user-agent") || "";
  const p = new UAParser(ua).getResult();
  const cc = (req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || "").toUpperCase().slice(0, 2);
  return {
    ip: U.normIp(req.ip),
    forwarded_chain: U.clip(req.get("x-forwarded-for"), 300),
    country: cc && cc !== "XX" ? cc : null,
    user_agent: ua.slice(0, 500),
    browser: [p.browser.name, p.browser.version].filter(Boolean).join(" ") || null,
    os: [p.os.name, p.os.version].filter(Boolean).join(" ") || null,
    device: [p.device.vendor, p.device.model, p.device.type].filter(Boolean).join(" ") || "Desktop / unknown",
    language: U.clip(req.get("accept-language"), 120),
    referer: U.clip(req.get("referer"), 300),
  };
}

const insertLog = db.prepare(`
  INSERT INTO logs (link_id, event, ip, forwarded_chain, country, user_agent, browser, os, device, language, referer,
                    screen, timezone, platform, session_id, note)
  VALUES (@link_id, @event, @ip, @forwarded_chain, @country, @user_agent, @browser, @os, @device, @language, @referer,
          @screen, @timezone, @platform, @session_id, @note)`);
const fillLogGeo = db.prepare("UPDATE logs SET city=?, region=?, geo_country=?, isp=? WHERE id=?");
const fillSessionGeo = db.prepare(`UPDATE viewer_sessions SET country=?, country_code=?, region=?, city=?, isp=?, asn=?,
  lat=?, lon=?, geo_tz=?, geo_tz_offset=? WHERE id=?`);

function log(req, linkId, event, extra = {}) {
  const info = clientInfo(req);
  const row = { link_id: linkId, event, screen: null, timezone: null, platform: null, session_id: null, note: null, ...info, ...extra };
  let id;
  try { id = insertLog.run(row).lastInsertRowid; }
  catch (e) { try { id = insertLog.run({ ...row, link_id: null, note: `${row.note || ""} (link #${linkId} not found)`.trim() }).lastInsertRowid; } catch { return null; } }
  if (cfg.geo) geo.lookup(info.ip).then((g) => { if (g) fillLogGeo.run(g.city, g.region, g.country, g.isp, id); }).catch(() => {});
  return id;
}

// ---- viewer-session risk flags ----
const getSession = db.prepare("SELECT * FROM viewer_sessions WHERE id = ?");
function addFlag(sid, flag) {
  const s = getSession.get(sid);
  if (!s) return;
  const set = new Set((s.flags || "").split(",").filter(Boolean));
  if (set.has(flag)) return;
  set.add(flag);
  db.prepare("UPDATE viewer_sessions SET flags = ? WHERE id = ?").run([...set].join(","), sid);
}
/** Derive flags from stored facts (idempotent; safe to call repeatedly). */
function recomputeFlags(sid) {
  const s = getSession.get(sid);
  if (!s) return;
  let fp = {}; try { fp = JSON.parse(s.fp || "{}"); } catch {}
  if (fp.webdriver || /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium/i.test(s.user_agent || "")) addFlag(sid, "automation");
  if (typeof fp.tzOffsetMin === "number" && typeof s.geo_tz_offset === "number" && Math.abs(fp.tzOffsetMin - s.geo_tz_offset) > 75) addFlag(sid, "tz_mismatch");
  if (typeof fp.clientTime === "number" && Math.abs(fp.clientTime - Date.now()) > 10 * 60 * 1000) addFlag(sid, "clock_skew");
}
function geoFillSession(sid, ip) {
  if (!cfg.geo) return;
  geo.lookup(ip).then((g) => {
    if (!g) return;
    fillSessionGeo.run(g.country, g.country_code, g.region, g.city, g.isp, g.asn, g.lat, g.lon, g.tz, g.tzOffsetMin, sid);
    recomputeFlags(sid);
  }).catch(() => {});
}

// ---- links ----
const getLinkByToken = db.prepare(`SELECT l.*, d.stored_name, d.title, d.pages, d.ratios FROM links l JOIN docs d ON d.id = l.doc_id WHERE l.token = ?`);
function linkState(link) {
  if (!link) return "missing";
  if (link.revoked) return "revoked";
  if (link.expires_at && U.parseSql(link.expires_at) < new Date()) return "expired";
  if (link.max_views && link.view_count >= link.max_views) return "limit";
  return "ok";
}
function isLocked(link) { return !!(link.locked_until && U.parseSql(link.locked_until) > new Date()); }

function ipAllowed(link, ip) {
  if (!link.allow_ips) return true;
  const list = link.allow_ips.split(/[\s,]+/).filter(Boolean);
  return !list.length || list.includes(ip);
}
const isBlockedIp = db.prepare("SELECT 1 FROM blocked_ips WHERE ip = ?");

function publicBase(req) {
  return cfg.publicUrl || `${req.protocol}://${req.get("host")}`;
}

module.exports = { clientInfo, log, addFlag, recomputeFlags, geoFillSession, getLinkByToken, linkState, isLocked, ipAllowed, isBlockedIp, publicBase, db, cfg };
