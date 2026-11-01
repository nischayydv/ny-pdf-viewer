// Generates a 2FA secret for the admin login.  Usage: npm run totp
const { generateSecret } = require("../lib/totp");
const s = generateSecret();
console.log("\nYour new 2FA secret (set it as ADMIN_TOTP_SECRET in your host's environment settings):\n");
console.log("  " + s + "\n");
console.log("Add it to Google Authenticator / Authy / 1Password: choose 'Enter a setup key',");
console.log("account name = Secure PDF Share, key = the secret above, type = time-based.\n");
console.log("Or open this URL as a QR in any QR generator:\n  otpauth://totp/Secure%20PDF%20Share:admin?secret=" + s + "&issuer=Secure%20PDF%20Share\n");
