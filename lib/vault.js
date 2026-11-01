"use strict";
/** AES-256-GCM encryption for PDFs at rest. A leaked disk or backup exposes only ciphertext. */
const crypto = require("crypto");
const fs = require("fs");
const cfg = require("./config");

const MAGIC = Buffer.from("SPDF1");
const key = crypto.scryptSync(cfg.dataKey, "secure-pdf-share/vault/v2", 32);

const isEncrypted = (buf) => buf.length > 33 && buf.subarray(0, 5).equals(MAGIC);

function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function decryptBuffer(buf) {
  if (!isEncrypted(buf)) return buf; // legacy / not-yet-migrated plaintext
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(5, 17));
  d.setAuthTag(buf.subarray(17, 33));
  return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}
async function encryptFileInPlace(file) {
  const raw = await fs.promises.readFile(file);
  if (isEncrypted(raw)) return false;
  const tmp = file + ".enc";
  await fs.promises.writeFile(tmp, encryptBuffer(raw), { mode: 0o600 });
  await fs.promises.rename(tmp, file);
  return true;
}

module.exports = { encryptBuffer, decryptBuffer, encryptFileInPlace, isEncrypted };
