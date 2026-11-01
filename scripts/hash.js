// Creates a bcrypt hash so the plain admin password never has to be stored.  Usage: npm run hash -- "your passphrase"
const bcrypt = require("bcryptjs");
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Usage: npm run hash -- "a long passphrase (10+ chars)"'); process.exit(1); }
console.log("\nSet this as ADMIN_PASSWORD:\n\n  " + bcrypt.hashSync(pw, 12) + "\n");
