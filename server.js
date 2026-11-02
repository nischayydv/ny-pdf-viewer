"use strict";
// Entry point: restore data from MongoDB (if MONGODB_URI is set) BEFORE the app opens its local database.
(async () => {
  const persist = require("./lib/persist");
  try { await persist.restore(); } catch (e) { console.error("[persist] fatal:", e.message); process.exit(1); }
  require("./app");
  persist.start();
})();
