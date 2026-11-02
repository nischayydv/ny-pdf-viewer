(function () {
  "use strict";
  var root = document.getElementById("app");
  var S = { app: "Secure PDF Share", totp: false, docs: [], links: [], route: "overview", counts: { live: 0 } };
  var poll = null;

  // =============================================================== utilities
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "style") Object.assign(e.style, v);           // CSSOM only (CSP-safe)
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected" || k === "required" || k === "readonly") { if (v) e.setAttribute(k, k); }
      else e.setAttribute(k, v === true ? "" : v);
    });
    (function add(list) {
      [].concat(list == null ? [] : list).forEach(function (c) {
        if (Array.isArray(c)) return add(c);
        if (c == null || c === false) return;
        e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return e;
  }
  var ICONS = {
    overview: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 13a8 8 0 0 0 14 4.5L20 15M4 4v5h5M20 20v-5h-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5v.01"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>', restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>', laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 20h20"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>', stamp: '<path d="M5 20h14M7 16h10l-1-4a3 3 0 1 0-8 0l-1 4Z"/><path d="M12 8V5"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 21h4"/>',
  };
  function ico(name) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.innerHTML = ICONS[name] || ""; // constant strings only
    return s;
  }
  function btn(label, opts) {
    opts = opts || {};
    var b = h("button", { class: "btn " + (opts.cls || ""), type: opts.type || "button", title: opts.title, onclick: opts.onclick, disabled: opts.disabled }, [opts.icon ? ico(opts.icon) : null, label ? h("span", {}, label) : null]);
    if (!label) b.classList.add("btn-icon");
    if (opts.aria || opts.title) b.setAttribute("aria-label", opts.aria || opts.title);
    return b;
  }
  function toast(text, kind) {
    var t = h("div", { class: "toast " + (kind || "") }, text);
    document.getElementById("toasts").appendChild(t); setTimeout(function () { t.remove(); }, kind === "bad" ? 6000 : 3200);
  }
  function api(method, url, body, isForm) {
    var o = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "fetch" } };
    if (body && !isForm) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url.indexOf("/admin/login") !== 0) { showLogin(); throw new Error("Please sign in again"); }
        if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
        return j;
      });
    });
  }
  function copy(text, label) {
    var done = function () { toast((label || "Copied") + " to clipboard", "ok"); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback); else fallback();
    function fallback() { var t = h("textarea", { style: { position: "fixed", opacity: "0" } }); document.body.appendChild(t); t.value = text; t.select(); try { document.execCommand("copy"); done(); } catch (e) { window.prompt("Copy this:", text); } t.remove(); }
  }
  var dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  function parseT(s) { return s ? new Date(String(s).replace(" ", "T") + "Z") : null; }
  function dt(s) { var d = parseT(s); return d ? dtf.format(d) : "—"; }
  function ago(s) {
    var d = parseT(s); if (!d) return "—"; var sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (sec < 45) return "just now"; if (sec < 3600) return Math.round(sec / 60) + " min ago"; if (sec < 86400) return Math.round(sec / 3600) + " h ago";
    if (sec < 86400 * 14) return Math.round(sec / 86400) + " d ago"; return dt(s);
  }
  function dur(sec) { sec = sec | 0; if (sec < 60) return sec + "s"; var m = Math.floor(sec / 60); if (m < 60) return m + "m " + (sec % 60) + "s"; return Math.floor(m / 60) + "h " + (m % 60) + "m"; }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function flag(cc) { return cc && /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint.apply(null, cc.toUpperCase().split("").map(function (c) { return 127397 + c.charCodeAt(0); })) : "🌐"; }
  function place(r) { var parts = [r.city, r.region, r.country || r.country_code].filter(Boolean); var seen = {}; parts = parts.filter(function (p) { if (seen[p]) return false; seen[p] = 1; return true; }); return parts.join(", ") || "Unknown"; }
  function who(r) { return r.name || r.email || "Anonymous"; }
  function genPw() { var c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", a = new Uint32Array(14), o = ""; crypto.getRandomValues(a); for (var i = 0; i < 14; i++) o += c[a[i] % c.length]; return o; }
  function toLocalInput(sql) { var d = parseT(sql); return d ? new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  var FLAGS = {
    automation: ["Automated browser", "b-bad", "Looks like a bot, headless or scripted browser."],
    devtools: ["Dev tools", "b-warn", "Browser developer tools appear to have been opened."],
    tz_mismatch: ["VPN / proxy?", "b-warn", "Device timezone does not match the IP address location."],
    clock_skew: ["Clock off", "b-info", "Device clock differs from the server by 10+ minutes."],
    bulk_fetch: ["Bulk fetching", "b-bad", "Requested pages unusually fast (possible scraping)."],
    capture_attempt: ["Screenshot key", "b-warn", "Pressed the PrintScreen key."],
  };
  function flagBadges(str) {
    var list = (str || "").split(",").filter(Boolean);
    if (!list.length) return h("span", { class: "muted" }, "—");
    return h("div", { class: "chips" }, list.map(function (f) { var m = FLAGS[f] || [f, "b-mute"]; return h("span", { class: "badge nodot " + m[1], title: m[2] || "" }, m[0]); }));
  }
  function statusBadge(st) {
    var m = { ok: ["Active", "b-ok"], revoked: ["Revoked", "b-bad"], expired: ["Expired", "b-warn"], limit: ["Limit reached", "b-warn"] }[st] || [st, "b-mute"];
    return h("span", { class: "badge " + m[1] }, m[0]);
  }
  function empty(icon, title, text, action) {
    return h("div", { class: "empty" }, [h("div", { class: "ei" }, ico(icon)), h("h3", {}, title), h("p", {}, text), action ? h("div", { style: { marginTop: "1rem" } }, action) : null]);
  }
  function skeleton() { return h("div", { class: "page" }, [h("div", { class: "skeleton", style: { height: "34px", width: "220px", marginBottom: "1.4rem" } }), h("div", { class: "grid-4" }, [1, 2, 3, 4].map(function () { return h("div", { class: "skeleton", style: { height: "96px" } }); })), h("div", { class: "skeleton", style: { height: "260px" } })]); }

  // ---- overlays
  function modal(o) {
    var close = function () { ov.remove(); document.removeEventListener("keydown", esc); if (o.onclose) o.onclose(); };
    var esc = function (e) { if (e.key === "Escape") close(); };
    var ov = h("div", { class: "overlay", onmousedown: function (e) { if (e.target === ov) close(); } }, h("div", { class: "modal", role: "dialog", "aria-modal": "true", style: o.wide ? { maxWidth: "760px" } : {} }, [
      h("div", { class: "modal-head" }, [h("h3", {}, o.title), btn("", { icon: "x", cls: "btn-ghost btn-sm", title: "Close", onclick: close })]),
      h("div", { class: "modal-body" }, o.body), o.foot ? h("div", { class: "modal-foot" }, typeof o.foot === "function" ? o.foot(close) : o.foot) : null,
    ]));
    document.body.appendChild(ov); document.addEventListener("keydown", esc);
    var f = ov.querySelector("input,select,textarea"); if (f && o.focus !== false) setTimeout(function () { f.focus(); }, 30);
    return { close: close, el: ov };
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (res) {
      var m = modal({ title: title, body: h("p", { class: "muted" }, text), onclose: function () { res(false); }, foot: function (close) { return [btn("Cancel", { onclick: close }), btn(okLabel, { cls: danger ? "btn-danger" : "btn-primary", onclick: function () { res(true); res = function () {}; close(); } })]; } });
      return m;
    });
  }

  // =============================================================== login
  function showLogin() {
    clearInterval(poll);
    var err = h("div", { class: "alert alert-bad hidden", role: "alert" });
    var pw = h("input", { type: "password", id: "pw", required: true, autocomplete: "current-password", autofocus: true });
    var code = h("input", { type: "text", id: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "6-digit code", pattern: "[0-9]*" });
    var submit = h("button", { class: "btn btn-primary btn-lg btn-block", type: "submit" }, "Sign in");
    var form = h("form", { class: "gate-card", onsubmit: function (e) {
      e.preventDefault(); submit.disabled = true; submit.textContent = "Signing in…"; err.classList.add("hidden");
      api("POST", "/admin/login", { password: pw.value, code: code.value }).then(function () { boot(); }).catch(function (x) {
        err.textContent = x.message; err.classList.remove("hidden"); submit.disabled = false; submit.textContent = "Sign in"; pw.select();
      });
    } }, [
      h("div", { class: "gate-icon" }, ico("shield")), h("h1", {}, "Admin sign in"), h("p", { class: "muted" }, "Manage documents, share links and see who is viewing."), err,
      h("div", { class: "field" }, [h("label", { for: "pw" }, "Password"), pw]),
      S.totp ? h("div", { class: "field" }, [h("label", { for: "code" }, "Authentication code"), code, h("div", { class: "hint" }, "From your authenticator app")]) : null,
      submit, h("p", { class: "fine" }, "Protected area. Sign-in attempts are logged."),
    ]);
    root.replaceChildren(h("div", { class: "gate" }, [
      h("aside", { class: "gate-brand" }, [
        h("div", { class: "brand" }, [h("span", { class: "brand-mark" }, ico("shield")), h("span", {}, S.app)]),
        h("div", { class: "gate-hero" }, [h("h2", {}, ["Share documents.", h("br"), "Keep control."]), h("p", {}, "Password-protected, watermarked, view-only links — with a full record of who opened what, from where, on which device.")]),
        h("div", { class: "gate-foot" }, "Administrator console"),
      ]),
      h("main", { class: "gate-panel" }, form),
    ]));
    pw.focus();
  }

  // =============================================================== shell
  var NAV = [["overview", "Overview", "overview"], ["links", "Share links", "link"], ["viewers", "Viewers", "users"], ["docs", "Documents", "doc"], ["activity", "Activity log", "activity"], ["security", "Security", "shield"]];
  function themeToggle() {
    var b = btn("Theme", { cls: "btn-ghost btn-sm", icon: "sun", onclick: function () {
      var cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("spdf-theme", next); } catch (e) {}
    } });
    return b;
  }
  function renderShell() {
    var side = h("aside", { class: "side", id: "side" }, [
      h("div", { class: "brand" }, [h("span", { class: "brand-mark" }, ico("shield")), h("span", {}, S.app)]),
      h("nav", { class: "nav" }, NAV.map(function (n) {
        var a = h("a", { href: "#/" + n[0], "data-r": n[0], class: S.route === n[0] ? "active" : "", onclick: function () { closeSide(); } }, [ico(n[2]), h("span", {}, n[1])]);
        if (n[0] === "viewers") a.appendChild(h("span", { class: "count live hidden", id: "live-count" }, ""));
        return a;
      })),
      h("div", { class: "side-foot" }, [themeToggle(), btn("Sign out", { cls: "btn-ghost btn-sm", icon: "logout", onclick: function () { api("POST", "/admin/logout", {}).then(showLogin); } })]),
    ]);
    function closeSide() { side.classList.remove("open"); var s = document.getElementById("scrim"); if (s) s.remove(); }
    var top = h("div", { class: "topbar" }, [btn("", { icon: "menu", cls: "btn-ghost", title: "Menu", onclick: function () { side.classList.add("open"); var sc = h("div", { class: "scrim", id: "scrim", onclick: closeSide }); document.body.appendChild(sc); } }), h("div", { class: "brand" }, S.app)]);
    root.replaceChildren(h("div", { class: "shell" }, [side, h("div", { class: "main" }, [top, h("div", { id: "view" })])]));
  }
  function setActive() { document.querySelectorAll(".nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-r") === S.route); }); }
  function mount(node) { var v = document.getElementById("view"); v.replaceChildren(node); window.scrollTo(0, 0); }
  function setLive(n) { var el = document.getElementById("live-count"); if (!el) return; el.textContent = n ? n + " live" : ""; el.classList.toggle("hidden", !n); }

  // =============================================================== routing
  var ROUTES = { overview: pageOverview, links: pageLinks, viewers: pageViewers, docs: pageDocs, activity: pageActivity, security: pageSecurity };
  function parseHash() {
    var hsh = location.hash.replace(/^#\/?/, ""), qi = hsh.indexOf("?"), name = qi < 0 ? hsh : hsh.slice(0, qi), q = {};
    if (qi >= 0) hsh.slice(qi + 1).split("&").forEach(function (p) { var kv = p.split("="); q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ""); });
    return { name: ROUTES[name] ? name : "overview", q: q };
  }
  function go() {
    var r = parseHash(); S.route = r.name; setActive(); clearInterval(poll);
    var view = document.getElementById("view"); if (!view) return; view.replaceChildren(skeleton());
    Promise.resolve(ROUTES[r.name](r.q)).catch(function (e) { if (e && e.message !== "Please sign in again") mount(h("div", { class: "page" }, empty("alert", "Something went wrong", e.message || "Please try again.", btn("Retry", { cls: "btn-primary", onclick: go })))); });
  }
  window.addEventListener("hashchange", function () { if (document.getElementById("view")) go(); });
  function autoRefresh(fn, ms) { clearInterval(poll); poll = setInterval(function () { if (!document.hidden && !document.querySelector(".overlay,.drawer-wrap")) fn(); }, ms || 15000); }
  function pageHead(title, sub, actions) { return h("div", { class: "page-head" }, [h("div", {}, [h("h1", {}, title), sub ? h("p", {}, sub) : null]), h("div", { class: "actions" }, actions || [])]); }

  // =============================================================== Overview
  function pageOverview() {
    return api("GET", "/api/overview").then(function (d) {
      setLive(d.live); S.counts.live = d.live;
      var delta = d.opens7 - d.opensPrev7, dTxt = d.opensPrev7 === 0 ? (d.opens7 ? "new activity" : "no change") : (delta >= 0 ? "▲ " : "▼ ") + Math.abs(Math.round((delta / d.opensPrev7) * 100)) + "% vs previous 7 days";
      var stat = function (icon, tone, val, lab, extra) { return h("div", { class: "card stat" }, [h("div", { class: "ico " + (tone || "") }, ico(icon)), h("div", {}, [h("div", { class: "val" }, val), h("div", { class: "lab" }, lab), extra])]); };
      var max = Math.max.apply(null, d.days.map(function (x) { return Math.max(x.opens + x.failed, 1); }));
      var bars = h("div", { class: "bars" }, d.days.map(function (x) {
        var c = h("div", { class: "barcol", "data-tip": x.d + " · " + x.opens + " opened, " + x.failed + " failed" });
        var o = h("i"), f = h("i", { class: "f" }); o.style.height = (x.opens / max) * 100 + "%"; f.style.height = (x.failed / max) * 100 + "%"; c.appendChild(f); c.appendChild(o); return c;
      }));
      var chart = h("div", { class: "card" }, [
        h("div", { class: "card-head" }, [h("div", {}, [h("h3", {}, "Document opens"), h("small", {}, "Last 14 days")]), h("div", { class: "legend" }, [h("span", {}, [h("i"), "Opened"]), h("span", {}, [h("i", { class: "f" }), "Failed password"])])]),
        h("div", { class: "chart" }, [bars, h("div", { class: "xaxis" }, d.days.map(function (x) { return h("span", {}, x.d.slice(8)); }))]),
      ]);
      var alerts = h("div", { class: "card" }, [h("div", { class: "card-head" }, [h("h3", {}, "Needs attention"), h("small", {}, "Flagged sessions, 30 days")]),
        d.flagged.length ? h("div", { class: "list" }, d.flagged.map(function (s) { return sessionItem(s, true); })) : h("div", { class: "empty" }, [h("div", { class: "ei" }, ico("check")), h("p", {}, "No suspicious activity. Everything looks normal.")])]);
      var recent = h("div", { class: "card" }, [h("div", { class: "card-head" }, [h("h3", {}, "Recent viewers"), btn("View all", { cls: "btn-sm btn-ghost", onclick: function () { location.hash = "#/viewers"; } })]),
        d.recent.length ? h("div", { class: "list" }, d.recent.map(function (s) { return sessionItem(s); })) : empty("users", "No viewers yet", "When someone unlocks a link, they appear here with full details.")]);
      var tot = d.countries.reduce(function (a, c) { return a + c.n; }, 0) || 1;
      var countries = h("div", { class: "card" }, [h("div", { class: "card-head" }, h("h3", {}, "Top locations")),
        d.countries.length ? h("div", { class: "list" }, d.countries.map(function (c) { var m = h("div", { class: "meter" }, h("i")); m.firstChild.style.width = (c.n / tot) * 100 + "%"; return h("div", { class: "list-item" }, [h("div", { class: "grow" }, [h("div", { class: "cell-main" }, c.c), m]), h("b", {}, String(c.n))]); })) : h("div", { class: "empty" }, "No data yet.")]);
      mount(h("div", { class: "page" }, [
        pageHead("Overview", "A live picture of your shared documents.", [btn("Refresh", { icon: "refresh", onclick: go }), btn("New link", { icon: "plus", cls: "btn-primary", onclick: function () { location.hash = "#/links"; setTimeout(function () { if (S.docs.length) linkModal(); }, 400); } })]),
        h("div", { class: "grid-4" }, [
          stat("link", "", String(d.activeLinks), "Active links", h("div", { class: "delta flat" }, "of " + d.totalLinks + " total")),
          stat("eye", "", String(d.opens7), "Opens, last 7 days", h("div", { class: "delta " + (delta > 0 ? "up" : delta < 0 ? "down" : "flat") }, dTxt)),
          stat("users", "ok", String(d.live), "Viewing right now", d.live ? h("div", { class: "delta up" }, [h("span", { class: "live-dot" }), " live"]) : h("div", { class: "delta flat" }, "no one online")),
          stat("alert", d.failed24 ? "warn" : "", String(d.failed24), "Failed attempts, 24 h", h("div", { class: "delta flat" }, "wrong passwords & logins")),
        ]),
        h("div", { class: "grid-2" }, [chart, alerts]), h("div", { class: "grid-2" }, [recent, countries]),
      ]));
      autoRefresh(function () { api("GET", "/api/overview").then(function (x) { setLive(x.live); }).catch(function () {}); }, 20000);
    });
  }
  function sessionItem(s, showFlags) {
    return h("div", { class: "list-item click", onclick: function () { openSession(s.id); } }, [
      h("div", { class: "avatar" }, (who(s)[0] || "?")),
      h("div", { class: "grow" }, [h("div", { class: "cell-main trunc" }, who(s)), h("div", { class: "cell-sub trunc" }, [flag(s.country_code), " ", place(s), " · ", s.ip, " · ", s.browser || "browser?"])]),
      showFlags ? flagBadges(s.flags) : h("div", { style: { textAlign: "right" } }, [!s.ended && ((Date.now() - parseT(s.last_seen)) < 60000) ? h("span", { class: "badge b-ok" }, "Live") : null, h("div", { class: "cell-sub nowrap" }, ago(s.started_at))]),
    ]);
  }

  // =============================================================== Links
  function pageLinks() {
    return Promise.all([api("GET", "/api/docs"), api("GET", "/api/links")]).then(function (r) {
      S.docs = r[0]; S.links = r[1]; drawLinks(); autoRefresh(function () { api("GET", "/api/links").then(function (l) { S.links = l; drawLinks(true); }); }, 20000);
    });
  }
  function lockChips(l) {
    var c = [];
    if (l.require_identity) c.push(h("span", { class: "chip", title: "Viewer must enter name & email" }, [ico("users"), "ID"]));
    if (l.require_ack) c.push(h("span", { class: "chip", title: "Viewer must accept confidentiality terms" }, [ico("stamp"), "NDA"]));
    if (l.max_devices) c.push(h("span", { class: "chip", title: "Limited to " + l.max_devices + " device(s)" }, [ico("laptop"), l.max_devices]));
    if (l.allow_ips) c.push(h("span", { class: "chip", title: "IP allow-list: " + l.allow_ips }, [ico("globe"), "IP"]));
    if (l.locked_until && parseT(l.locked_until) > new Date()) c.push(h("span", { class: "badge nodot b-bad" }, "Locked"));
    return c.length ? h("div", { class: "chips" }, c) : h("span", { class: "muted" }, "—");
  }
  function drawLinks(quiet) {
    if (quiet && (document.querySelector(".overlay") || S.route !== "links")) return;
    var rows = S.links.map(function (l) {
      return h("tr", {}, [
        h("td", { class: "col-link" }, [h("div", { class: "cell-main" }, l.label || "Untitled link"), h("div", { class: "cell-sub" }, l.doc_title + " · " + plural(l.pages, "page"))]),
        h("td", {}, [statusBadge(l.status), l.live ? h("div", { class: "cell-live" }, [h("span", { class: "live-dot" }), l.live + " viewing"]) : null]),
        h("td", { class: "nowrap" }, l.view_count + (l.max_views ? " / " + l.max_views : "")),
        h("td", {}, String(l.devices || 0)), h("td", {}, l.failed_attempts ? h("span", { class: "badge nodot b-warn" }, String(l.failed_attempts)) : "0"),
        h("td", {}, lockChips(l)), h("td", { class: "nowrap" }, l.last_opened ? ago(l.last_opened) : "Never"), h("td", { class: "nowrap" }, l.expires_at ? dt(l.expires_at) : "Never"),
        h("td", {}, h("div", { class: "actions", style: { flexWrap: "nowrap" } }, [
          btn("", { icon: "copy", cls: "btn-sm", title: "Copy link", onclick: function () { copy(l.url, "Link copied"); } }),
          btn("", { icon: "users", cls: "btn-sm", title: "Who opened it", onclick: function () { location.hash = "#/viewers?link=" + l.id; } }),
          btn("", { icon: "edit", cls: "btn-sm", title: "Edit settings", onclick: function () { linkModal(l); } }),
          l.status === "revoked"
            ? btn("", { icon: "restore", cls: "btn-sm", title: "Restore link", onclick: function () { api("POST", "/api/links/" + l.id + "/restore", {}).then(function () { toast("Link restored", "ok"); pageLinks(); }); } })
            : btn("", { icon: "ban", cls: "btn-sm btn-soft-danger", title: "Revoke link now", onclick: function () { confirmBox("Revoke this link?", "Nobody will be able to open it, and anyone viewing right now is disconnected immediately. You can restore it later.", "Revoke link", true).then(function (ok) { if (ok) api("POST", "/api/links/" + l.id + "/revoke", {}).then(function () { toast("Link revoked", "ok"); pageLinks(); }); }); } }),
          btn("", { icon: "trash", cls: "btn-sm", title: "Delete link", onclick: function () { confirmBox("Delete this link?", "The link and its viewer history will be permanently removed.", "Delete", true).then(function (ok) { if (ok) api("DELETE", "/api/links/" + l.id).then(function () { toast("Link deleted", "ok"); pageLinks(); }); }); } }),
        ])),
      ]);
    });
    var table = S.links.length ? h("div", { class: "tablewrap" }, h("table", {}, [h("thead", {}, h("tr", {}, ["Link", "Status", "Unlocks", "Devices", "Failed", "Protection", "Last opened", "Expires", ""].map(function (x) { return h("th", {}, x); }))), h("tbody", {}, rows)]))
      : empty("link", S.docs.length ? "No share links yet" : "Upload a document first", S.docs.length ? "Create a password-protected link to share a document." : "Add a PDF in the Documents section, then create a link for it.", S.docs.length ? btn("Create your first link", { icon: "plus", cls: "btn-primary", onclick: function () { linkModal(); } }) : btn("Go to Documents", { cls: "btn-primary", onclick: function () { location.hash = "#/docs"; } }));
    mount(h("div", { class: "page" }, [pageHead("Share links", "Each link has its own password, limits and viewer log.", [btn("New link", { icon: "plus", cls: "btn-primary", onclick: function () { if (!S.docs.length) { toast("Upload a document first", "bad"); location.hash = "#/docs"; } else linkModal(); } })]), h("div", { class: "card" }, table)]));
  }

  function linkModal(link) {
    var edit = !!link;
    var docSel = h("select", { required: true }, [h("option", { value: "" }, "Select a document…")].concat(S.docs.map(function (d) { return h("option", { value: d.id }, d.title + " (" + plural(d.pages, "page") + ")"); })));
    var label = h("input", { type: "text", maxlength: "120", placeholder: "e.g. Sent to Priya — Acme Corp", value: link ? link.label : "" });
    var pw = h("input", { type: "text", class: "mono", value: edit ? "" : genPw(), placeholder: edit ? "Leave blank to keep current password" : "", minlength: "6", maxlength: "128", required: !edit });
    var exp = h("input", { type: "datetime-local", value: link ? toLocalInput(link.expires_at) : "" });
    var mv = h("input", { type: "number", min: "1", placeholder: "Unlimited", value: link && link.max_views ? link.max_views : "" });
    var md = h("input", { type: "number", min: "1", max: "100", placeholder: "Unlimited", value: link && link.max_devices ? link.max_devices : "" });
    var sm = h("select", {}, [[15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [480, "8 hours"], [1440, "24 hours"]].map(function (o) { return h("option", { value: o[0], selected: (link ? link.session_minutes : 60) === o[0] }, o[1]); }));
    var ips = h("textarea", { placeholder: "Leave empty to allow any network. Example: 203.0.113.7, 198.51.100.22", rows: "2" }); ips.value = link && link.allow_ips ? link.allow_ips.replace(/,/g, ", ") : "";
    var idn = h("input", { type: "checkbox", checked: link && link.require_identity }), ack = h("input", { type: "checkbox", checked: link && link.require_ack });
    var ackText = h("textarea", { rows: "2", maxlength: "400", placeholder: "I will keep this document confidential and will not share or copy it." }); ackText.value = link && link.ack_text ? link.ack_text : "";
    var ackWrap = h("div", { class: "field" + (ack.checked ? "" : " hidden"), style: { marginTop: ".6rem" } }, [h("label", {}, "Confidentiality statement shown to viewer"), ackText]);
    ack.addEventListener("change", function () { ackWrap.classList.toggle("hidden", !ack.checked); });
    var notes = h("textarea", { rows: "2", maxlength: "500", placeholder: "Private note (only visible to you)" }); notes.value = link && link.notes ? link.notes : "";
    var err = h("div", { class: "alert alert-bad hidden" });
    var quick = h("div", { class: "chips", style: { marginTop: ".5rem" } }, [["24 h", 1], ["7 days", 7], ["30 days", 30], ["Never", 0]].map(function (q) { return h("button", { type: "button", class: "chip", style: { cursor: "pointer", border: "0" }, onclick: function () { exp.value = q[1] ? new Date(Date.now() + q[1] * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ""; } }, q[0]); }));
    var body = h("form", { id: "lf", onsubmit: function (e) { e.preventDefault(); save(); } }, [
      h("div", { class: "sect" }, "Basics"),
      edit ? h("div", { class: "field" }, [h("label", {}, "Document"), h("div", { class: "cell-main" }, link.doc_title)]) : h("div", { class: "field" }, [h("label", {}, "Document"), docSel]),
      h("div", { class: "field" }, [h("label", {}, "Label — who is this link for?"), label]),
      h("div", { class: "field" }, [h("label", {}, edit ? "Change password" : "Access password"), edit ? pw : h("div", { class: "copybox" }, [pw, btn("Generate", { icon: "refresh", onclick: function () { pw.value = genPw(); } })]), h("div", { class: "hint" }, edit ? "Setting a new password signs out everyone currently viewing." : "Share the password through a different channel than the link.")]),
      h("div", { class: "sect" }, "Access limits"),
      h("div", { class: "row2" }, [h("div", { class: "field" }, [h("label", {}, "Expires"), exp, quick]), h("div", { class: "field" }, [h("label", {}, "Viewing session length"), sm, h("div", { class: "hint" }, "Viewer must unlock again after this.")])]),
      h("div", { class: "row2" }, [h("div", { class: "field" }, [h("label", {}, "Max unlocks"), mv, h("div", { class: "hint" }, "Total times the link can be opened.")]), h("div", { class: "field" }, [h("label", {}, "Max devices"), md, h("div", { class: "hint" }, "Locks the link to this many devices.")])]),
      h("div", { class: "field" }, [h("label", {}, "Allowed IP addresses (optional)"), ips]),
      h("div", { class: "sect" }, "Viewer verification"),
      h("label", { class: "switch" }, [idn, h("div", {}, [h("b", {}, "Ask for name and email"), h("small", {}, "Viewers must identify themselves. Shown on every page watermark and in your log.")])]),
      h("label", { class: "switch" }, [ack, h("div", {}, [h("b", {}, "Require confidentiality acceptance"), h("small", {}, "Viewer must tick a statement before opening. Acceptance is recorded.")])]), ackWrap,
      h("div", { class: "sect" }, "Notes"), notes, err,
    ]);
    var saveBtn;
    function save() {
      err.classList.add("hidden");
      var p = { label: label.value, expires_at: null, max_views: mv.value, max_devices: md.value, session_minutes: +sm.value, allow_ips: ips.value, require_identity: idn.checked, require_ack: ack.checked, ack_text: ackText.value, notes: notes.value };
      if (exp.value) p.expires_at = new Date(exp.value).toISOString();
      if (edit) { if (exp.value && toLocalInput(link.expires_at) === exp.value) delete p.expires_at; if (pw.value) p.password = pw.value; }
      else { if (!docSel.value) return showErr("Please choose a document."); p.doc_id = +docSel.value; p.password = pw.value; }
      saveBtn.disabled = true;
      api(edit ? "PATCH" : "POST", edit ? "/api/links/" + link.id : "/api/links", p).then(function (r) {
        m.close(); if (edit) { toast("Link updated", "ok"); pageLinks(); } else { createdModal(r.url, p.password, label.value); pageLinks(); }
      }).catch(function (x) { showErr(x.message); saveBtn.disabled = false; });
    }
    function showErr(t) { err.textContent = t; err.classList.remove("hidden"); err.scrollIntoView({ block: "nearest" }); }
    var m = modal({ title: edit ? "Edit link" : "Create share link", body: body, foot: function (close) { saveBtn = btn(edit ? "Save changes" : "Create link", { cls: "btn-primary", onclick: function () { if (body.reportValidity()) save(); } }); return [btn("Cancel", { onclick: close }), saveBtn]; } });
  }
  function createdModal(url, password, label) {
    modal({ title: "Link created", body: h("div", {}, [
      h("div", { class: "alert alert-ok" }, "Your protected link is ready. Send the link and password separately."),
      h("div", { class: "field" }, [h("label", {}, "Link"), h("div", { class: "copybox" }, [h("input", { type: "text", readonly: true, value: url, onfocus: function (e) { e.target.select(); } }), btn("Copy", { icon: "copy", cls: "btn-primary", onclick: function () { copy(url, "Link copied"); } })])]),
      h("div", { class: "field" }, [h("label", {}, "Password — shown only now"), h("div", { class: "copybox" }, [h("div", { class: "secret grow" }, password), btn("Copy", { icon: "copy", onclick: function () { copy(password, "Password copied"); } })])]),
      h("div", { class: "hint" }, "Passwords are stored encrypted and cannot be shown again. You can set a new one anytime from the link settings."),
    ]), foot: function (close) { return [btn("Copy invitation text", { onclick: function () { copy("I've shared a protected document with you" + (label ? " (" + label + ")" : "") + ".\nOpen: " + url + "\nI'll send the password separately.", "Message copied"); } }), btn("Done", { cls: "btn-primary", onclick: close })]; }, focus: false });
  }

  // =============================================================== Viewers (sessions)
  function pageViewers(q) {
    var f = { q: "", link: q.link || "", mode: q.flagged ? "flagged" : "all" };
    return Promise.all([api("GET", "/api/links")]).then(function (r) {
      S.links = r[0]; var host = h("div", { class: "card" }); var tools = h("div", { class: "toolbar" });
      var search = h("input", { type: "search", placeholder: "Search name, email, IP, city…", oninput: debounce(function () { f.q = search.value; load(); }, 300) });
      var linkSel = h("select", { onchange: function () { f.link = linkSel.value; load(); } }, [h("option", { value: "" }, "All links")].concat(S.links.map(function (l) { return h("option", { value: l.id, selected: String(l.id) === String(f.link) }, (l.label || "Untitled") + " — " + l.doc_title); })));
      var seg = h("div", { class: "seg" }, [["all", "All"], ["live", "Live now"], ["flagged", "Flagged"]].map(function (m) { return h("button", { type: "button", class: f.mode === m[0] ? "on" : "", onclick: function (e) { f.mode = m[0]; seg.querySelectorAll("button").forEach(function (b) { b.classList.remove("on"); }); e.target.classList.add("on"); load(); } }, m[1]); }));
      tools.append(search, linkSel, seg, h("div", { style: { marginLeft: "auto" } }, btn("Export CSV", { icon: "download", cls: "btn-sm", onclick: function () { exportSessions(S.sessions || []); } })));
      host.appendChild(tools); var tbl = h("div", { class: "tablewrap" }); host.appendChild(tbl);
      mount(h("div", { class: "page" }, [pageHead("Viewers", "Everyone who has unlocked one of your links — with network, device and reading activity.", [btn("Refresh", { icon: "refresh", onclick: function () { load(); } })]), host]));
      function load() {
        var u = "/api/sessions?limit=500" + (f.q ? "&q=" + encodeURIComponent(f.q) : "") + (f.link ? "&link_id=" + f.link : "") + (f.mode === "live" ? "&live=1" : f.mode === "flagged" ? "&flagged=1" : "");
        return api("GET", u).then(function (rows) {
          S.sessions = rows; setLive(rows.filter(function (x) { return x.live; }).length || S.counts.live);
          tbl.replaceChildren(rows.length ? h("table", {}, [h("thead", {}, h("tr", {}, ["Viewer", "Location", "Network", "Device", "Link", "Started", "Time spent", "Read", "Flags", "Status"].map(function (x) { return h("th", {}, x); }))), h("tbody", {}, rows.map(sessionRow))]) : empty("users", "No viewers found", f.mode === "all" && !f.q && !f.link ? "When someone unlocks a link they will appear here." : "Nothing matches these filters."));
        });
      }
      load(); autoRefresh(load, 15000);
    });
  }
  function sessionRow(s) {
    return h("tr", { class: "click", onclick: function () { openSession(s.id); } }, [
      h("td", {}, h("div", { style: { display: "flex", gap: ".7rem", alignItems: "center" } }, [h("div", { class: "avatar" }, who(s)[0] || "?"), h("div", {}, [h("div", { class: "cell-main" }, who(s)), s.name && s.email ? h("div", { class: "cell-sub" }, s.email) : null])])),
      h("td", { class: "nowrap" }, [h("div", { class: "cell-main" }, [flag(s.country_code), " ", s.city || s.country || s.country_code || "Unknown"]), h("div", { class: "cell-sub" }, [s.region, s.country].filter(Boolean).join(", "))]),
      h("td", { class: "nowrap" }, [h("div", { class: "mono" }, s.ip), h("div", { class: "cell-sub" }, s.isp || "")]),
      h("td", { class: "nowrap" }, [h("div", { class: "cell-main" }, s.browser || "Unknown"), h("div", { class: "cell-sub" }, [s.os, s.device && s.device !== "Desktop / unknown" ? s.device : ""].filter(Boolean).join(" · "))]),
      h("td", {}, [h("div", { class: "cell-main" }, s.label || "Untitled"), h("div", { class: "cell-sub trunc", style: { maxWidth: "180px" } }, s.doc_title)]),
      h("td", { class: "nowrap" }, [h("div", {}, ago(s.started_at)), h("div", { class: "cell-sub" }, dt(s.started_at))]),
      h("td", { class: "nowrap" }, dur(s.active_seconds)), h("td", { class: "nowrap" }, s.max_page ? s.max_page + " / " + s.pages : "—"),
      h("td", {}, flagBadges(s.flags)),
      h("td", {}, s.live ? h("span", { class: "badge b-ok" }, "Live") : s.ended ? h("span", { class: "badge nodot b-mute", title: s.ended_reason || "" }, s.ended_reason === "admin" ? "Ended by you" : "Ended") : h("span", { class: "badge nodot b-mute" }, "Idle")),
    ]);
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function csvEsc(v) { v = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
  function download(name, text) { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  function exportSessions(rows) {
    var cols = ["started_at", "label", "doc_title", "name", "email", "ip", "country", "region", "city", "isp", "browser", "os", "device", "device_id", "active_seconds", "max_page", "flags", "ended_reason"];
    download("viewers.csv", [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return csvEsc(r[c]); }).join(","); })).join("\n"));
  }

  // ---- session detail drawer
  function openSession(id) {
    var body = h("div", { class: "drawer-body" }, h("div", { class: "skeleton", style: { height: "200px" } }));
    var headSlot = h("div", { class: "grow" });
    var wrap = h("div", { class: "drawer-wrap", onmousedown: function (e) { if (e.target === wrap) close(); } }, h("div", { class: "drawer", role: "dialog", "aria-modal": "true" }, [h("div", { class: "drawer-head" }, [headSlot, btn("", { icon: "x", cls: "btn-ghost", title: "Close", onclick: function () { close(); } })]), body]));
    function close() { wrap.remove(); document.removeEventListener("keydown", esc); } function esc(e) { if (e.key === "Escape") close(); }
    document.body.appendChild(wrap); document.addEventListener("keydown", esc);
    api("GET", "/api/sessions/" + encodeURIComponent(id)).then(function (s) { drawSession(s, headSlot, body, close); }).catch(function (e) { body.replaceChildren(empty("alert", "Could not load", e.message)); });
  }
  function kv(rows) { return rows.filter(function (r) { return r[1] !== undefined && r[1] !== null && r[1] !== "" && r[1] !== false; }).map(function (r) { return h("dl", { class: "kv" }, [h("dt", {}, r[0]), h("dd", { class: r[2] || "" }, r[1])]); }); }
  var EVT = { unlock_ok: ["Unlocked the document", ""], device_info: ["Device details collected", ""], unlock_failed: ["Wrong password", "bad"], blocked_action: ["Blocked action", "warn"], copy_attempt: ["Tried to copy", "warn"], print_attempt: ["Tried to print", "warn"], screenshot_key: ["Pressed PrintScreen", "warn"], devtools: ["Developer tools detected", "warn"], tab_hidden: ["Switched away from the tab", ""], tab_visible: ["Returned to the tab", ""], closed: ["Closed the document", ""], fullscreen: ["Entered full screen", ""], admin_session_ended: ["Ended by you", "bad"], blocked_device_limit: ["Blocked: device limit", "bad"] };
  function drawSession(s, headSlot, body, close) {
    var fp = s.fp || {};
    headSlot.replaceChildren(h("div", { style: { display: "flex", gap: ".8rem", alignItems: "center" } }, [h("div", { class: "avatar", style: { width: "44px", height: "44px", fontSize: "1rem" } }, who(s)[0] || "?"), h("div", { class: "grow" }, [h("h3", {}, who(s)), h("div", { class: "cell-sub" }, [s.live ? h("span", { class: "badge b-ok" }, "Live now") : s.ended ? h("span", { class: "badge nodot b-mute" }, "Ended" + (s.ended_reason ? " · " + s.ended_reason.replace("_", " ") : "")) : h("span", { class: "badge nodot b-mute" }, "Idle"), " ", s.label || "", " · ", s.doc_title])])]));
    var acts = h("div", { class: "actions" }, [
      (!s.ended) ? btn("End session now", { icon: "ban", cls: "btn-danger btn-sm", onclick: function () { confirmBox("End this session?", "They are disconnected immediately and must unlock again.", "End session", true).then(function (ok) { if (ok) api("POST", "/api/sessions/" + s.id + "/end", {}).then(function () { toast("Session ended", "ok"); close(); go(); }); }); } }) : null,
      s.blocked ? h("span", { class: "badge b-bad" }, "IP is blocked") : btn("Block this IP", { icon: "ban", cls: "btn-sm", onclick: function () { confirmBox("Block " + s.ip + "?", "Anyone from this IP address will be refused on every link, and their open sessions end now.", "Block IP", true).then(function (ok) { if (ok) api("POST", "/api/blocked-ips", { ip: s.ip, reason: "Blocked from viewer " + who(s) }).then(function () { toast("IP blocked", "ok"); close(); go(); }); }); } }),
      btn("Copy IP", { icon: "copy", cls: "btn-sm", onclick: function () { copy(s.ip, "IP copied"); } }),
    ]);
    var flags = (s.flags || "").split(",").filter(Boolean);
    var flagsPanel = flags.length ? h("div", { class: "alert alert-warn", style: { margin: 0 } }, h("div", {}, [h("b", {}, "Heads-up"), flags.map(function (f) { var m = FLAGS[f] || [f, "", ""]; return h("div", {}, "• " + m[0] + " — " + (m[2] || "")); })])) : null;
    var map = s.lat != null && s.lon != null ? h("a", { href: "https://www.openstreetmap.org/?mlat=" + s.lat + "&mlon=" + s.lon + "#map=10/" + s.lat + "/" + s.lon, target: "_blank", rel: "noopener noreferrer" }, "Open map ↗") : null;
    var net = h("div", { class: "panel" }, [h("h4", {}, "Network & location"), kv([
      ["IP address", s.ip, "mono"], ["Location", place(s) !== "Unknown" ? flag(s.country_code) + " " + place(s) : "Not available (private IP or lookup off)"], ["Coordinates", s.lat != null ? s.lat.toFixed(3) + ", " + s.lon.toFixed(3) : null, "mono"], ["Map", map],
      ["Network (ISP)", s.isp], ["ASN", s.asn, "mono"], ["IP timezone", s.geo_tz], ["Proxy chain", s.forwarded_chain, "mono"], ["Seen from this IP", s.sameIp > 1 ? plural(s.sameIp, "session") + " in total" : "First time"],
    ])]);
    var devKv = [
      ["Browser", s.browser], ["Operating system", [s.os, fp.uaPlatformVersion ? "(" + fp.uaPlatformVersion + ")" : ""].filter(Boolean).join(" ")], ["Device", s.device === "Desktop / unknown" ? (fp.uaModel || s.device) : [s.device, fp.uaModel].filter(Boolean).join(" · ")],
      ["Architecture", [fp.uaArch, fp.uaBitness ? fp.uaBitness + "-bit" : ""].filter(Boolean).join(" ")], ["Platform", fp.platform], ["Screen", fp.screenW ? fp.screenW + " × " + fp.screenH + (fp.dpr ? " @" + fp.dpr + "x" : "") + (fp.colorDepth ? ", " + fp.colorDepth + "-bit" : "") : null],
      ["Browser window", fp.viewW ? fp.viewW + " × " + fp.viewH : null], ["CPU cores", fp.cores], ["Memory", fp.memory ? "≥ " + fp.memory + " GB" : null], ["Touch points", fp.touch != null ? String(fp.touch) : null],
      ["Graphics (GPU)", fp.webglRenderer], ["Language", (fp.languages || []).join(", ") || s.language], ["Device timezone", fp.timezone ? fp.timezone + (fp.tzOffsetMin != null ? " (UTC" + (fp.tzOffsetMin >= 0 ? "+" : "−") + Math.floor(Math.abs(fp.tzOffsetMin) / 60) + (Math.abs(fp.tzOffsetMin) % 60 ? ":" + String(Math.abs(fp.tzOffsetMin) % 60).padStart(2, "0") : "") + ")" : "") : null],
      ["Connection", fp.connType ? fp.connType + (fp.downlink ? " · " + fp.downlink + " Mbps" : "") + (fp.rtt ? " · " + fp.rtt + " ms" : "") : null], ["Theme", fp.colorScheme], ["Automation flag", fp.webdriver ? "Yes — automated browser" : fp.webdriver === false ? "No" : null],
      ["Do Not Track", fp.dnt], ["Came from", fp.referrer || s.referer], ["Device ID", s.device_id, "mono"], ["Same device seen", s.sameDevice && s.sameDevice.c > 1 ? plural(s.sameDevice.c, "session") + " across " + plural(s.sameDevice.l, "link") + " from " + plural(s.sameDevice.i, "IP") : s.device_id ? "First time" : null],
    ];
    var dev = h("div", { class: "panel" }, [h("h4", {}, "Device & browser"), kv(devKv), h("details", { style: { padding: ".6rem 1.1rem", borderTop: "1px solid var(--line)" } }, [h("summary", { class: "muted", style: { cursor: "pointer" } }, "Raw user-agent"), h("div", { class: "mono", style: { wordBreak: "break-all", marginTop: ".4rem", fontSize: ".78rem" } }, s.user_agent || "")])]);
    var idPanel = (s.name || s.email || s.ack) ? h("div", { class: "panel" }, [h("h4", {}, "Identity (self-declared)"), kv([["Name", s.name], ["Email", s.email], ["Accepted confidentiality terms", s.ack ? "Yes" : null]])]) : null;
    var pages = s.pages || 0, dw = s.dwell || {}, keys = Object.keys(dw).map(Number).sort(function (a, b) { return a - b; }), mx = Math.max.apply(null, keys.map(function (k) { return dw[k]; }).concat([1]));
    var act = h("div", { class: "panel" }, [h("h4", {}, "Reading activity"), kv([["Started", dt(s.started_at)], ["Last active", ago(s.last_seen) + " (" + dt(s.last_seen) + ")"], ["Active reading time", dur(s.active_seconds)], ["Furthest page", s.max_page ? s.max_page + " of " + pages : "—"], ["Pages viewed", keys.length ? plural(keys.length, "page") : null], ["Session expires", dt(s.expires_at)]]),
      keys.length ? h("div", {}, [h("div", { class: "sect", style: { padding: "0 1.1rem", margin: ".9rem 0 0" } }, "Time on each page")].concat(keys.map(function (k) { var m = h("div", { class: "meter" }, h("i")); m.firstChild.style.width = (dw[k] / mx) * 100 + "%"; return h("div", { class: "dwell" }, [h("span", {}, "p. " + k), m, h("b", {}, dur(dw[k]))]); }))) : null]);
    var tl = h("div", { class: "panel" }, [h("h4", {}, "Event timeline (" + s.events.length + ")"), s.events.length ? h("div", { class: "timeline" }, s.events.map(function (e) { var m = EVT[e.event] || [e.event.replace(/_/g, " "), ""]; return h("div", { class: "tl " + m[1] }, h("div", {}, [m[0] + (e.note && e.event !== "unlock_ok" ? " — " + e.note : ""), h("small", {}, dt(e.created_at))])); })) : h("div", { class: "muted", style: { padding: ".9rem 1.1rem" } }, "No events.")]);
    body.replaceChildren.apply(body, [acts, flagsPanel, idPanel, net, dev, act, tl].filter(Boolean)); // never pass null: replaceChildren would print the text "null"
  }

  // =============================================================== Documents
  function pageDocs() {
    return api("GET", "/api/docs").then(function (docs) {
      S.docs = docs; var file = h("input", { type: "file", accept: "application/pdf,.pdf", class: "hidden", onchange: function () { if (file.files[0]) send(file.files[0]); } });
      var prog = h("div", { class: "progress hidden" }, h("i")), info = h("div", { class: "hint" }, "PDF up to 50 MB. Stored encrypted. Password-protected PDFs aren't supported — remove the password first.");
      var drop = h("div", { class: "drop", tabindex: "0", role: "button", onclick: function () { file.click(); }, onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") file.click(); },
        ondragover: function (e) { e.preventDefault(); drop.classList.add("over"); }, ondragleave: function () { drop.classList.remove("over"); }, ondrop: function (e) { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); } },
        [ico("upload"), h("b", {}, "Drop a PDF here or click to upload"), info, prog, file]);
      function send(f) {
        if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return toast("Please choose a PDF file", "bad");
        var fd = new FormData(); fd.append("title", f.name.replace(/\.pdf$/i, "")); fd.append("file", f);
        var x = new XMLHttpRequest(); x.open("POST", "/api/docs"); x.setRequestHeader("X-Requested-With", "fetch"); prog.classList.remove("hidden"); var bar = prog.firstChild;
        x.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = (e.loaded / e.total) * 90 + "%"; };
        x.onload = function () { var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} bar.style.width = "100%"; if (x.status === 200) { toast("Uploaded — " + plural(j.pages, "page"), "ok"); pageDocs(); } else if (x.status === 401) showLogin(); else { toast(j.error || "Upload failed", "bad"); prog.classList.add("hidden"); } };
        x.onerror = function () { toast("Upload failed — check your connection", "bad"); prog.classList.add("hidden"); }; info.textContent = "Uploading and processing…"; x.send(fd);
      }
      var grid = docs.length ? h("div", { class: "docs" }, docs.map(function (d) {
        return h("div", { class: "card doc" }, [h("div", { class: "thumb" }, h("img", { src: "/api/docs/" + d.id + "/thumb", alt: "", loading: "lazy" })),
          h("div", { class: "meta" }, [h("b", {}, d.title), h("div", { class: "cell-sub" }, plural(d.pages, "page") + " · " + size(d.size || 0)), h("div", { class: "cell-sub" }, plural(d.links, "link") + " · " + ago(d.created_at))]),
          h("div", { class: "btns" }, [btn("Create link", { icon: "link", cls: "btn-sm btn-primary", onclick: function () { S.docs = docs; linkModal(); setTimeout(function () { var sel = document.querySelector(".modal select"); if (sel) sel.value = d.id; }, 50); } }), btn("", { icon: "trash", cls: "btn-sm", title: "Delete document", onclick: function () { confirmBox("Delete “" + d.title + "”?", "This permanently deletes the document, all " + plural(d.links, "link") + " for it, and their viewer history.", "Delete document", true).then(function (ok) { if (ok) api("DELETE", "/api/docs/" + d.id).then(function () { toast("Document deleted", "ok"); pageDocs(); }); }); } })])]);
      })) : null;
      mount(h("div", { class: "page" }, [pageHead("Documents", "Upload PDFs once, then share them through as many protected links as you like."), drop, grid || empty("doc", "No documents yet", "Upload your first PDF above.")]));
    });
  }

  // =============================================================== Activity
  var CAT = {
    all: function () { return true; },
    access: function (e) { return /^(unlock_ok|unlock_failed|blocked_|link_locked)/.test(e.event); },
    security: function (e) { return /^(blocked_action|copy_attempt|print_attempt|screenshot_key|devtools|admin_login_failed)/.test(e.event); },
    admin: function (e) { return /^admin_/.test(e.event); },
  };
  var EVLABEL = { unlock_ok: ["Opened", "b-ok"], unlock_failed: ["Wrong password", "b-bad"], link_locked: ["Link locked", "b-bad"], device_info: ["Device info", "b-info"], blocked_action: ["Blocked action", "b-warn"], copy_attempt: ["Copy attempt", "b-warn"], print_attempt: ["Print attempt", "b-warn"], screenshot_key: ["PrintScreen", "b-warn"], devtools: ["Dev tools", "b-warn"], tab_hidden: ["Left tab", "b-mute"], tab_visible: ["Back to tab", "b-mute"], closed: ["Closed", "b-mute"], fullscreen: ["Full screen", "b-mute"], admin_login: ["Admin sign-in", "b-brand"], admin_login_failed: ["Failed admin sign-in", "b-bad"] };
  function evBadge(ev) {
    var m = EVLABEL[ev]; if (!m) m = [ev.replace(/^blocked_/, "Blocked: ").replace(/^admin_/, "Admin: ").replace(/_/g, " "), /^blocked_/.test(ev) ? "b-bad" : /^admin_/.test(ev) ? "b-brand" : "b-mute"];
    return h("span", { class: "badge nodot " + m[1] }, m[0]);
  }
  function pageActivity(q) {
    var f = { cat: "all", q: "", noisy: false };
    return api("GET", "/api/logs?limit=1500").then(function (all) {
      S.logs = all; var tbl = h("div", { class: "tablewrap" });
      var search = h("input", { type: "search", placeholder: "Search IP, city, note…", oninput: debounce(function () { f.q = search.value.toLowerCase(); draw(); }, 200) });
      var seg = h("div", { class: "seg" }, [["all", "All"], ["access", "Access"], ["security", "Security"], ["admin", "Admin"]].map(function (m) { return h("button", { type: "button", class: m[0] === f.cat ? "on" : "", onclick: function (e) { f.cat = m[0]; seg.querySelectorAll("button").forEach(function (b) { b.classList.remove("on"); }); e.target.classList.add("on"); draw(); } }, m[1]); }));
      var noisy = h("input", { type: "checkbox", onchange: function () { f.noisy = noisy.checked; draw(); } });
      var rowsNow = [];
      function draw() {
        rowsNow = S.logs.filter(function (e) { return CAT[f.cat](e) && (f.noisy || f.cat !== "all" || !/^(device_info|tab_hidden|tab_visible|closed|fullscreen)$/.test(e.event)) && (!f.q || [e.ip, e.city, e.note, e.label, e.isp, e.user_agent].join(" ").toLowerCase().indexOf(f.q) >= 0); });
        tbl.replaceChildren(rowsNow.length ? h("table", {}, [h("thead", {}, h("tr", {}, ["Time", "Event", "Link", "IP address", "Location", "Network", "Browser · OS", "Details"].map(function (x) { return h("th", {}, x); }))), h("tbody", {}, rowsNow.slice(0, 600).map(function (e) {
          var open = e.session_id ? function () { openSession(e.session_id); } : null;
          return h("tr", { class: open ? "click" : "", onclick: open }, [h("td", { class: "nowrap" }, [h("div", {}, ago(e.created_at)), h("div", { class: "cell-sub" }, dt(e.created_at))]), h("td", {}, evBadge(e.event)), h("td", {}, e.label || (e.link_id ? "#" + e.link_id : "—")),
            h("td", { class: "mono nowrap" }, e.ip || "—"), h("td", { class: "nowrap" }, [flag(e.geo_country && e.country ? e.country : e.country), " ", [e.city, e.geo_country || e.country].filter(Boolean).join(", ") || "—"]), h("td", { class: "nowrap" }, e.isp || "—"),
            h("td", { class: "nowrap" }, [e.browser || "—", e.os ? " · " + e.os : ""]), h("td", {}, h("div", { class: "trunc", style: { maxWidth: "240px" }, title: e.note || "" }, e.note || ""))]);
        }))]) : empty("activity", "No activity", "Nothing matches these filters."));
        count.textContent = rowsNow.length + " events";
      }
      var count = h("small", { class: "muted" });
      mount(h("div", { class: "page" }, [pageHead("Activity log", "Every unlock, failed attempt, blocked action and admin change.", [btn("Refresh", { icon: "refresh", onclick: go }), btn("Export CSV", { icon: "download", onclick: function () { var cols = ["created_at", "event", "label", "ip", "geo_country", "country", "region", "city", "isp", "browser", "os", "device", "screen", "timezone", "language", "session_id", "note", "forwarded_chain", "user_agent"]; download("activity-log.csv", [cols.join(",")].concat(rowsNow.map(function (r) { return cols.map(function (c) { return csvEsc(r[c]); }).join(","); })).join("\n")); } })]),
        h("div", { class: "card" }, [h("div", { class: "toolbar" }, [search, seg, h("label", { class: "check", style: { margin: 0 } }, [noisy, h("span", {}, "Include routine events")]), h("div", { style: { marginLeft: "auto" } }, count)]), tbl])]));
      draw();
    });
  }

  // =============================================================== Security
  function pageSecurity() {
    return api("GET", "/api/security").then(function (s) {
      var ck = function (state, title, text, action) { return h("div", { class: "ck" }, [h("div", { class: "st " + state }, ico(state === "ok" ? "check" : "alert")), h("div", { class: "grow" }, [h("b", {}, title), h("small", {}, text)]), action]); };
      var weakPw = !s.adminHash && s.adminPwLen < 12;
      var checks = h("div", { class: "card" }, [h("div", { class: "card-head" }, h("h3", {}, "Protection status")), h("div", { class: "check-list" }, [
        ck(s.https ? "ok" : "warn", "Encrypted connection (HTTPS)", s.https ? "Traffic between viewers and this server is encrypted." : "This connection is not HTTPS. Use your host's https:// address."),
        ck(s.secureCookies ? "ok" : "warn", "Hardened cookies", s.secureCookies ? "Session cookies are HttpOnly, Secure and SameSite, with __Host-/__Secure- prefixes." : "Running in development mode: set NODE_ENV=production."),
        ck(s.totp ? "ok" : "warn", "Two-factor sign-in for this admin panel", s.totp ? "An authenticator code is required at every sign-in." : "Not enabled. Use the \u201cSet up 2FA\u201d card on this page — it takes about a minute."),
        ck(!weakPw ? "ok" : "warn", "Admin password strength", s.adminHash ? "Stored as a bcrypt hash." : weakPw ? "Your admin password is " + s.adminPwLen + " characters. Use a 12+ character passphrase." : "Strong length."),
        ck("ok", "PDFs encrypted at rest (AES-256-GCM)", s.separateDataKey ? "Using a dedicated DATA_KEY." : "Using a key derived from SESSION_SECRET. Set a separate permanent DATA_KEY so rotating SESSION_SECRET can never lock you out of your files."),
        ck("ok", "Original PDF never leaves the server", "Pages are rendered to watermarked images on the server. There is no file for viewers to download or extract."),
        ck(s.persist && s.persist.enabled ? (s.persist.lastError ? "warn" : "ok") : "warn", "Data survives restarts (MongoDB backup)",
          s.persist && s.persist.enabled ? (s.persist.lastError ? "Last backup problem: " + s.persist.lastError : s.persist.lastBackup ? "Last backup: " + new Date(s.persist.lastBackup).toLocaleString() + ". Links, logs, 2FA and PDFs are restored automatically after a restart." : "Connected. The first backup is being made…") : "Not set up. On free hosting without a disk, everything is erased when the server restarts. Set MONGODB_URI to keep your data."),
        ck(s.geo ? "ok" : "warn", "IP location & ISP lookup", s.geo ? "Enabled (uses ipwho.is). Set GEO_LOOKUP=off to disable." : "Disabled — location details will be limited."),
        ck(s.webhook ? "ok" : "warn", "Instant alerts", s.webhook ? "Webhook alerts are active (opens, repeated failures, lockouts)." : "Optional: set WEBHOOK_URL (Slack/Discord) to be notified when a link is opened."),
        ck("ok", "Log retention", "Activity older than " + s.retentionDays + " days is deleted automatically (LOG_RETENTION_DAYS)."),
      ])]);
      var c = s.connection;
      var conn = h("div", { class: "card" }, [h("div", { class: "card-head" }, [h("h3", {}, "Your connection, as this server sees it"), h("small", {}, "Verify IP detection")]), h("div", { style: { padding: ".3rem 0" } }, kv([["Detected IP", c.ip, "mono"], ["X-Forwarded-For", c.xff, "mono"], ["CDN country header", c.cfCountry], ["Protocol", c.proto], ["Host", c.host], ["Trusted proxy hops", String(s.trustProxyHops)]])),
        h("div", { class: "card-pad muted", style: { fontSize: ".82rem", borderTop: "1px solid var(--line)" } }, "The detected IP should be your own public address. If it shows a hosting provider's address instead, change TRUST_PROXY_HOPS (try 2) in your environment settings — otherwise viewer IPs will be wrong.")]);
      var ipIn = h("input", { type: "text", placeholder: "IP address to block", class: "mono" }), why = h("input", { type: "text", placeholder: "Reason (optional)" });
      var bl = h("div", { class: "card" }, [h("div", { class: "card-head" }, [h("h3", {}, "Blocked IP addresses"), h("small", {}, plural(s.blocked.length, "address"))]),
        h("form", { class: "toolbar", onsubmit: function (e) { e.preventDefault(); api("POST", "/api/blocked-ips", { ip: ipIn.value.trim(), reason: why.value }).then(function (r) { toast("Blocked" + (r.ended ? " — ended " + plural(r.ended, "session") : ""), "ok"); pageSecurity(); }).catch(function (x) { toast(x.message, "bad"); }); } }, [ipIn, why, btn("Block", { type: "submit", cls: "btn-primary", icon: "ban" })]),
        s.blocked.length ? h("div", { class: "list" }, s.blocked.map(function (b) { return h("div", { class: "list-item" }, [h("div", { class: "grow" }, [h("div", { class: "mono cell-main" }, b.ip), h("div", { class: "cell-sub" }, (b.reason || "No reason") + " · " + dt(b.created_at))]), btn("Unblock", { cls: "btn-sm", onclick: function () { api("DELETE", "/api/blocked-ips/" + encodeURIComponent(b.ip)).then(function () { toast("Unblocked", "ok"); pageSecurity(); }); } })]); })) : h("div", { class: "empty" }, "No blocked addresses.")]);
      var sess = h("div", { class: "card card-pad" }, [h("h3", { style: { marginBottom: ".3rem" } }, "Admin sessions"), h("p", { class: "muted", style: { marginBottom: "1rem" } }, plural(s.adminSessions, "active sign-in") + ". Sign out everywhere if you used a shared computer."), btn("Sign out of all devices", { icon: "logout", cls: "btn-danger", onclick: function () { confirmBox("Sign out everywhere?", "All admin sessions, including this one, end now.", "Sign out all", true).then(function (ok) { if (ok) api("POST", "/api/logout-everywhere", {}).then(showLogin); }); } })]);
      mount(h("div", { class: "page" }, [pageHead("Security", "Protection status, network checks and blocked addresses."), h("div", { class: "grid-2" }, [checks, h("div", { style: { display: "grid", gap: "1rem", alignContent: "start" } }, [twofaCard(s), conn, sess])]), bl]));
    });
  }

  // ---- two-factor setup, entirely inside the panel
  function twofaCard(s) {
    var card = h("div", { class: "card card-pad" });
    card.append(h("h3", { style: { marginBottom: ".3rem" } }, "Two-factor authentication"),
      h("p", { class: "muted", style: { marginBottom: "1rem" } }, s.totp ? "On — every sign-in needs a 6-digit code from your authenticator app." : "Off — anyone with your password can sign in. Add a second step using an authenticator app."));
    if (s.totpSource === "env") card.append(h("div", { class: "alert alert-info", style: { margin: 0 } }, "Managed by the ADMIN_TOTP_SECRET setting on your host."));
    else if (s.totp) card.append(btn("Turn off 2FA", { cls: "btn-danger btn-sm", onclick: disable2fa }));
    else card.append(btn("Set up 2FA", { icon: "shield", cls: "btn-primary", onclick: setup2fa }));
    return card;
  }
  function setup2fa() {
    api("POST", "/api/2fa/start", {}).then(function (r) {
      var code = h("input", { type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code", placeholder: "123456", pattern: "[0-9]*", style: { maxWidth: "11rem", fontSize: "1.2rem", letterSpacing: ".25em", textAlign: "center" } });
      var err = h("div", { class: "alert alert-bad hidden" }), enable;
      var body = h("div", {}, [
        h("div", { class: "sect" }, "1 · Scan with your authenticator app"),
        h("div", { style: { display: "flex", gap: "1.2rem", flexWrap: "wrap", alignItems: "center" } }, [
          h("img", { src: r.qr, alt: "QR code for two-factor setup", width: "232", height: "232", style: { borderRadius: "10px", border: "1px solid var(--line)", background: "#fff" } }),
          h("div", { class: "grow", style: { minWidth: "200px" } }, [h("p", { class: "muted" }, "Use Google Authenticator, Authy, Microsoft Authenticator or 1Password. Can't scan? Choose “Enter a setup key” and type this:"),
            h("div", { class: "secret", style: { marginTop: ".6rem", fontSize: ".95rem" } }, r.secret.replace(/(.{4})/g, "$1 ").trim()), h("div", { style: { marginTop: ".6rem" } }, btn("Copy key", { icon: "copy", cls: "btn-sm", onclick: function () { copy(r.secret, "Key copied"); } }))]),
        ]),
        h("div", { class: "sect" }, "2 · Enter the 6-digit code it shows"), code, err,
        h("div", { class: "alert alert-warn", style: { marginTop: "1rem", marginBottom: 0 } }, "The key is saved encrypted in this app's database. If your host wipes data on restart (free hosting without a disk), 2FA turns itself off and you can set it up again."),
      ]);
      var m = modal({ title: "Set up two-factor sign-in", body: body, foot: function (close) { enable = btn("Turn on 2FA", { cls: "btn-primary", onclick: submit }); return [btn("Cancel", { onclick: close }), enable]; } });
      code.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      function submit() {
        err.classList.add("hidden"); enable.disabled = true;
        api("POST", "/api/2fa/enable", { code: code.value.replace(/\s/g, "") }).then(function () { m.close(); S.totp = true; toast("Two-factor sign-in is on", "ok"); pageSecurity(); })
          .catch(function (x) { err.textContent = x.message; err.classList.remove("hidden"); enable.disabled = false; code.select(); });
      }
    }).catch(function (x) { toast(x.message, "bad"); });
  }
  function disable2fa() {
    var pw = h("input", { type: "password", autocomplete: "current-password" }), code = h("input", { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "6-digit code" }), err = h("div", { class: "alert alert-bad hidden" }), go2;
    var m = modal({ title: "Turn off two-factor sign-in", body: h("div", {}, [h("p", { class: "muted", style: { marginBottom: "1rem" } }, "Confirm with your password and a current code."), h("div", { class: "field" }, [h("label", {}, "Admin password"), pw]), h("div", { class: "field" }, [h("label", {}, "Authentication code"), code]), err]),
      foot: function (close) { go2 = btn("Turn off", { cls: "btn-danger", onclick: function () { err.classList.add("hidden"); go2.disabled = true; api("POST", "/api/2fa/disable", { password: pw.value, code: code.value.replace(/\s/g, "") }).then(function () { m.close(); S.totp = false; toast("2FA turned off", "ok"); pageSecurity(); }).catch(function (x) { err.textContent = x.message; err.classList.remove("hidden"); go2.disabled = false; }); } }); return [btn("Cancel", { onclick: close }), go2]; } });
  }

  // =============================================================== boot
  function boot() {
    fetch("/admin/status", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      S.totp = j.totp; S.app = j.app || S.app; document.title = "Admin · " + S.app;
      if (!j.signedIn) return showLogin();
      renderShell(); if (!location.hash) location.hash = "#/overview"; go();
      api("GET", "/api/overview").then(function (d) { setLive(d.live); }).catch(function () {});
    }).catch(showLogin);
  }
  boot();
})();
