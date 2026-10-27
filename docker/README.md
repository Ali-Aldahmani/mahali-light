# Bytecra POS — Docker notes

Canonical shop setup is the **root README.md**. Stack: `postgres`, `express-api`, `nextjs`, `web-tls` (Caddy, the HTTPS front door). Optional ML profile `fastapi`.

The `api` service was renamed to `express-api`. Electron is not required for tills.

```text
Server PC (static LAN IP)
  Docker
    ├── web-tls      (Caddy: HTTPS on WEB_TLS_PORT → 443; WEB_PORT → 80 redirects)
    ├── nextjs       (web UI, reached through web-tls only)
    ├── express-api  (Node 22, API + Socket.io; API_PORT → 3000 on 127.0.0.1 only)
    └── postgres     (not published to the LAN)
Browsers  ──LAN──►  https://SERVER_IP
```

---

## Requirements

- Windows 11 Pro
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the **Linux engine**
- Server PC on the shop LAN with a **static IPv4** (router reservation or manual IP)
- This repository on the server (Git clone or ZIP), e.g. `C:\BytecraPOS`

Do not run Docker on a till-only PC. Do not containerize Electron.

---

## Architecture notes (from this repo)

| Item | Value |
|------|--------|
| Node | 22 (same as CI) |
| Start command | `node server/index.js` (`npm run server`) |
| API listen port | `PORT` (Compose forces **3000** inside the container) |
| LAN publish | Only `web-tls`: 443 (HTTPS) and 80 (redirect). `API_PORT` is published on 127.0.0.1 for scripts |
| Database | PostgreSQL 16; API uses `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` (`DATABASE_URL` is **not** read by the app) |
| Migrations | `npm run migrate` → `node server/db/migrate.js` (idempotent `_migrations` table). **The API also runs migrations on every boot** — that is existing application behaviour, not a Docker invention. |
| Health | `GET /api/health` |
| Uploads | `UPLOADS_DIR` / `MAHALI_UPLOADS_DIR` → volume `/data/uploads` |
| App backups | default `./backups` → volume `/app/backups` (pg_dump custom format + uploads zip) |
| TLS | Node terminates TLS (`SERVER_USE_HTTPS`). Cert dir `TLS_DIR=/data/tls`. Docker does **not** terminate TLS. |
| PDF | Chromium in the image; `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` |

PostgreSQL is **not** mapped to a host port. Tills never connect to Postgres.

---

## Initial setup

### 1. Copy environment file

In PowerShell, from the project root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set **all** of these (do not leave `CHANGE_ME` / `REPLACE_ME`):

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | ≥ 32 random characters (64+ hex recommended) |
| `MAHALI_BACKUP_SECRET` | 64 hex chars; required in production |
| `POSTGRES_PASSWORD` | Strong password for the Docker Postgres user |
| `POSTGRES_USER` | e.g. `mahali` |
| `POSTGRES_DB` | e.g. `mahali_light` |
| `API_PORT` | API port on this PC only (usually `3000`) |
| `SERVER_IP` | This PC’s LAN IP, e.g. `192.168.1.100`. Set it **before** the first start: the HTTPS certificate is made for it |
| `SERVER_USE_HTTPS` | Keep `false`: Caddy terminates HTTPS |

Generate secrets:

```powershell
node -e "require('crypto').randomBytes(48,(e,b)=>console.log(b.toString('hex')))"
node -e "require('crypto').randomBytes(32,(e,b)=>console.log(b.toString('hex')))"
```

Leave `PGHOST=localhost` in `.env` if you still use PM2 on another machine. Compose **overrides** `PGHOST=postgres` for the API container only.

`.env` is gitignored. Never copy it into the image.

### 2. Firewall (HTTPS only)

Administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Bytecra POS HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443,80 -Action Allow
```

Do **not** open 3000 or 5432. If an older install opened 3000, remove that rule:
`Remove-NetFirewallRule -DisplayName "Bytecra POS API"`.

### 3. Build and start

```powershell
cd C:\BytecraPOS
docker compose build
docker compose up -d
```

### 4. Database migration

Preferred explicit run (same command as the project):

```powershell
docker compose run --rm express-api npm run migrate
```

Safe to re-run: already-applied files are skipped.

The API process **also** migrates during `node server/index.js` startup. If `docker compose up -d` already started a healthy API, schema is applied. Use the explicit command after upgrades.

Do **not** `npm run seed` on a live shop. Production seed skips the default `admin`/`admin123` user. Create the admin in the Electron setup wizard on the server till.

### 5. Verify

```powershell
docker compose ps
docker compose logs express-api --tail 80
docker compose logs postgres --tail 40
```

Both services should be **healthy**. From the server PC:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health" -UseBasicParsing
```

Then trust the shop certificate on every till and phone, and open `https://SERVER_IP`: [docs/HTTPS_SETUP.md](../docs/HTTPS_SETUP.md).

---

## Day-to-day commands

```powershell
docker compose build              # rebuild express-api + nextjs (required after code changes)
docker compose build nextjs       # rebuild POS website only (faster after UI edits)
docker compose up -d              # start
docker compose ps                 # status
docker compose logs -f express-api        # API logs
docker compose logs -f nextjs     # web UI logs
docker compose logs -f postgres   # database logs
docker compose restart            # restart containers — does NOT pick up new source code
docker compose restart express-api        # API only
docker compose down               # stop; KEEPS volumes (database + uploads + backups + tls)
```

**UI changes (POS buttons, pages, styles)** live in the **`nextjs`** image.  
`docker compose restart` or `up -d` alone reuses the **old** image. After `git pull` or editing `web/`:

```powershell
docker compose build nextjs
docker compose up -d nextjs
```

Open the till in a browser at **`https://SERVER_IP`**. Port **3000** answers this PC only. Hard-refresh once (**Ctrl+Shift+R**) to bypass cached JS.

**Never** use `docker compose down -v` in normal operations. `-v` deletes `postgres_data` and the API volumes.

---

## HTTPS

The `web-tls` service (Caddy) is the only way in from the LAN. It serves the web app, the API and live updates on `https://SERVER_IP` with a self-signed certificate it creates on first start, and redirects plain HTTP. The API refuses plain-HTTP requests from other machines (`REQUIRE_HTTPS`, on in production).

Each till and phone trusts the certificate once: [docs/HTTPS_SETUP.md](../docs/HTTPS_SETUP.md). That guide also covers a changed IP and using the shop's own certificate.

---

## Electron clients

Do not use `localhost` on a client till.

1. Install `BytecraPOS-Setup-*.exe` on each till  
2. Wizard: **This is a CLIENT PC** → Server IP = `192.168.1.100` → **Test connection**  
3. Or edit `%APPDATA%\BytecraPOS\appConfig.json`:

```json
{
  "mode": "client",
  "serverIp": "192.168.1.100",
  "serverPort": 443,
  "serverUseHttps": true,
  "pcIdentifier": "POS-2"
}
```

The **server till** (same PC as Docker) may use `127.0.0.1` and mode `server`.

USB backup destinations (`drivelist`) do **not** see Windows USB sticks from inside Linux containers. Use **local** backups on the volume and/or copy archives off the server. NAS copies need a mount inside the container (`/mnt/nas`) if you use that destination.

---

## Backup

Application backups (Settings → Backup) write under `/app/backups` (Docker volume `api_backups`). They use `pg_dump -Fc` (PostgreSQL 16 client in the API image) plus uploads zip. `MAHALI_BACKUP_SECRET` encrypts stored NAS credentials.

### Optional extra: dump from the Postgres container (host folder `docker/postgres/backups`)

```powershell
docker compose exec postgres sh -c "pg_dump -U `"$POSTGRES_USER`" -d `"$POSTGRES_DB`" -Fc -f /backups/manual-$(date +%Y%m%d).dump"
```

On Windows PowerShell, a simpler form:

```powershell
docker compose exec -e PGPASSWORD postgres pg_dump -U mahali -d mahali_light -Fc -f /backups/manual.dump
```

Copy `docker\postgres\backups\manual.dump` off the server (USB, NAS, another disk).

### Verify a backup exists

```powershell
docker compose exec express-api ls -la /app/backups
```

---

## Restore

Restoring **overwrites** live data. Put the shop in a quiet window. The app’s Backup UI restore uses `pg_restore` against `PGHOST=postgres` and enables maintenance mode.

### Restore a `pg_dump -Fc` file from `docker/postgres/backups`

1. Stop the API so it is not writing:

```powershell
docker compose stop express-api
```

2. Restore (this replaces objects in `mahali_light`):

```powershell
docker compose exec postgres pg_restore -U mahali -d mahali_light --clean --if-exists /backups/manual.dump
```

3. Start API and migrate (no-op if already current):

```powershell
docker compose start express-api
docker compose run --rm express-api npm run migrate
```

4. Open a till, log in, check a known invoice and stock figure.

A backup is not production-ready until you have **run this restore once on a test copy** (or a maintenance window) and confirmed login + a sample invoice.

---

## Update (new application version)

```text
1. Backup (app Backup UI and/or pg_dump to docker/postgres/backups)
2. git pull  (or copy new files) — do not delete Docker volumes
3. docker compose build          # both express-api and nextjs
4. docker compose run --rm express-api npm run migrate
5. docker compose up -d
6. docker compose ps   (postgres, express-api, nextjs healthy)
7. Hit http://127.0.0.1:API_PORT/api/health on the server and open https://SERVER_IP for the POS
8. Login + one sale on two PCs (Ctrl+Shift+R on each till if the UI looks stale)
```

---

## Production checklist

```text
[ ] Docker Desktop installed (Linux engine)
[ ] Static LAN IP configured
[ ] .env configured (not committed)
[ ] Strong POSTGRES_PASSWORD
[ ] Strong JWT_SECRET (≥32 chars, not a placeholder)
[ ] Strong MAHALI_BACKUP_SECRET
[ ] PostgreSQL volume exists (`docker volume ls`)
[ ] API container healthy
[ ] PostgreSQL container healthy
[ ] Database migrations completed
[ ] https://SERVER_IP opens with a padlock on every till and phone (docs/HTTPS_SETUP.md)
[ ] PostgreSQL not published (no host :5432)
[ ] Firewall allows 443 and 80 only (not 3000)
[ ] Backup tested
[ ] Restore tested
[ ] POS client connection tested
[ ] Two POS clients tested simultaneously
[ ] Printer tested
[ ] VAT tested
[ ] Stock tested
[ ] Invoice tested
```

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| `POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env` | Add `POSTGRES_PASSWORD` to `.env` |
| API: JWT_SECRET too short / placeholder | Production refuses weak secrets |
| API: connection refused postgres | Wait for `postgres` healthy; do not set `PGHOST=localhost` inside Compose (Compose already overrides) |
| Clients timeout | Firewall must allow 443 and 80; tills must use `https://SERVER_IP` |
| "This connection isn't secure. Open the POS at https://…" | The till used an old `http://SERVER_IP:3000` link; use `https://SERVER_IP` |
| "Your connection isn't private" | That device doesn't trust the shop certificate yet: docs/HTTPS_SETUP.md |
| `down -v` by mistake | Restore from backup; the database volume is gone |

PM2 path: if you are not using Docker, ignore this file and use `docs/SETUP_GUIDE.md` / `docs/SHOP_MULTI_PC.md`.
