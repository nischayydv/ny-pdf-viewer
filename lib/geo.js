"use strict";
/**
 * IP -> location / ISP lookup (server side, cached). Uses the free https://ipwho.is service.
 * Set GEO_LOOKUP=off to disable (then only CDN-provided country headers are used).
 * Fails soft: a slow or blocked lookup never delays or breaks a request.
 */
const cfg = require("./config");
const { isPrivateIp } = require("./util");

const cache = new Map(); // ip -> { at, v }
const TTL = 24 * 3600 * 1000, NEG_TTL = 10 * 60 * 1000, MAX = 5000;

function offsetMinutes(tz) {
  if (!tz) return null;
  if (typeof tz.offset === "number") return Math.round(tz.offset / 60);
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz.utc || "");
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
}

async function lookup(ip) {
  if (!cfg.geo || isPrivateIp(ip)) return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < (hit.v ? TTL : NEG_TTL)) return hit.v;
  let v = null;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(3500), headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.success !== false) {
        v = {
          country: j.country || null, country_code: j.country_code || null, region: j.region || null, city: j.city || null,
          lat: typeof j.latitude === "number" ? j.latitude : null, lon: typeof j.longitude === "number" ? j.longitude : null,
          isp: (j.connection && (j.connection.isp || j.connection.org)) || null,
          asn: j.connection && j.connection.asn ? "AS" + j.connection.asn : null,
          tz: (j.timezone && j.timezone.id) || null, tzOffsetMin: offsetMinutes(j.timezone),
        };
      }
    }
  } catch { /* offline, blocked or rate-limited: ignore */ }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value);
  cache.set(ip, { at: Date.now(), v });
  return v;
}

module.exports = { lookup };
