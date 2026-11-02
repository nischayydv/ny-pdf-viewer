# Secure PDF Share · v2

Share a PDF through a **password-protected, revocable, view-only link** and see exactly **who opened it, from where, on which device, and what they read**.

The viewer never receives your PDF. The server draws each page into an image, burns the viewer's name/IP/time into the pixels, and sends only that image. There is no file to download, save, or pull out of the page source.

---

## What you get

**Admin dashboard** (`/admin`)
- Overview: opens per day, live viewers, failed attempts, flagged sessions, top locations
- Share links: password, expiry, max unlocks, **device limit**, **IP allow-list**, session length, optional **name + email capture**, optional **confidentiality acceptance**, private notes
- Viewers: one row per person who opened a link, with a detail panel (below), **End session now** and **Block IP** buttons
- Activity log with filters and CSV export; Security center with a live checklist and an IP block list
- Light and dark mode, works on a phone

**Per viewer, you see**
| | |
|---|---|
| Identity | name, email, whether they accepted your confidentiality terms |
| Network | IP address, proxy chain, city / region / country, ISP, ASN, coordinates (+ map link), IP-timezone |
| Device | browser + version, OS + version, device model, CPU architecture, screen size, window size, pixel ratio, CPU cores, memory, touch support, GPU, languages, timezone, connection type/speed, a stable **device ID** (recognises the same device across links) |
| Behaviour | start time, last seen, **active reading time**, furthest page, **time spent on every page**, tab switches, fullscreen |
| Risk flags | automated/headless browser, dev-tools open, timezone ≠ IP location (VPN/proxy), device clock off, bulk page scraping, PrintScreen pressed |
| Attempts | wrong passwords (with the email they typed), copy / print / save attempts, access from blocked or revoked links |

**Kill switches:** revoke a link, end one session, change a password, block an IP. All take effect on the viewer's screen within ~5 seconds.

---

## Deploy on Render

> Vercel can't run this: it has no persistent disk for PDFs and the database, and the page renderer needs a long-running server.

1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → select the repo (it reads `render.yaml`). Choose a paid instance (persistent disks aren't on the free tier).
3. When prompted, set **`ADMIN_PASSWORD`** (12+ characters). `SESSION_SECRET` and `DATA_KEY` are generated for you.
4. Open `https://<your-service>.onrender.com/admin`.
5. **Admin → Security → "Your connection"**: the *Detected IP* must be your real public IP. If it shows something else, set `TRUST_PROXY_HOPS=2` and redeploy.

### Turn on 2FA (strongly recommended, no terminal needed)
1. Sign in to the admin panel, open **Security** and press **Set up 2FA**.
2. Scan the QR code with Google Authenticator / Authy / Microsoft Authenticator / 1Password (or type the setup key).
3. Enter the 6-digit code and press **Turn on 2FA**.

From then on the login asks for password + code. The key is stored encrypted in the app database. With `MONGODB_URI` set (below) it survives restarts; without a disk or MongoDB it is wiped on restart. `ADMIN_TOTP_SECRET` (made with `npm run totp`) still works and is optional.

### Keep your data after restarts (MongoDB) — needed on free hosting
Render's free plan has no disk, so uploads, links, logs and 2FA would be erased on every restart. Set one environment variable and the app keeps them safe in MongoDB Atlas:

1. In Atlas: **Network Access → Add IP Address → Allow access from anywhere (0.0.0.0/0)** (Render's free IPs change).
2. In Render → Environment add `MONGODB_URI` = your Atlas connection string (`mongodb+srv://USER:PASSWORD@…`). Never put it in the code or on GitHub.
3. Set a permanent `DATA_KEY` (any long random text) and keep it forever. PDFs and the 2FA secret are encrypted with it, so changing it makes the backup unreadable.
4. Run **one** instance only. Check Admin → Security → "Data survives restarts".

How it works: the local database is copied to MongoDB (about every 20 seconds after a change, and once more on shutdown), together with the already-encrypted PDFs. On boot the app restores them first. If MongoDB cannot be reached, the app refuses to start instead of starting empty, so a good backup is never overwritten. A hard crash can lose up to ~20 seconds of activity. The free Atlas tier holds 512 MB.

### Upgrading an existing v1 deployment
Replace the repo contents with this version (keep the same service and disk), commit and push.
1. **Before** the first v2 boot, add `DATA_KEY` in Render → Environment (any 40+ random characters). Never change it afterwards.
2. On first start the app adds the new database columns, reads page counts for your old documents, and **encrypts your existing PDFs in place**. Links, passwords and logs carry over.
3. Old links keep working. The viewer looks different and no longer exposes the PDF file.

If you boot v2 without `DATA_KEY`, the key falls back to a value derived from `SESSION_SECRET`; changing `SESSION_SECRET` later would then make stored PDFs unreadable. Setting a separate `DATA_KEY` avoids that.

---

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Admin password (12+ chars), or a bcrypt hash from `npm run hash -- "passphrase"` |
| `SESSION_SECRET` | yes | 24+ random characters |
| `DATA_KEY` | recommended | Encrypts stored PDFs. Set once, keep forever |
| `MONGODB_URI` | recommended on free hosting | Backs up data to MongoDB so restarts lose nothing |
| `ADMIN_TOTP_SECRET` | optional | Forces admin 2FA from env; otherwise set up in Admin → Security |
| `DATA_DIR` | on hosts with a disk | Where the database and PDFs live (Render: `/var/data`) |
| `TRUST_PROXY_HOPS` | default `1` | Reverse proxies in front of the app; decides which IP is "the viewer's" |
| `WEBHOOK_URL` | optional | Slack/Discord/Teams alert on opens, 3 wrong passwords, lockouts, device-limit hits |
| `GEO_LOOKUP` | default `on` | City/ISP lookup via ipwho.is. `off` sends no viewer IPs to any third party |
| `LOG_RETENTION_DAYS` | default `180` | Older activity is deleted automatically |
| `APP_NAME`, `PUBLIC_URL`, `MAX_UPLOAD_MB`, `MAX_PAGES`, `RENDER_CONCURRENCY` | optional | Branding, link base URL, limits, render parallelism |

## Run locally
```bash
npm install
cp .env.example .env          # edit it
set -a; . ./.env; set +a
npm start                     # http://localhost:3000/admin
```
Requires Node 22. (`better-sqlite3` has no prebuilt binary for newer Node majors yet.)

---

## Security model

**Protects against**
- Downloading or extracting the PDF: the file never leaves the server; pages are images
- Password guessing: bcrypt (cost 12), per-IP limits, and the link locks for 15 minutes after 10 wrong tries from anyone
- Stolen/leaked URLs: the link alone is useless without the password; a device limit, IP allow-list, expiry and unlock cap narrow it further
- A stolen disk or backup: PDFs are AES-256-GCM encrypted at rest
- Admin takeover: password + optional TOTP, server-side sessions bound to the browser, `__Host-` cookies (`HttpOnly`, `Secure`, `SameSite=Strict`), login throttling and lockout, CSRF checks (Fetch-Metadata + custom header), one-time-use 2FA codes
- Web attacks: strict CSP (no inline scripts, no framing), HSTS, `nosniff`, no-referrer, Permissions-Policy, parameterised SQL, no `innerHTML` in the admin UI
- Scraping: per-session page-fetch ceiling, render concurrency limit, canvas size cap

**Cannot protect against, and no web tool can**
- Someone photographing the screen or using a screen recorder. What this app does instead: every page carries the viewer's **name, IP, time and session ID** in a diagonal pattern plus a footer stamp, so a leak identifies who it came from.
- Browser-side deterrents (blocking right-click, copy, print, shortcuts, hiding the page when the window loses focus) stop casual attempts only. Treat them as speed bumps.
- Device recognition by cookie + fingerprint: someone with a different device and cleared cookies looks like a new device. Expiry, unlock caps and the IP allow-list are the stronger limits.
- IP location is approximate (often the ISP's city), and VPN users appear where their VPN exits.

**Be transparent with viewers.** The unlock page already tells them that IP, device and activity are recorded. Keep that notice; it is good practice and often legally required (GDPR, India's DPDP Act).

## Housekeeping notes
- Data lives in `DATA_DIR`: `app.db` (SQLite) and `pdfs/` (encrypted). Back up that directory. A backup of the PDFs is useless without `DATA_KEY`: store the key separately.
- `GET /healthz` returns `ok` for uptime checks.
- Page images are rendered on demand (~0.2–0.5 s each on a small instance) and cached briefly in memory.
- Third-party code: pdf.js (Apache-2.0), @napi-rs/canvas (MIT), Inter font (SIL OFL; license in `fonts/`).
