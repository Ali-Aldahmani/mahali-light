# A1 Smart Light — Docker on the Windows server PC

This is the **production** path for the API and PostgreSQL. Electron stays a native Windows app on every till. PM2 (`ecosystem.config.js`) is unchanged and is for operators who do **not** use Docker.

```text
Windows 11 Pro (server PC, static LAN IP e.g. 192.168.1.100)
  Docker Desktop
    ├── api          (Node 22, `node server/index.js`, port 3000 in the container)
    └── postgres     (postgres:16-bookworm, not published to the LAN)
POS-1 / POS-2 / POS-3  ──LAN──►  https://192.168.1.100:3000  (or http:// if TLS is off)
```

---

## Requirements

- Windows 11 Pro
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the **Linux engine**
- Server PC on the shop LAN with a **static IPv4** (router reservation or manual IP)
- This repository on the server (Git clone or ZIP), e.g. `C:\A1SmartLight`

Do not run Docker on a till-only PC. Do not containerize Electron.

---

## Architecture notes (from this repo)

| Item | Value |
|------|--------|
| Node | 22 (same as CI) |
| Start command | `node server/index.js` (`npm run server`) |
| API listen port | `PORT` (Compose forces **3000** inside the container) |
| LAN publish | `API_PORT` on the Windows host (default 3000) |
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
| `API_PORT` | Host port tills use (usually `3000`) |
| `SERVER_IP` | This PC’s LAN IP, e.g. `192.168.1.100` |
| `SERVER_USE_HTTPS` | `true` recommended for multi-PC LAN |

Generate secrets:

```powershell
node -e "require('crypto').randomBytes(48,(e,b)=>console.log(b.toString('hex')))"
node -e "require('crypto').randomBytes(32,(e,b)=>console.log(b.toString('hex')))"
```

Leave `PGHOST=localhost` in `.env` if you still use PM2 on another machine. Compose **overrides** `PGHOST=postgres` for the API container only.

`.env` is gitignored. Never copy it into the image.

### 2. Firewall (LAN API only)

Administrator PowerShell (use the same number as `API_PORT`):

```powershell
New-NetFirewallRule -DisplayName "A1 Smart Light API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Do **not** open 5432.

### 3. Build and start

```powershell
cd C:\A1SmartLight
docker compose build
docker compose up -d
```

### 4. Database migration

Preferred explicit run (same command as the project):

```powershell
docker compose run --rm api npm run migrate
```

Safe to re-run: already-applied files are skipped.

The API process **also** migrates during `node server/index.js` startup. If `docker compose up -d` already started a healthy API, schema is applied. Use the explicit command after upgrades.

Do **not** `npm run seed` on a live shop. Production seed skips the default `admin`/`admin123` user. Create the admin in the Electron setup wizard on the server till.

### 5. Verify

```powershell
docker compose ps
docker compose logs api --tail 80
docker compose logs postgres --tail 40
```

Both services should be **healthy**. From the server PC:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health" -UseBasicParsing
# If SERVER_USE_HTTPS=true:
Invoke-WebRequest -Uri "https://127.0.0.1:3000/api/health" -UseBasicParsing -SkipCertificateCheck
```

From another till, use the LAN IP, not `localhost`.

---

## Day-to-day commands

```powershell
docker compose build              # rebuild API image
docker compose up -d              # start
docker compose ps                 # status
docker compose logs -f api        # API logs
docker compose logs -f postgres   # database logs
docker compose restart            # restart both
docker compose restart api        # API only
docker compose down               # stop; KEEPS volumes (database + uploads + backups + tls)
```

**Never** use `docker compose down -v` in normal operations. `-v` deletes `postgres_data` and the API volumes.

---

## HTTPS (Node, not Docker)

TLS is handled **inside** the API container (`server/utils/tlsCert.js`):

1. `SERVER_USE_HTTPS=true` and `SERVER_IP=<LAN IP>` in `.env`
2. On first start, OpenSSL in the image writes `cert.pem` / `key.pem` into the `api_tls` volume (`/data/tls`)
3. That certificate is **self-signed**. Windows POS clients must set `"serverUseHttps": true` in `%APPDATA%\A1 Smart Light\appConfig.json`. Electron already allows this cert **only** for the configured server IP.

Trust implication: tills trust that IP’s self-signed cert via the app, not via Windows Certificate Store. Replace with company PEMs if required:

```env
TLS_CERT_FILE=/data/tls/cert.pem
TLS_KEY_FILE=/data/tls/key.pem
```

Mount your files into `api_tls` or add a bind mount. Docker does not sit in front as a reverse proxy.

---

## Electron clients

Do not use `localhost` on a client till.

1. Install `A1SmartLight-Setup-*.exe` on each till  
2. Wizard: **This is a CLIENT PC** → Server IP = `192.168.1.100` → **Test connection**  
3. Or edit `%APPDATA%\A1 Smart Light\appConfig.json`:

```json
{
  "mode": "client",
  "serverIp": "192.168.1.100",
  "serverPort": 3000,
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
docker compose exec api ls -la /app/backups
```

---

## Restore

Restoring **overwrites** live data. Put the shop in a quiet window. The app’s Backup UI restore uses `pg_restore` against `PGHOST=postgres` and enables maintenance mode.

### Restore a `pg_dump -Fc` file from `docker/postgres/backups`

1. Stop the API so it is not writing:

```powershell
docker compose stop api
```

2. Restore (this replaces objects in `mahali_light`):

```powershell
docker compose exec postgres pg_restore -U mahali -d mahali_light --clean --if-exists /backups/manual.dump
```

3. Start API and migrate (no-op if already current):

```powershell
docker compose start api
docker compose run --rm api npm run migrate
```

4. Open a till, log in, check a known invoice and stock figure.

A backup is not production-ready until you have **run this restore once on a test copy** (or a maintenance window) and confirmed login + a sample invoice.

---

## Update (new application version)

```text
1. Backup (app Backup UI and/or pg_dump to docker/postgres/backups)
2. git pull  (or copy new files) — do not delete Docker volumes
3. docker compose build
4. docker compose run --rm api npm run migrate
5. docker compose up -d
6. docker compose ps   (both healthy)
7. Hit /api/health from a till
8. Login + one sale on two PCs
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
[ ] API reachable from LAN (not only localhost)
[ ] PostgreSQL not published (no host :5432)
[ ] Firewall allows API_PORT only
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
| Healthcheck failing with HTTPS | Confirm API logs show TLS enabled; healthcheck accepts self-signed |
| Clients timeout | Firewall, wrong `API_PORT`, `SERVER_USE_HTTPS` vs client `serverUseHttps` |
| `down -v` by mistake | Restore from backup; the database volume is gone |

PM2 path: if you are not using Docker, ignore this file and use `docs/SETUP_GUIDE.md` / `docs/SHOP_MULTI_PC.md`.
