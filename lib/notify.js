"use strict";
/** Optional webhook alerts (Slack / Discord / Teams-compatible JSON). Never throws, never blocks. */
const cfg = require("./config");

function notify(text) {
  if (!cfg.webhookUrl) return;
  fetch(cfg.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `[${cfg.appName}] ${text}`, content: `[${cfg.appName}] ${text}` }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
module.exports = { notify };
