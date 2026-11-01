"use strict";
const cfg = require("./config");
const { escapeHtml: e } = require("./util");

const ICON = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  stamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20h14M7 16h10l-1-4a3 3 0 1 0-8 0l-1 4Z"/><path d="M12 8V5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>',
};

function layout({ title, body, cls = "", script }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="color-scheme" content="dark light">
<title>${e(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="${cls}">
${body}
${script ? `<script src="${script}"></script>` : ""}
</body>
</html>`;
}

const brandBlock = () => `
  <div class="brand"><span class="brand-mark">${ICON.shield}</span><span>${e(cfg.appName)}</span></div>`;

function gate(inner) {
  return `
<div class="gate">
  <aside class="gate-brand">
    ${brandBlock()}
    <div class="gate-hero">
      <h2>Private document,<br>shared securely.</h2>
      <p>This file is protected. Access is personal, monitored and limited to the people it was shared with.</p>
      <ul class="gate-points">
        <li><span>${ICON.lock}</span><div><b>Encrypted &amp; view-only</b><small>The original file is never sent to your device.</small></div></li>
        <li><span>${ICON.stamp}</span><div><b>Personally watermarked</b><small>Every page is stamped with your session details.</small></div></li>
        <li><span>${ICON.eye}</span><div><b>Access is recorded</b><small>IP address and device details are logged for security.</small></div></li>
      </ul>
    </div>
    <div class="gate-foot">&copy; ${new Date().getFullYear()} ${e(cfg.appName)}</div>
  </aside>
  <main class="gate-panel">${inner}</main>
</div>`;
}

function unlockPage({ link, token, error = "", values = {} }) {
  const ident = link.require_identity
    ? `<div class="field"><label for="name">Full name</label><input id="name" name="name" type="text" required maxlength="80" autocomplete="name" value="${e(values.name || "")}"></div>
       <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" required maxlength="160" autocomplete="email" value="${e(values.email || "")}"></div>`
    : "";
  const ack = link.require_ack
    ? `<label class="check"><input type="checkbox" name="ack" value="1" required><span>${e(link.ack_text || "I will keep this document confidential and will not share or copy it.")}</span></label>`
    : "";
  const body = gate(`
  <form class="gate-card" method="post" action="/s/${e(token)}/unlock" autocomplete="off">
    <div class="gate-icon">${ICON.lock}</div>
    <h1>${e(link.title)}</h1>
    <p class="muted">Enter your access details to open this document.</p>
    ${error ? `<div class="alert alert-bad" role="alert">${e(error)}</div>` : ""}
    ${ident}
    <div class="field"><label for="password">Access password</label>
      <div class="pw"><input id="password" name="password" type="password" required autofocus autocomplete="off" spellcheck="false"><button type="button" class="pw-toggle" aria-label="Show password" data-toggle-pw>${ICON.eye}</button></div></div>
    ${ack}
    <button class="btn btn-primary btn-lg btn-block" type="submit">Unlock document</button>
    <p class="fine">By continuing you agree that your IP address, device and browser details, and viewing activity are recorded for security purposes.</p>
  </form>`);
  return layout({ title: "Protected document", body, cls: "page-gate", script: "/assets/gate.js" });
}

function unavailablePage(message, kind = "ban") {
  const body = gate(`
  <div class="gate-card center-text">
    <div class="gate-icon gate-icon-bad">${ICON[kind] || ICON.ban}</div>
    <h1>Link unavailable</h1>
    <p class="muted">${e(message)}</p>
    <p class="fine">If you believe this is a mistake, contact the person who shared this document with you.</p>
  </div>`);
  return layout({ title: "Link unavailable", body, cls: "page-gate" });
}

function viewerPage({ title, token }) {
  const body = `
<div class="vapp" data-token="${e(token)}">
  <header class="vbar">
    <button class="vbtn" id="btn-thumbs" title="Pages (T)" aria-label="Toggle page thumbnails">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
    </button>
    <div class="vtitle"><span class="vlock">${ICON.lock}</span><span class="vtitle-text">${e(title)}</span></div>
    <div class="vgroup">
      <button class="vbtn" id="btn-prev" title="Previous page" aria-label="Previous page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
      <div class="vpage"><input id="page-input" inputmode="numeric" aria-label="Page number" value="1"><span id="page-total">/ –</span></div>
      <button class="vbtn" id="btn-next" title="Next page" aria-label="Next page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="vgroup vgroup-zoom">
      <button class="vbtn" id="btn-zout" title="Zoom out (-)" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
      <button class="vzoom" id="btn-fit" title="Fit to width (0)"><span id="zoom-label">100%</span></button>
      <button class="vbtn" id="btn-zin" title="Zoom in (+)" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>
    <button class="vbtn" id="btn-full" title="Full screen (F)" aria-label="Full screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
  </header>
  <div class="vprogress"><i id="progress"></i></div>
  <div class="vbody">
    <nav class="vthumbs" id="thumbs" aria-label="Pages"></nav>
    <main class="vstage" id="stage" tabindex="0"><div class="vloading" id="loading"><div class="spinner"></div><span>Preparing your secure view…</span></div></main>
  </div>
  <div class="vfoot" id="vfoot"><span class="dot"></span><span id="foot-text">Protected view</span></div>
  <div class="vshield hidden" id="shield"><div>${ICON.eye}<b>Window inactive</b><span>Click to continue viewing</span></div></div>
  <div class="vend hidden" id="ended"><div class="gate-card center-text"><div class="gate-icon gate-icon-bad">${ICON.ban}</div><h1 id="ended-title">Session ended</h1><p class="muted" id="ended-msg"></p><button class="btn btn-primary" id="btn-reload">Reload</button></div></div>
</div>`;
  return layout({ title, body, cls: "viewer", script: "/assets/viewer.js" });
}

module.exports = { unlockPage, unavailablePage, viewerPage, ICON };
