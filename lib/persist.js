"use strict";
/**
 * Keeps the app's data alive across restarts on hosts with no persistent disk (e.g. Render free).
 * The local SQLite file stays the live database. When MONGODB_URI is set, a consistent snapshot of it
 * (plus the already-encrypted PDFs) is mirrored into MongoDB GridFS, and restored on boot.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const cfg = require("./config");

const URI = process.env.MONGODB_URI || "";
const TEST_DIR = process.env.PERSIST_TEST_DIR || ""; // test-only: use a folder instead of MongoDB
const enabled = !!(URI || TEST_DIR);
const INTERVAL = Math.max(5, parseInt(process.env.BACKUP_INTERVAL_SEC, 10) || 20) * 1000;
const DBFILE = path.join(cfg.dataDir, "app.db");
const PDFDIR = path.join(cfg.dataDir, "pdfs");
const TMPDIR = path.join(cfg.dataDir, "tmp");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { enabled, ready: false, lastBackup: null, lastError: null, restored: null };
let store, client, db, busy = false, lastChanges = -1, lastPdfKey = "", timer = null;

/* ---------- storage backends ---------- */
async function mongoStore() {
  const { MongoClient, GridFSBucket } = require("mongodb");
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000, appName: "secure-pdf-share" });
  await client.connect();
  const bucket = new GridFSBucket(client.db(process.env.MONGODB_DB || "secure_pdf_share"), { bucketName: "files" });
  return {
    async list() { return (await bucket.find({}).toArray()).map((f) => ({ name: f.filename, id: f._id, length: f.length, date: f.uploadDate })); },
    async put(name, src, gz) {
      const out = bucket.openUploadStream(name);
      await pipeline(fs.createReadStream(src), ...(gz ? [zlib.createGzip()] : []), out);
    },
    async get(name, dest, gz) {
      const tmp = dest + ".part";
      await pipeline(bucket.openDownloadStreamByName(name), ...(gz ? [zlib.createGunzip()] : []), fs.createWriteStream(tmp, { mode: 0o600 }));
      fs.renameSync(tmp, dest);
    },
    async del(id) { await bucket.delete(id); },
    async close() { await client.close(); },
  };
}
function dirStore() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const enc = (n) => encodeURIComponent(n);
  return {
    async list() {
      return fs.readdirSync(TEST_DIR).filter((f) => !f.endsWith(".part")).map((f) => {
        const m = /^(\d+)__(.*)$/.exec(f), p = path.join(TEST_DIR, f);
        return { name: decodeURIComponent(m[2]), id: f, length: fs.statSync(p).size, date: new Date(+m[1]) };
      });
    },
    async put(name, src, gz) { const dest = path.join(TEST_DIR, `${Date.now()}__${enc(name)}`); await pipeline(fs.createReadStream(src), ...(gz ? [zlib.createGzip()] : []), fs.createWriteStream(dest)); },
    async get(name, dest, gz) {
      const f = (await this.list()).filter((x) => x.name === name).sort((a, b) => b.date - a.date)[0];
      await pipeline(fs.createReadStream(path.join(TEST_DIR, f.id)), ...(gz ? [zlib.createGunzip()] : []), fs.createWriteStream(dest + ".part"));
      fs.renameSync(dest + ".part", dest);
    },
    async del(id) { fs.unlinkSync(path.join(TEST_DIR, id)); },
    async close() {},
  };
}

/* ---------- restore (before the app opens its DB) ---------- */
async function restore() {
  if (!enabled) return;
  fs.mkdirSync(PDFDIR, { recursive: true, mode: 0o700 }); fs.mkdirSync(TMPDIR, { recursive: true, mode: 0o700 });
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      store = TEST_DIR ? dirStore() : await mongoStore();
      const files = await store.list();
      const dbs = files.filter((f) => f.name === "app.db").sort((a, b) => b.date - a.date);
      if (dbs.length && !fs.existsSync(DBFILE)) {
        await store.get("app.db", DBFILE, true);
        for (const s of ["-wal", "-shm"]) try { fs.unlinkSync(DBFILE + s); } catch {}
        state.restored = { at: new Date().toISOString(), from: dbs[0].date };
        console.log("[persist] restored database from MongoDB backup of " + dbs[0].date.toISOString());
      } else if (!dbs.length) console.log("[persist] no backup found yet (first run). One will be created automatically.");
      let n = 0;
      for (const f of files) {
        if (!f.name.startsWith("pdf/")) continue;
        const dest = path.join(PDFDIR, path.basename(f.name.slice(4)));
        if (!fs.existsSync(dest)) { await store.get(f.name, dest, false); n++; }
      }
      if (n) console.log(`[persist] restored ${n} PDF file(s)`);
      state.ready = true;
      return;
    } catch (e) {
      lastErr = e; state.lastError = e.message;
      console.error(`[persist] could not reach MongoDB (attempt ${attempt}/4): ${e.message}`);
      try { await store?.close(); } catch {}
      await sleep(2500 * attempt);
    }
  }
  // Refusing to start is deliberate: starting empty would later overwrite the good backup.
  console.error("[persist] Giving up. In MongoDB Atlas open Network Access and allow 0.0.0.0/0, and check MONGODB_URI (user/password). Last error: " + lastErr?.message);
  process.exit(1);
}

/* ---------- backup ---------- */
function pdfList(all) {
  const now = Date.now();
  return fs.readdirSync(PDFDIR).map((n) => ({ n, s: fs.statSync(path.join(PDFDIR, n)) }))
    .filter((x) => x.s.isFile() && (all || now - x.s.mtimeMs > 3000)); // skip files still being written
}
async function backup(force) {
  if (!state.ready || busy) return;
  db = db || require("./db");
  const changes = db.prepare("SELECT total_changes() AS c").get().c;
  const pdfs = pdfList(force); // on shutdown (force) include files of any age
  const pdfKey = pdfs.map((x) => x.n + ":" + x.s.size).sort().join("|");
  if (!force && changes === lastChanges && pdfKey === lastPdfKey) return;
  busy = true;
  const snap = path.join(TMPDIR, "snapshot.db");
  try {
    let files = await store.list();
    const remote = new Map(files.filter((f) => f.name.startsWith("pdf/")).map((f) => [f.name, f]));
    for (const x of pdfs) { // PDFs first, so the DB snapshot never points at a missing file
      const name = "pdf/" + x.n, r = remote.get(name);
      if (r && r.length === x.s.size) continue;
      if (r) await store.del(r.id);
      await store.put(name, path.join(PDFDIR, x.n), false);
    }
    const local = new Set(fs.readdirSync(PDFDIR).map((n) => "pdf/" + n));
    for (const [name, r] of remote) if (!local.has(name)) await store.del(r.id);
    try { fs.unlinkSync(snap); } catch {}
    await db.backup(snap);
    await store.put("app.db", snap, true);
    files = await store.list();
    const old = files.filter((f) => f.name === "app.db").sort((a, b) => b.date - a.date).slice(1);
    for (const f of old) await store.del(f.id);
    lastChanges = changes; lastPdfKey = pdfKey;
    state.lastBackup = new Date().toISOString(); state.lastError = null;
  } catch (e) {
    state.lastError = e.message; console.error("[persist] backup failed:", e.message);
  } finally { busy = false; try { fs.unlinkSync(snap); } catch {} }
}

function start() {
  if (!enabled) return;
  setTimeout(() => backup(true), 3000).unref();
  timer = setInterval(() => backup(false), INTERVAL); timer.unref();
}
/** Called on shutdown: one last backup so nothing recent is lost. */
async function flush() {
  if (!enabled || !state.ready) return;
  clearInterval(timer);
  for (let i = 0; i < 50 && busy; i++) await sleep(100);
  await Promise.race([backup(true), sleep(6000)]);
  try { await store.close(); } catch {}
}
const status = () => ({ enabled: state.enabled, kind: TEST_DIR ? "test" : "mongodb", ready: state.ready, lastBackup: state.lastBackup, lastError: state.lastError, restored: state.restored });

module.exports = { restore, start, flush, status, enabled };
