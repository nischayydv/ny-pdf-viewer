(function () {
  "use strict";
  var app = document.querySelector(".vapp");
  var token = app.dataset.token;
  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), thumbsEl = $("thumbs"), loadingEl = $("loading");
  var pageInput = $("page-input"), pageTotal = $("page-total"), zoomLabel = $("zoom-label"), progress = $("progress");
  var meta = null, boxes = [], tops = [], zoom = 1, cur = 1, ended = false, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var HDR = { "X-Viewer": "1" };

  // ------------------------------------------------------------------ helpers
  function post(body) {
    return fetch("/s/" + token + "/beacon", {
      method: "POST", credentials: "same-origin", keepalive: true, cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (j) { if (j && j.ended) showEnded(j); return j; }).catch(function () {});
  }
  var lastEvt = {};
  function evt(type, note, minGap) {
    var now = Date.now();
    if (lastEvt[type] && now - lastEvt[type] < (minGap || 5000)) return;
    lastEvt[type] = now;
    post({ type: type, note: note || "" });
  }
  function showEnded(info) {
    if (ended) return; ended = true;
    $("ended-title").textContent = info.reason === "timeout" ? "Session expired" : "Session ended";
    $("ended-msg").textContent = info.message || "Your viewing session is no longer active.";
    $("ended").classList.remove("hidden");
    stage.innerHTML = ""; thumbsEl.innerHTML = "";
  }
  $("btn-reload").addEventListener("click", function () { location.reload(); });

  // ------------------------------------------------------------------ deterrents + activity signals
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); evt("blocked_action", "right-click"); });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  document.addEventListener("selectstart", function (e) { if (e.target.tagName !== "INPUT") e.preventDefault(); });
  document.addEventListener("copy", function (e) { e.preventDefault(); evt("copy_attempt", "copy"); });
  document.addEventListener("cut", function (e) { e.preventDefault(); });
  window.addEventListener("beforeprint", function () { evt("print_attempt", "print dialog"); });
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (e.target && e.target.tagName === "INPUT" && !mod) return;
    if (k === "printscreen") { e.preventDefault(); evt("screenshot_key", "PrintScreen"); try { navigator.clipboard.writeText(""); } catch (x) {} return; }
    if (mod && ["s", "p", "c", "u", "a", "o"].indexOf(k) > -1) { e.preventDefault(); evt(k === "p" ? "print_attempt" : "blocked_action", "ctrl+" + k); return; }
    if (k === "f12" || (mod && e.shiftKey && ["i", "j", "c"].indexOf(k) > -1)) { e.preventDefault(); evt("blocked_action", "devtools shortcut"); return; }
    if (mod) return;
    if (k === "arrowright") { e.preventDefault(); goto(cur + 1); }
    else if (k === "arrowleft") { e.preventDefault(); goto(cur - 1); }
    else if (k === "+" || k === "=") setZoom(zoom + 0.25);
    else if (k === "-") setZoom(zoom - 0.25);
    else if (k === "0") setZoom(1);
    else if (k === "t") toggleThumbs();
    else if (k === "f") toggleFull();
    else if (k === "home") { e.preventDefault(); goto(1); }
    else if (k === "end") { e.preventDefault(); goto(boxes.length); }
  });
  // cover the document whenever focus is lost (hampers screen-capture tools and shoulder-surfing)
  var shield = $("shield");
  function setShield(on) { shield.classList.toggle("hidden", !on || ended); }
  document.addEventListener("visibilitychange", function () { if (document.hidden) { setShield(true); evt("tab_hidden", "", 15000); } else evt("tab_visible", "", 15000); });
  window.addEventListener("blur", function () { setShield(true); });
  window.addEventListener("focus", function () { setShield(false); });
  shield.addEventListener("click", function () { setShield(false); window.focus(); });
  window.addEventListener("pagehide", function () { post({ type: "closed" }); });
  // developer-tools heuristic (docked panel changes the window/viewport difference)
  setInterval(function () {
    if (document.fullscreenElement || ("ontouchstart" in window)) return;
    if (window.outerWidth - window.innerWidth > 220 || window.outerHeight - window.innerHeight > 260) evt("devtools", "possible devtools panel", 60000);
  }, 2500);

  // ------------------------------------------------------------------ device fingerprint ("hello")
  function sha(str) {
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").slice(0, 32);
      });
    }
    var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return Promise.resolve(String(h >>> 0));
  }
  function collect() {
    var nav = navigator, scr = screen, c = nav.connection || {}, ro = {};
    try { ro = Intl.DateTimeFormat().resolvedOptions(); } catch (e) {}
    var fp = {
      timezone: ro.timeZone, locale: ro.locale, languages: nav.languages ? Array.prototype.slice.call(nav.languages) : [nav.language],
      platform: nav.platform, vendor: nav.vendor, cores: nav.hardwareConcurrency, memory: nav.deviceMemory, touch: nav.maxTouchPoints,
      screenW: scr.width, screenH: scr.height, availW: scr.availWidth, availH: scr.availHeight, colorDepth: scr.colorDepth, dpr: window.devicePixelRatio,
      viewW: window.innerWidth, viewH: window.innerHeight, outerW: window.outerWidth, outerH: window.outerHeight,
      orientation: scr.orientation && scr.orientation.type, tzOffsetMin: -new Date().getTimezoneOffset(), clientTime: Date.now(),
      cookies: nav.cookieEnabled, online: nav.onLine, webdriver: !!nav.webdriver, dnt: nav.doNotTrack || (window.doNotTrack || ""), pdfViewer: nav.pdfViewerEnabled,
      connType: c.effectiveType, downlink: c.downlink, rtt: c.rtt, saveData: !!c.saveData,
      colorScheme: window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      reducedMotion: window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches,
      gamut: window.matchMedia && (matchMedia("(color-gamut: rec2020)").matches ? "rec2020" : matchMedia("(color-gamut: p3)").matches ? "p3" : "srgb"),
      referrer: document.referrer ? new URL(document.referrer).origin : "",
    };
    try {
      var nt = performance.getEntriesByType("navigation")[0]; if (nt) fp.loadMs = Math.round(nt.duration);
    } catch (e) {}
    try {
      var cv = document.createElement("canvas"); var gl = cv.getContext("webgl") || cv.getContext("experimental-webgl");
      var ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) { fp.webglVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); fp.webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); }
    } catch (e) {}
    var cvs = "";
    try {
      var c2 = document.createElement("canvas"); c2.width = 240; c2.height = 60; var x = c2.getContext("2d");
      x.textBaseline = "top"; x.font = "16px Arial"; x.fillStyle = "#f60"; x.fillRect(100, 1, 62, 20); x.fillStyle = "#069"; x.fillText("Cwm fjordbank glyphs vext quiz ☺", 2, 15);
      x.fillStyle = "rgba(102,204,0,.7)"; x.fillText("Cwm fjordbank glyphs vext quiz ☺", 4, 17); cvs = c2.toDataURL();
    } catch (e) {}
    var hints = nav.userAgentData && nav.userAgentData.getHighEntropyValues
      ? nav.userAgentData.getHighEntropyValues(["platformVersion", "model", "architecture", "bitness", "fullVersionList"]).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([sha(cvs), hints]).then(function (r) {
      fp.canvasHash = r[0]; var h = r[1];
      if (nav.userAgentData) { fp.uaPlatform = nav.userAgentData.platform; fp.uaBrands = (nav.userAgentData.brands || []).map(function (b) { return b.brand + " " + b.version; }).join(", "); }
      if (h) { fp.uaPlatformVersion = h.platformVersion; fp.uaModel = h.model; fp.uaArch = h.architecture; fp.uaBitness = h.bitness; fp.uaFullVersion = (h.fullVersionList || []).map(function (b) { return b.brand + " " + b.version; }).join(", "); }
      return fp;
    });
  }
  collect().then(function (fp) { post({ type: "hello", fp: fp }); }).catch(function () {});

  // ------------------------------------------------------------------ active-time heartbeat
  var lastInput = Date.now(), pending = 0;
  ["scroll", "mousemove", "keydown", "touchstart", "pointerdown", "wheel"].forEach(function (n) { window.addEventListener(n, function () { lastInput = Date.now(); }, { passive: true, capture: true }); });
  setInterval(function () { if (!ended && !document.hidden && document.hasFocus() && Date.now() - lastInput < 90000) pending++; }, 1000);
  setInterval(function () {
    if (ended || !meta) return;
    var secs = pending; pending = 0;
    post({ type: "hb", page: cur, secs: secs, visible: !document.hidden });
  }, 5000); // also how quickly a revoked/ended session is noticed

  // ------------------------------------------------------------------ layout
  function baseWidth() { return Math.max(240, Math.min(stage.clientWidth - 32, 980)); }
  function layout() {
    var w = baseWidth() * zoom;
    tops = [];
    boxes.forEach(function (b) { b.el.style.width = w + "px"; b.el.style.height = Math.round(w * b.ratio) + "px"; b.w = w; });
    boxes.forEach(function (b, i) { tops[i] = b.el.offsetTop - stage.offsetTop; });
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
  }
  function tierFor(cssW) {
    var want = cssW * dpr, t = meta.tiers.filter(function (x) { return x >= 600; });
    for (var i = 0; i < t.length; i++) if (t[i] >= want * 0.92) return t[i];
    return t[t.length - 1];
  }

  // ------------------------------------------------------------------ image loading queue
  var queue = [], active = 0, MAXP = 3;
  function prio(job) { return job.thumb ? 600 + job.i : Math.abs(job.i - cur); }
  function enqueue(job) {
    for (var k = 0; k < queue.length; k++) if (queue[k].key === job.key) return;
    queue.push(job); pump();
  }
  function pump() {
    while (!ended && active < MAXP && queue.length) {
      queue.sort(function (a, b) { return prio(a) - prio(b); });
      run(queue.shift());
    }
  }
  function run(job) {
    active++;
    fetch("/s/" + token + "/p/" + (job.i + 1) + "?w=" + job.tier, { headers: HDR, credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 || r.status === 410 || (j && j.ended)) { showEnded(j && j.message ? j : { reason: "none", message: "Your session is no longer valid. Reload to unlock again." }); throw new Error("ended"); }
          var e = new Error("http " + r.status); e.status = r.status; throw e;
        });
        return r.blob();
      })
      .then(function (blob) { return createImageBitmap(blob); })
      .then(function (bmp) { job.done(bmp); })
      .catch(function (err) {
        if (err && err.message === "ended") return;
        job.fail(err);
      })
      .then(function () { active--; pump(); });
  }
  function wantPage(i) {
    var b = boxes[i]; if (!b || ended) return;
    var tier = tierFor(b.w);
    if (b.tier === tier || b.pending === tier) return;
    b.pending = tier;
    enqueue({ key: "p" + i + ":" + tier, i: i, tier: tier,
      done: function (bmp) {
        b.pending = 0;
        if (tierFor(b.w) !== tier && b.tier) { bmp.close && bmp.close(); b.tier = 0; return ensure(); } // zoom changed meanwhile
        var cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext("2d").drawImage(bmp, 0, 0); bmp.close && bmp.close();
        b.el.querySelectorAll("canvas,.perr").forEach(function (n) { n.remove(); });
        b.el.appendChild(cv); b.el.classList.remove("loading"); b.tier = tier; b.tries = 0;
        if (tierFor(b.w) !== tier) ensure();
      },
      fail: function (err) {
        b.pending = 0; b.tries = (b.tries || 0) + 1;
        if (b.tries <= 2 || (err && err.status === 429)) { setTimeout(ensure, 1500 * b.tries); return; }
        b.el.classList.remove("loading");
        var m = document.createElement("div"); m.className = "perr"; m.textContent = "Couldn’t load this page — tap to retry";
        m.addEventListener("click", function () { m.remove(); b.el.classList.add("loading"); b.tries = 0; ensure(); }); b.el.appendChild(m);
      } });
  }
  function ensure() {
    if (!boxes.length || ended) return;
    var top = stage.scrollTop, bottom = top + stage.clientHeight, margin = 1100;
    for (var i = 0; i < boxes.length; i++) {
      var t = tops[i], h = parseFloat(boxes[i].el.style.height);
      if (t + h > top - margin && t < bottom + margin) wantPage(i);
      else if (boxes[i].tier && Math.abs(i + 1 - cur) > 7) unload(boxes[i]);
    }
  }
  function unload(b) { // free memory for pages far from the reader
    b.el.querySelectorAll("canvas").forEach(function (c) { c.width = 0; c.remove(); });
    b.tier = 0; b.el.classList.add("loading");
  }

  // ------------------------------------------------------------------ navigation / zoom
  function currentFromScroll() {
    var mid = stage.scrollTop + stage.clientHeight * 0.35, lo = 0, hi = boxes.length - 1;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (tops[m] <= mid) lo = m; else hi = m - 1; }
    return lo + 1;
  }
  function setCurrent(n) {
    if (n === cur && pageInput.value === String(n)) return;
    cur = n; if (document.activeElement !== pageInput) pageInput.value = String(n);
    $("btn-prev").disabled = n <= 1; $("btn-next").disabled = n >= boxes.length;
    progress.style.width = (boxes.length > 1 ? ((n - 1) / (boxes.length - 1)) * 100 : 100) + "%";
    var t = thumbsEl.querySelectorAll(".vthumb");
    t.forEach(function (el, i) { el.classList.toggle("on", i === n - 1); });
    var on = thumbsEl.querySelector(".vthumb.on"); if (on && app.classList.contains("thumbs-on")) { var r = on.getBoundingClientRect(), pr = thumbsEl.getBoundingClientRect(); if (r.top < pr.top || r.bottom > pr.bottom) on.scrollIntoView({ block: "nearest" }); }
  }
  function goto(n) { n = Math.max(1, Math.min(boxes.length, n | 0)); stage.scrollTo({ top: tops[n - 1] - 14 }); setCurrent(n); ensure(); }
  function setZoom(z) {
    z = Math.max(0.5, Math.min(3, Math.round(z * 4) / 4)); if (z === zoom) return;
    var n = cur, frac = tops[n - 1] != null ? (stage.scrollTop - tops[n - 1]) / (parseFloat(boxes[n - 1].el.style.height) || 1) : 0;
    zoom = z; layout(); stage.scrollTop = tops[n - 1] + frac * parseFloat(boxes[n - 1].el.style.height); ensure();
  }
  function toggleThumbs() { app.classList.toggle("thumbs-on"); layout(); ensure(); }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen(); else if (app.requestFullscreen) app.requestFullscreen().then(function () { evt("fullscreen", "entered"); }).catch(function () {});
  }
  $("btn-prev").addEventListener("click", function () { goto(cur - 1); });
  $("btn-next").addEventListener("click", function () { goto(cur + 1); });
  $("btn-zin").addEventListener("click", function () { setZoom(zoom + 0.25); });
  $("btn-zout").addEventListener("click", function () { setZoom(zoom - 0.25); });
  $("btn-fit").addEventListener("click", function () { setZoom(1); });
  $("btn-thumbs").addEventListener("click", toggleThumbs);
  $("btn-full").addEventListener("click", toggleFull);
  pageInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { goto(parseInt(pageInput.value, 10) || cur); pageInput.blur(); stage.focus(); } });
  pageInput.addEventListener("blur", function () { pageInput.value = String(cur); });
  var raf = 0;
  stage.addEventListener("scroll", function () {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; if (boxes.length) { setCurrent(currentFromScroll()); ensure(); } });
  }, { passive: true });
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (!boxes.length) return; var n = cur; layout(); stage.scrollTop = tops[n - 1]; ensure(); }, 150); });
  // ctrl+wheel / pinch -> our zoom instead of browser zoom
  stage.addEventListener("wheel", function (e) { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 0.25 : -0.25)); } }, { passive: false });

  // ------------------------------------------------------------------ thumbnails
  function buildThumbs() {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return; var el = en.target, i = +el.dataset.i; io.unobserve(el);
        enqueue({ key: "t" + i, i: i, thumb: true, tier: 240,
          done: function (bmp) { var cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height; cv.getContext("2d").drawImage(bmp, 0, 0); bmp.close && bmp.close(); el.querySelector(".tbox").appendChild(cv); },
          fail: function () {} });
      });
    }, { root: thumbsEl, rootMargin: "300px 0px" });
    meta.ratios.forEach(function (r, i) {
      var b = document.createElement("button"); b.className = "vthumb"; b.dataset.i = String(i); b.type = "button"; b.setAttribute("aria-label", "Page " + (i + 1));
      var box = document.createElement("span"); box.className = "tbox"; box.style.aspectRatio = "1 / " + r;
      var lab = document.createElement("span"); lab.textContent = String(i + 1);
      b.appendChild(box); b.appendChild(lab); b.addEventListener("click", function () { goto(i + 1); if (window.innerWidth <= 720) app.classList.remove("thumbs-on"); });
      thumbsEl.appendChild(b); io.observe(b);
    });
  }

  // ------------------------------------------------------------------ boot
  fetch("/s/" + token + "/meta", { credentials: "same-origin", cache: "no-store" })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) { showEnded(j); throw new Error("ended"); } return j; }); })
    .then(function (m) {
      meta = m; loadingEl.remove();
      $("foot-text").textContent = "Protected view · " + (m.name || "Viewer") + " · session " + m.sid.slice(0, 8);
      pageTotal.textContent = "/ " + m.ratios.length;
      m.ratios.forEach(function (r, i) {
        var el = document.createElement("div"); el.className = "pbox loading"; el.dataset.page = String(i + 1);
        stage.appendChild(el); boxes.push({ el: el, ratio: r, tier: 0, pending: 0, w: 0 });
      });
      if (window.innerWidth > 900 && m.ratios.length > 1) app.classList.add("thumbs-on");
      layout(); buildThumbs(); setCurrent(1); $("btn-prev").disabled = true; $("btn-next").disabled = m.ratios.length < 2; ensure();
      stage.focus();
    })
    .catch(function (e) { if (!e || e.message !== "ended") { loadingEl.textContent = "This document could not be loaded. Reload the page and try again."; } });
})();
