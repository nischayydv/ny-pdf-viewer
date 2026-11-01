"use strict";
/**
 * Server-side PDF page renderer.
 * The PDF itself is never sent to the browser: each page is rasterised here,
 * the viewer's watermark is burned into the pixels, and only a JPEG leaves the server.
 */
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const vault = require("./vault");

// Bundled font so the watermark renders identically on any host (minimal containers often have no system fonts).
const FONT_DIR = path.join(__dirname, "..", "fonts");
try { for (const f of fs.readdirSync(FONT_DIR)) if (/\.(woff2?|ttf|otf)$/i.test(f)) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), /ext/.test(f) ? "WMSansExt" : "WMSans"); } catch (e) { console.warn("[render] bundled font not loaded:", e.message); }

let pdfjs = null;
async function lib() {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}
const PKG = path.dirname(require.resolve("pdfjs-dist/package.json"));
const FONTS = path.join(PKG, "standard_fonts") + path.sep;
const CMAPS = path.join(PKG, "cmaps") + path.sep;

async function open(file) {
  const p = await lib();
  // stored PDFs are AES-256-GCM encrypted; decrypt in memory only
  const data = new Uint8Array(vault.decryptBuffer(await fs.promises.readFile(file)));
  const task = p.getDocument({
    data, standardFontDataUrl: FONTS, cMapUrl: CMAPS, cMapPacked: true,
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0,
  });
  return task.promise;
}

/** Validate + inspect a PDF at upload time. Throws on encrypted/corrupt files. */
async function inspect(file, maxPages) {
  const doc = await open(file);
  try {
    if (doc.numPages > maxPages) throw new Error(`Too many pages (max ${maxPages})`);
    const ratios = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const v = pg.getViewport({ scale: 1 });
      ratios.push(+(v.height / v.width).toFixed(5));
      pg.cleanup();
    }
    return { pages: doc.numPages, ratios };
  } finally { doc.destroy(); }
}

// small LRU of open documents (parsing is the slow part on multi-page flips)
const docs = new Map();
const MAX_DOCS = 6;
async function getDoc(file) {
  if (docs.has(file)) { const d = docs.get(file); docs.delete(file); docs.set(file, d); return d; }
  const d = open(file);
  docs.set(file, d);
  d.catch(() => docs.delete(file));
  while (docs.size > MAX_DOCS) {
    const k = docs.keys().next().value; const old = docs.get(k); docs.delete(k);
    old.then((x) => x.destroy()).catch(() => {});
  }
  return d;
}
function forget(file) {
  const d = docs.get(file); docs.delete(file);
  if (d) d.then((x) => x.destroy()).catch(() => {});
}

// limit concurrent renders so a burst can't exhaust CPU/RAM
let active = 0; const queue = [];
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.RENDER_CONCURRENCY || "2", 10) || 2);
function slot() {
  return new Promise((res) => {
    const go = () => { active++; res(() => { active--; if (queue.length) queue.shift()(); }); };
    active < MAX_CONCURRENT ? go() : queue.push(go);
  });
}

function watermark(ctx, w, h, lines) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 7);
  const fs_ = Math.max(13, Math.round(w / 52));
  ctx.font = `600 ${fs_}px WMSans, WMSansExt, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const stepY = fs_ * 5.2, stepX = Math.max(w * 0.62, 320);
  const diag = Math.hypot(w, h);
  let row = 0;
  for (let y = -diag / 2; y < diag / 2; y += stepY, row++) {
    for (let x = -diag / 2 + (row % 2 ? stepX / 2 : 0); x < diag / 2; x += stepX) {
      ctx.fillStyle = "rgba(20,30,60,0.10)";
      lines.forEach((t, i) => ctx.fillText(t, x, y + i * fs_ * 1.25));
    }
  }
  ctx.restore();
  // tiny low-contrast footer stamp (survives cropping of the diagonal tiles)
  ctx.save();
  ctx.font = `600 ${Math.max(9, Math.round(w / 90))}px WMSans, WMSansExt, sans-serif`;
  ctx.fillStyle = "rgba(0,0,0,0.38)"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillText(lines.join("  |  "), 8, h - 6);
  ctx.restore();
}

/** Render one page to a watermarked JPEG buffer. width = output pixel width. */
async function renderPage(file, pageNo, width, wmLines, quality = 82) {
  const release = await slot();
  try {
    const doc = await getDoc(file);
    if (pageNo < 1 || pageNo > doc.numPages) throw new Error("page out of range");
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    // clamp the output so an absurdly tall/large page can never allocate a huge canvas
    const scale = Math.min(width / base.width, 9000 / base.height, 40);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    page.cleanup();
    if (wmLines && wmLines.length) watermark(ctx, canvas.width, canvas.height, wmLines);
    return canvas.encode("jpeg", quality);
  } finally { release(); }
}

module.exports = { inspect, renderPage, forget };
