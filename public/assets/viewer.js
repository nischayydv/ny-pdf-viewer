(function () {
  "use strict";
  var token = document.body.dataset.token;
  var stage = document.getElementById("stage");
  var msg = document.getElementById("msg");
  var pager = document.getElementById("pager");
  var zlabel = document.getElementById("zlabel");
  var shield = document.getElementById("shield");
  var scale = 1; // user zoom multiplier on top of fit-to-width
  var pdf = null, meta = null, boxes = [], rendered = {};
  var lastBlockedLog = 0;

  function beacon(payload) {
    try {
      fetch("/s/" + token + "/beacon", {
        method: "POST", credentials: "same-origin", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
    } catch (e) {}
  }
  function blocked(what) {
    var now = Date.now();
    if (now - lastBlockedLog < 3000) return; // throttle
    lastBlockedLog = now;
    beacon({ event: "blocked_action", note: what });
  }

  // ---------- deterrents (cannot make download impossible, but removes every easy path) ----------
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); blocked("right-click"); });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  document.addEventListener("selectstart", function (e) { e.preventDefault(); });
  document.addEventListener("copy", function (e) { e.preventDefault(); blocked("copy"); });
  document.addEventListener("cut", function (e) { e.preventDefault(); });
  window.addEventListener("beforeprint", function () { blocked("print"); });
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if ((mod && ["s", "p", "c", "u", "a", "o"].indexOf(k) > -1) ||
        (mod && e.shiftKey && ["i", "j", "c", "s"].indexOf(k) > -1) ||
        k === "f12" || k === "printscreen") {
      e.preventDefault();
      blocked("shortcut:" + (mod ? "ctrl+" : "") + k);
      if (k === "printscreen" && navigator.clipboard) { try { navigator.clipboard.writeText(""); } catch (x) {} }
    }
  });
  // cover the document whenever the tab/window loses focus (hampers screen-capture tools)
  function setShield(on) { shield.classList.toggle("hidden", !on); }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { setShield(true); beacon({ event: "tab_hidden" }); }
  });
  window.addEventListener("blur", function () { setShield(true); });
  window.addEventListener("focus", function () { setShield(false); });
  shield.addEventListener("click", function () { setShield(false); window.focus(); });
  window.addEventListener("pagehide", function () { beacon({ event: "closed" }); });

  // ---------- device details ----------
  beacon({
    event: "device_info",
    screen: screen.width + "x" + screen.height + " @" + (window.devicePixelRatio || 1) + "x",
    timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || "",
    platform: navigator.platform || "",
  });

  // ---------- rendering ----------
  function fail(text) { msg.textContent = text; msg.classList.remove("hidden"); }

  function drawWatermark(ctx, w, h) {
    var text = (meta.ip + "  ·  " + meta.at + "  ·  " + meta.sid);
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = "#000";
    ctx.font = Math.max(14, Math.round(w / 38)) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 6);
    var step = Math.max(90, Math.round(h / 7));
    for (var y = -h; y < h; y += step) {
      for (var x = -w; x < w; x += Math.round(w / 1.5)) ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  function layoutBoxes() {
    var avail = Math.min(stage.clientWidth - 24, 1000) * scale;
    boxes.forEach(function (b) {
      var w = avail, h = avail * b.ratio;
      b.el.style.width = w + "px"; b.el.style.height = h + "px";
    });
  }

  function renderPage(i) {
    if (rendered[i] === "busy" || rendered[i] === scale) return;
    rendered[i] = "busy";
    pdf.getPage(i).then(function (page) {
      var b = boxes[i - 1];
      var cssW = parseFloat(b.el.style.width);
      var vp0 = page.getViewport({ scale: 1 });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = page.getViewport({ scale: (cssW / vp0.width) * dpr });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      var ctx = canvas.getContext("2d", { alpha: false });
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        drawWatermark(ctx, canvas.width, canvas.height);
        b.el.replaceChildren(canvas);
        rendered[i] = scale;
        page.cleanup();
      });
    }).catch(function () { rendered[i] = null; });
  }

  var io = null;
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var i = +en.target.dataset.page;
        if (en.isIntersecting) renderPage(i);
      });
    }, { root: stage, rootMargin: "600px 0px" });
    boxes.forEach(function (b) { io.observe(b.el); });
  }

  var seen = {};
  function trackCurrent() {
    var mid = stage.scrollTop + stage.clientHeight / 2, cur = 1;
    for (var i = 0; i < boxes.length; i++) {
      var el = boxes[i].el;
      if (el.offsetTop <= mid) cur = i + 1;
    }
    pager.textContent = cur + " / " + boxes.length;
    if (!seen[cur]) { seen[cur] = true; beacon({ event: "page_view", note: String(cur) }); }
  }
  stage.addEventListener("scroll", trackCurrent, { passive: true });

  function setZoom(z) {
    scale = Math.min(3, Math.max(0.5, z));
    zlabel.textContent = Math.round(scale * 100) + "%";
    rendered = {};
    layoutBoxes();
    observe();
  }
  document.getElementById("zin").addEventListener("click", function () { setZoom(scale + 0.25); });
  document.getElementById("zout").addEventListener("click", function () { setZoom(scale - 0.25); });
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { setZoom(scale); }, 200); });

  // ---------- boot ----------
  fetch("/s/" + token + "/meta", { credentials: "same-origin", cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("meta " + r.status); return r.json(); })
    .then(function (m) {
      meta = m;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      return pdfjsLib.getDocument({
        url: "/s/" + token + "/file",
        httpHeaders: { "X-Viewer": "1" },
        withCredentials: true,
        isEvalSupported: false,
        enableXfa: false,
      }).promise;
    })
    .then(function (doc) {
      pdf = doc;
      msg.classList.add("hidden");
      var frag = document.createDocumentFragment();
      var firsts = [];
      for (var i = 1; i <= pdf.numPages; i++) firsts.push(pdf.getPage(i));
      // read page ratios (cheap) so the scroll area is the right size up front
      return Promise.all(firsts).then(function (pages) {
        pages.forEach(function (p, idx) {
          var vp = p.getViewport({ scale: 1 });
          var el = document.createElement("div");
          el.className = "pagebox"; el.dataset.page = String(idx + 1);
          boxes.push({ el: el, ratio: vp.height / vp.width });
          frag.appendChild(el);
        });
        stage.appendChild(frag);
        layoutBoxes(); observe(); trackCurrent();
      });
    })
    .catch(function () {
      fail("This document could not be loaded. Your session may have expired — reload the page and enter the password again.");
    });
})();
