"use strict";
const path = require("path");
const e = process.env;
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

const cfg = {
  port: int(e.PORT, 3000),
  isProd: e.NODE_ENV === "production",
  dataDir: e.DATA_DIR || path.join(__dirname, "..", "data"),
  adminPassword: e.ADMIN_PASSWORD || "",           // plain text OR a bcrypt hash ($2...)
  sessionSecret: e.SESSION_SECRET || "",
  dataKey: e.DATA_KEY || e.SESSION_SECRET || "",   // encrypts stored PDFs (AES-256-GCM)
  totpSecret: (e.ADMIN_TOTP_SECRET || "").replace(/\s/g, "").toUpperCase(),
  maxUploadMb: int(e.MAX_UPLOAD_MB, 50),
  maxPages: int(e.MAX_PAGES, 400),
  trustProxyHops: int(e.TRUST_PROXY_HOPS, 1),
  webhookUrl: e.WEBHOOK_URL || "",
  geo: (e.GEO_LOOKUP || "on").toLowerCase() !== "off",
  retentionDays: int(e.LOG_RETENTION_DAYS, 180),
  appName: (e.APP_NAME || "Secure PDF Share").slice(0, 60),
  publicUrl: (e.PUBLIC_URL || e.RENDER_EXTERNAL_URL || "").replace(/\/+$/, ""),
  renderConcurrency: int(e.RENDER_CONCURRENCY, 2),
};

const fatal = [];
const isHash = cfg.adminPassword.startsWith("$2");
if (!isHash && cfg.adminPassword.length < 8) fatal.push("ADMIN_PASSWORD is required (min 8 characters, 12+ recommended) or a bcrypt hash.");
if (cfg.sessionSecret.length < 24) fatal.push("SESSION_SECRET is required (min 24 characters).");
if (fatal.length) {
  console.error("\nConfiguration error:\n - " + fatal.join("\n - ") + "\n");
  process.exit(1);
}
if (!isHash && cfg.adminPassword.length < 12) console.warn("[warn] ADMIN_PASSWORD is shorter than 12 characters. Use a longer passphrase and enable 2FA (ADMIN_TOTP_SECRET).");
if (!cfg.totpSecret) console.warn("[warn] Admin 2FA is OFF. Run `npm run totp` and set ADMIN_TOTP_SECRET.");
if (cfg.isProd && !e.DATA_KEY) console.warn("[warn] DATA_KEY not set; PDFs are encrypted with a key derived from SESSION_SECRET. Changing SESSION_SECRET would make stored PDFs unreadable. Set a separate, permanent DATA_KEY.");

cfg.adminIsHash = isHash;
module.exports = cfg;
