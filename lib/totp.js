"use strict";
/** RFC 6238 TOTP (Google Authenticator / Authy / 1Password compatible), dependency-free. */
const crypto = require("crypto");
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of s.replace(/=+$/, "")) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error("Invalid base32 secret");
    val = ((val << 5) | i) & 0xfff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function b32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = ((val << 8) | b) & 0xfffff; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}
function hotp(key, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(b).digest();
  const o = h[19] & 15;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(n).padStart(6, "0");
}
let lastStep = -1; // replay protection: a code can be used once
/** Returns true if `code` is valid for the current 30s window (+/- 1 step for clock drift). */
function verify(secretB32, code) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const key = b32decode(secretB32);
  const step = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) {
    const s = step + d;
    if (s <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(String(code)))) { lastStep = s; return true; }
  }
  return false;
}
const generateSecret = () => b32encode(crypto.randomBytes(20));

module.exports = { verify, generateSecret, hotp, b32decode };
