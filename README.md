# Secure PDF Share

Upload a PDF, create a **password-protected, revocable link**, and see **exactly who opened it** (IP, country, browser, OS, device, screen, timezone, language). Viewers can only **view** — there is no download button and no direct file URL.

## How it works

| Piece | What it does |
|---|---|
| `/admin` | Your private dashboard (protected by `ADMIN_PASSWORD`): upload PDFs, create/revoke links, read the activity log, export CSV |
| `/s/<token>` | The link you share. Shows a password page, then the viewer |
| Viewer | Renders pages onto a `<canvas>` with pdf.js, stamped with the viewer's IP + time + session ID |
| Logs | Wrong passwords, successful opens, pages viewed, copy/print/save attempts, revoked-link attempts |

## Run locally

```bash
npm install
cp .env.example .env     # then edit the values
export $(grep -v '^#' .env | xargs)
npm start
# open http://localhost:3000/admin
```

## Deploy on Render (recommended)

1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint** and select the repo (it reads `render.yaml`).
3. Set `ADMIN_PASSWORD` when prompted. `SESSION_SECRET` is generated for you.
4. Your admin panel is at `https://<your-app>.onrender.com/admin`.

**A persistent disk is required** (the blueprint adds one at `/var/data`). Without it, uploaded PDFs and logs are wiped on every deploy/restart. Disks need a paid Render instance.

### Why not Vercel?

Vercel functions have no persistent filesystem, so uploaded PDFs and the SQLite log database would disappear. To use Vercel you would need to move PDFs to object storage (S3, R2, Vercel Blob) and the database to Postgres (Neon, Supabase). Render keeps this app simple.

## Security measures

- Admin and link passwords: bcrypt-hashed; admin password compared in constant time
- Signed, `HttpOnly`, `SameSite=Strict`, `Secure` cookies; viewer session lasts 1 hour
- Rate limiting on admin login and on password attempts (8 per 15 min per IP)
- Link tokens are 192-bit random; links can expire, have an unlock limit, be revoked or restored
- Changing a link's password immediately signs out current viewers
- The PDF is served only with a valid session **and** an in-app request header, with `no-store` caching — pasting the file URL in a browser returns 403
- Strict CSP (no inline scripts, no embedding in other sites), `noindex`, no referrer leakage
- Uploads validated as real PDFs; stored under random names, outside the web root
- Admin UI never uses `innerHTML`, so hostile User-Agent strings in logs cannot inject code

## Honest limits

Anything a browser can display can be captured by a determined person (screenshot, phone camera, screen recording). This app removes every easy path (download, save, print, copy, right-click, direct file URL) and **watermarks every page with the viewer's IP, time and session ID** so leaks are traceable — but no web tool can make capture impossible. For highly sensitive files, also use short expiries and unlock limits.

IP addresses are as reported by the proxy (`X-Forwarded-For`). Country uses the `CF-IPCountry` header when your host provides it. Please keep the notice on the password page — telling viewers they are logged is good practice and may be legally required (e.g. GDPR/DPDP).
