(function () {
  "use strict";
  var root = document.getElementById("app");
  var state = { tab: "links", docs: [], links: [], logs: [], logLink: null };

  // ---- tiny DOM helper (never uses innerHTML, so logged user-agents etc. cannot inject markup) ----
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }

  function api(method, url, body, isForm) {
    var opt = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "fetch" } };
    if (body && !isForm) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    if (body && isForm) opt.body = body;
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url !== "/admin/login") { renderLogin(); throw new Error("auth"); }
        if (!r.ok) throw new Error(j.error || "Request failed");
        return j;
      });
    });
  }
  function toast(el, text, ok) { el.textContent = text; el.style.color = ok ? "var(--ok)" : "var(--bad)"; }
  function utc(s) { return s ? new Date(s.replace(" ", "T") + "Z") : null; }
  function fmt(s) { var d = utc(s); return d ? d.toLocaleString() : "—"; }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; }
  function genPw() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", out = "", a = new Uint32Array(12);
    crypto.getRandomValues(a); for (var i = 0; i < 12; i++) out += chars[a[i] % chars.length]; return out;
  }
  function copy(text, btn) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
      var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = o; }, 1200);
    }).catch(function () { window.prompt("Copy this:", text); });
  }

  // ---------------- login ----------------
  function renderLogin() {
    var err = h("div", { class: "err" });
    var pw = h("input", { type: "password", id: "pw", autofocus: "autofocus", required: "required" });
    var form = h("form", { class: "card", onsubmit: function (e) {
      e.preventDefault();
      api("POST", "/admin/login", { password: pw.value }).then(boot).catch(function (x) { err.textContent = x.message; });
    } }, [
      h("div", { class: "lock" }, "🛡️"), h("h1", {}, "Admin sign in"),
      h("p", { class: "sub" }, "Secure PDF Share"),
      h("label", { for: "pw" }, "Admin password"), pw, err,
      h("button", { class: "btn block", type: "submit" }, "Sign in"),
    ]);
    root.replaceChildren(h("main", { class: "center" }, form));
  }

  // ---------------- shell ----------------
  function renderShell() {
    var tabs = [["links", "Share links"], ["docs", "Documents"], ["activity", "Activity log"]];
    root.replaceChildren(h("div", { class: "wrap" }, [
      h("div", { class: "top" }, [
        h("h2", {}, "🔐 Secure PDF Share"),
        h("button", { class: "btn ghost sm", onclick: function () { api("POST", "/admin/logout", {}).then(renderLogin); } }, "Sign out"),
      ]),
      h("div", { class: "tabs" }, tabs.map(function (t) {
        return h("button", { class: "tab" + (state.tab === t[0] ? " active" : ""), onclick: function () { state.tab = t[0]; if (t[0] !== "activity") state.logLink = null; load(); } }, t[1]);
      })),
      h("div", { id: "view" }),
    ]));
  }

  function load() {
    renderShell();
    if (state.tab === "docs") api("GET", "/api/docs").then(function (d) { state.docs = d; viewDocs(); });
    else if (state.tab === "links") Promise.all([api("GET", "/api/docs"), api("GET", "/api/links")]).then(function (r) { state.docs = r[0]; state.links = r[1]; viewLinks(); });
    else api("GET", "/api/logs?limit=500" + (state.logLink ? "&link_id=" + state.logLink : "")).then(function (l) { state.logs = l; viewActivity(); });
  }
  function mount(node) { document.getElementById("view").replaceChildren.apply(document.getElementById("view"), [].concat(node)); }

  // ---------------- documents ----------------
  function viewDocs() {
    var msg = h("div", { class: "err" });
    var title = h("input", { type: "text", placeholder: "Display title (optional)" });
    var file = h("input", { type: "file", accept: "application/pdf", required: "required" });
    var up = h("form", { class: "panel", onsubmit: function (e) {
      e.preventDefault();
      var fd = new FormData(); fd.append("title", title.value); fd.append("file", file.files[0]);
      toast(msg, "Uploading…", true);
      api("POST", "/api/docs", fd, true).then(load).catch(function (x) { toast(msg, x.message, false); });
    } }, [
      h("h3", {}, "Upload a PDF"),
      h("div", { class: "grid" }, [h("div", {}, [h("label", {}, "Title"), title]), h("div", {}, [h("label", {}, "PDF file"), file]), h("button", { class: "btn", type: "submit" }, "Upload")]),
      msg,
    ]);
    var rows = state.docs.map(function (d) {
      return h("tr", {}, [
        h("td", {}, d.title), h("td", {}, size(d.size || 0)), h("td", {}, d.links), h("td", {}, fmt(d.created_at)),
        h("td", {}, h("button", { class: "btn danger sm", onclick: function () {
          if (confirm("Delete this document and all of its links and logs?")) api("DELETE", "/api/docs/" + d.id).then(load);
        } }, "Delete")),
      ]);
    });
    var table = state.docs.length
      ? h("div", { class: "tablewrap" }, h("table", {}, [h("thead", {}, h("tr", {}, ["Title", "Size", "Links", "Uploaded", ""].map(function (x) { return h("th", {}, x); }))), h("tbody", {}, rows)]))
      : h("div", { class: "empty" }, "No documents yet. Upload your first PDF above.");
    mount([up, h("div", { class: "panel" }, [h("h3", {}, "Documents"), table])]);
  }

  // ---------------- links ----------------
  function badge(st) {
    var map = { ok: ["Active", "b-ok"], revoked: ["Revoked", "b-bad"], expired: ["Expired", "b-warn"], limit: ["View limit reached", "b-warn"] };
    var m = map[st] || [st, "b-info"]; return h("span", { class: "badge " + m[1] }, m[0]);
  }
  function viewLinks() {
    var msg = h("div", { class: "err" }), result = h("div", {});
    var sel = h("select", { required: "required" }, [h("option", { value: "" }, "Select document…")].concat(state.docs.map(function (d) { return h("option", { value: d.id }, d.title); })));
    var label = h("input", { type: "text", placeholder: "e.g. Sent to Rahul (HR)" });
    var pw = h("input", { type: "text", value: genPw(), class: "mono", required: "required", minlength: "4" });
    var exp = h("input", { type: "datetime-local" });
    var mv = h("input", { type: "number", min: "1", placeholder: "Unlimited" });
    var form = h("form", { class: "panel", onsubmit: function (e) {
      e.preventDefault();
      var password = pw.value;
      api("POST", "/api/links", { doc_id: +sel.value, label: label.value, password: password, expires_at: exp.value || null, max_views: mv.value || null })
        .then(function (r) {
          var urlIn = h("input", { type: "text", readonly: "readonly", value: r.url, class: "mono" });
          var cb = h("button", { class: "btn", type: "button", onclick: function () { copy(r.url, cb); } }, "Copy link");
          var cp = h("button", { class: "btn ghost", type: "button", onclick: function () { copy(password, cp); } }, "Copy password");
          result.replaceChildren(h("div", { class: "notice", style: null }, ["Link created. Share the password separately — it cannot be shown again. Password: ", h("b", { class: "mono" }, password)]), h("div", { class: "linkbox" }, [urlIn, cb, cp]));
          toast(msg, "", true);
          api("GET", "/api/links").then(function (l) { state.links = l; drawTable(); });
        }).catch(function (x) { toast(msg, x.message, false); });
    } }, [
      h("h3", {}, "Create a share link"),
      h("div", { class: "grid" }, [
        h("div", {}, [h("label", {}, "Document"), sel]), h("div", {}, [h("label", {}, "Label (who is it for)"), label]),
        h("div", {}, [h("label", {}, "Password"), pw]), h("div", {}, [h("label", {}, "Expires (optional)"), exp]),
        h("div", {}, [h("label", {}, "Max unlocks (optional)"), mv]),
        h("div", {}, [h("button", { class: "btn", type: "submit" }, "Create link")]),
      ]),
      msg, result,
    ]);
    var tableHost = h("div", { class: "panel" });
    function drawTable() {
      var rows = state.links.map(function (l) {
        var cpb = h("button", { class: "btn ghost sm", onclick: function () { copy(l.url, cpb); } }, "Copy link");
        return h("tr", {}, [
          h("td", {}, l.label || "—"), h("td", {}, l.doc_title), h("td", {}, badge(l.status)),
          h("td", {}, l.view_count + (l.max_views ? " / " + l.max_views : "")),
          h("td", {}, l.failed_attempts ? h("span", { class: "badge b-warn" }, l.failed_attempts) : "0"),
          h("td", {}, fmt(l.last_opened)), h("td", {}, l.expires_at ? fmt(l.expires_at) : "Never"),
          h("td", {}, h("div", { class: "row" }, [
            cpb,
            h("button", { class: "btn ghost sm", onclick: function () { state.tab = "activity"; state.logLink = l.id; load(); } }, "Who opened it"),
            h("button", { class: "btn ghost sm", onclick: function () {
              var p = window.prompt("New password for this link (min 4 chars):", genPw());
              if (p) api("POST", "/api/links/" + l.id + "/password", { password: p }).then(function () { alert("Password changed. Existing viewers are signed out."); }).catch(function (x) { alert(x.message); });
            } }, "Change password"),
            l.revoked
              ? h("button", { class: "btn ghost sm", onclick: function () { api("POST", "/api/links/" + l.id + "/restore", {}).then(load); } }, "Restore")
              : h("button", { class: "btn danger sm", onclick: function () { if (confirm("Revoke this link now? Nobody will be able to open it.")) api("POST", "/api/links/" + l.id + "/revoke", {}).then(load); } }, "Revoke"),
            h("button", { class: "btn ghost sm", onclick: function () { if (confirm("Delete this link and its activity log?")) api("DELETE", "/api/links/" + l.id).then(load); } }, "Delete"),
          ])),
        ]);
      });
      tableHost.replaceChildren(h("h3", {}, "Share links"), state.links.length
        ? h("div", { class: "tablewrap" }, h("table", {}, [h("thead", {}, h("tr", {}, ["Label", "Document", "Status", "Unlocks", "Failed tries", "Last opened", "Expires", "Actions"].map(function (x) { return h("th", {}, x); }))), h("tbody", {}, rows)]))
        : h("div", { class: "empty" }, state.docs.length ? "No links yet." : "Upload a document first (Documents tab)."));
    }
    drawTable();
    mount([form, tableHost]);
  }

  // ---------------- activity ----------------
  var EVENT_LABEL = {
    unlock_ok: ["Opened ✔", "b-ok"], unlock_failed: ["Wrong password", "b-bad"], device_info: ["Device info", "b-info"],
    page_view: ["Viewed page", "b-info"], blocked_action: ["Tried to copy/print/save", "b-warn"], tab_hidden: ["Left tab", "b-info"],
    closed: ["Closed", "b-info"], blocked_revoked: ["Tried revoked link", "b-bad"], blocked_expired: ["Tried expired link", "b-warn"],
    blocked_limit: ["Tried (limit hit)", "b-warn"], admin_login_failed: ["Failed admin login", "b-bad"],
  };
  function csv(rows) {
    var cols = ["created_at", "event", "label", "ip", "forwarded_chain", "country", "browser", "os", "device", "screen", "timezone", "platform", "language", "session_id", "note", "referer", "user_agent"];
    var esc = function (v) { v = v == null ? "" : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    return [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(","); })).join("\n");
  }
  function viewActivity() {
    var scope = state.logLink ? (state.links.find(function (l) { return l.id === state.logLink; }) || {}).label : null;
    var onlyKey = h("input", { type: "checkbox", id: "keyonly", checked: "checked" });
    var host = h("div", { class: "tablewrap" });
    function draw() {
      var noisy = { page_view: 1, device_info: 1, tab_hidden: 1, closed: 1 };
      var rows = state.logs.filter(function (r) { return !onlyKey.checked || !noisy[r.event]; }).map(function (r) {
        var m = EVENT_LABEL[r.event] || [r.event, "b-info"];
        return h("tr", {}, [
          h("td", {}, fmt(r.created_at)), h("td", {}, h("span", { class: "badge " + m[1] }, m[0] + (r.event === "page_view" ? " " + (r.note || "") : ""))),
          h("td", {}, r.label || (r.link_id ? "#" + r.link_id : "—")),
          h("td", { class: "mono" }, r.ip || "—"), h("td", {}, r.country || "—"),
          h("td", {}, r.browser || "—"), h("td", {}, r.os || "—"), h("td", {}, r.device || "—"),
          h("td", {}, r.screen || "—"), h("td", {}, r.timezone || "—"), h("td", {}, (r.language || "—").split(",")[0]),
          h("td", { class: "mono" }, r.session_id || "—"),
          h("td", { class: "wrapcell", title: r.user_agent || "" }, r.event === "blocked_action" ? (r.note || "") : (r.forwarded_chain ? "via " + r.forwarded_chain : "")),
        ]);
      });
      host.replaceChildren(rows.length
        ? h("table", {}, [h("thead", {}, h("tr", {}, ["Time", "Event", "Link", "IP address", "Country", "Browser", "OS", "Device", "Screen", "Timezone", "Lang", "Session", "Details"].map(function (x) { return h("th", {}, x); }))), h("tbody", {}, rows)])
        : h("div", { class: "empty" }, "No activity yet."));
    }
    onlyKey.addEventListener("change", draw);
    var exp = h("button", { class: "btn ghost sm", onclick: function () {
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv(state.logs)], { type: "text/csv" }));
      a.download = "access-log.csv"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    } }, "Export CSV");
    mount(h("div", { class: "panel" }, [
      h("div", { class: "top" }, [
        h("h3", {}, "Activity" + (state.logLink ? " — " + (scope || "link #" + state.logLink) : " — all links")),
        h("div", { class: "row" }, [
          h("label", { style: null, for: "keyonly" }, [onlyKey, " Key events only"]),
          state.logLink ? h("button", { class: "btn ghost sm", onclick: function () { state.logLink = null; load(); } }, "Show all") : null,
          h("button", { class: "btn ghost sm", onclick: load }, "Refresh"), exp,
        ]),
      ]), host,
    ]));
    draw();
  }

  function boot() {
    api("GET", "/api/me").then(function () { load(); }).catch(function () { renderLogin(); });
  }
  boot();
})();
