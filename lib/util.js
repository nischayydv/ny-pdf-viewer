"use strict";
const crypto = require("crypto");

const nowSql = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");
const addMinutes = (min, d = new Date()) => nowSql(new Date(d.getTime() + min * 60000));
/** Parse "YYYY-MM-DD HH:MM:SS" (UTC) into a Date */
const parseSql = (s) => (s ? new Date(String(s).replace(" ", "T") + "Z") : null);
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const rand = (n = 24) => crypto.randomBytes(n).toString("base64url");
const clip = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function normIp(ip) {
  if (!ip) return "";
  ip = String(ip).trim();
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7); // IPv4-mapped IPv6
  return ip.slice(0, 64);
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip === "localhost") return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

module.exports = { nowSql, addMinutes, parseSql, sha256, rand, clip, safeEqual, normIp, isPrivateIp, escapeHtml, EMAIL_RE };
