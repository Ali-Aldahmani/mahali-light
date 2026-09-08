# Bytecra POS

Point of sale for an electrical shop (UAE). One **server PC** runs everything
in Docker; every **till/cashier PC** is just a browser pointed at the server
over the shop's LAN. Several tills share one PostgreSQL database.

## 1. Project overview

- **Next.js (App Router, TypeScript)** — the real, native browser POS frontend
  (cashiers open a URL). It is a standalone application under `web/` with its
  own routes, components, stores, and services, and does not use
  `react-router-dom`. See `docs/web-migration/` for the migration record.
- **Express** — permanent core API (JWT, RBAC, invoices, inventory, finance).
- **PostgreSQL 16** — permanent database.
- **Socket.io** — realtime events (stock, force-logout, notifications), hosted on Express.
- **Hardware Agent** (optional, per till) — silent thermal print / local printers. Not required for ordinary use.
- **FastAPI** (optional) — future ML/AI only. **Not** part of normal POS startup and **not** a replacement for Express.

The old React/Vite SPA and the Electron desktop shell that used to wrap it
have been removed from this repo (see
`docs/web-migration/VITE_ARCHIVE_STATUS.md`) — `web/` fully replaces them.
Normal tills do **not** install Node, Python, or PostgreSQL — only a browser.

## 2. Architecture

```text
LAN browsers (tills)  →  Next.js (:80)  →  Express API (:3000)  →  PostgreSQL
                               │                    │
                               │                    └── Socket.io (browsers also connect to :3000)
                               │
                      optional Hardware Agent on a till (127.0.0.1 only)

optional: docker compose --profile ml  →  FastAPI (future ML)
```

Everything above the "LAN browsers" line runs in Docker **on one machine**
(the server PC). Nothing below it is installed on tills.

---

## PART A — Set up the server PC

This is the machine that stays on and runs the shop. Do this once.

### A.1 What the server PC needs

- Windows 10/11, macOS, or Linux, with **at least 4 GB RAM** free and a wired
  Ethernet connection recommended (Wi‑Fi works, but a wired server is more
  reliable for a till system).
- **Docker** (Docker Desktop on Windows/macOS, Docker Engine + the Compose
  plugin on Linux). This is the only software prerequisite — you do **not**
  need to install Node.js, Python, or PostgreSQL yourself; Docker provides all
  of that inside containers.
- A **reserved/static LAN IP** for this PC (see A.5).
- The project files, either via `git clone` or by copying the folder.

### A.2 Install Docker on the server PC

Pick your OS:

**Windows 10/11**
1. Download Docker Desktop: <https://www.docker.com/products/docker-desktop/>
2. Run the installer. If prompted, enable **WSL 2** (the installer offers to
   do this for you — accept it).
3. Reboot if asked.
4. Launch Docker Desktop and wait for the whale icon in the system tray to
   say "Docker Desktop is running".
5. Open PowerShell and confirm:
   ```powershell
   docker --version
   docker compose version
   ```
   Both must print a version number.

**macOS**
1. Download Docker Desktop: <https://www.docker.com/products/docker-desktop/>
2. Drag it into `Applications`, then launch it.
3. Open Terminal and confirm:
   ```bash
   docker --version
   docker compose version
   ```

**Linux (Ubuntu/Debian example)**
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in, then:
docker --version
docker compose version
```

If either `docker --version` or `docker compose version` fails, stop here and
fix Docker first — nothing else in this guide will work without it.

### A.3 Get the project onto the server PC

Choose **one**:

```bash
# Option 1 — clone with git
git clone <your-repo-url> BytecraPOS
cd BytecraPOS
```

```bash
# Option 2 — you already have the folder (e.g. copied via USB/network share)
cd /path/to/BytecraPOS
```

Recommended locations: `C:\BytecraPOS` on Windows, `/opt/bytecra-pos` on
Linux/macOS.

### A.4 Configure the environment file

```bash
cp .env.example .env
```

On Windows PowerShell: `Copy-Item .env.example .env`

Open `.env` in a text editor and set at least these values:

| Variable | Meaning | Example |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Strong database password (pick your own) | `Sup3rSecret!` |
| `POSTGRES_USER` / `POSTGRES_DB` | Database role and name (defaults are fine) | `mahali` / `mahali_light` |
| `JWT_SECRET` | Random 48+ byte hex string — **generate one, don't type your own words** | see command below |
| `MAHALI_BACKUP_SECRET` | Random 32+ byte hex string for NAS backup credential encryption | see command below |
| `SERVER_IP` | This PC's LAN IP (find it in A.5) | `192.168.1.50` |
| `WEB_PORT` | Port the POS website listens on. `80` is normal; use `8080` if `80` is taken | `80` |
| `API_PORT` | Port the API + Socket.io listens on; must be open on the firewall | `3000` |
| `SERVER_USE_HTTPS` | Leave `false` for plain HTTP over Docker unless you've added TLS certs | `false` |

Generate the two secrets (run on any machine with Node.js — your laptop is
fine, you're just generating random text):

```bash
node -e "require('crypto').randomBytes(48,(e,b)=>console.log(b.toString('hex')))"   # → JWT_SECRET
node -e "require('crypto').randomBytes(32,(e,b)=>console.log(b.toString('hex')))"   # → MAHALI_BACKUP_SECRET
```

Paste each output into the matching line in `.env`.

### A.5 Find this PC's LAN IP (needed for `SERVER_IP` above)

- **Windows**: open PowerShell, run `ipconfig`, look for "IPv4 Address" under
  your active Ethernet or Wi‑Fi adapter.
- **macOS/Linux**: run `ifconfig` or `ip addr`, look for the address on your
  active network interface (usually starts with `192.168.` or `10.`).

Then, on your router's admin page, **reserve that IP** for this PC's MAC
address (a "DHCP reservation" or "static lease") so it never changes. Make
sure this PC and every till are on the **same** Wi‑Fi/VLAN.

### A.6 Make the POS come back up automatically after a restart or power cut

Every service in `docker-compose.yml` is already set to `restart: unless-stopped`,
so once the Docker daemon is running, Docker itself keeps the containers
alive — it restarts a service if it crashes, and it restarts every service
after the Docker daemon restarts. The only thing left to configure is making
sure **Docker itself starts automatically** when the server PC reboots
(after a power cut, Windows update, etc.), with no one needing to log in and
double-click anything.

**Windows / macOS (Docker Desktop)**
1. Open Docker Desktop → **Settings → General** and enable **"Start Docker
   Desktop when you log in."**
2. Docker Desktop only runs inside a logged-in user session, so also set this
   PC to **log in automatically** after a reboot:
   - **Windows**: press ⊞ Win+R, run `netplwiz`, untick "Users must enter a
     user name and password to use this computer," select the account this
     server runs under, and confirm.
   - **macOS**: **System Settings → Users & Groups → Login Options** → set
     **Automatic login** to this account.
3. Reboot the PC once to confirm: it should boot straight to the desktop,
   Docker Desktop should launch on its own, and a minute or two later
   `docker compose ps` (from the project folder) should show every service
   **healthy** again with no commands run by hand.

**Linux (Docker Engine)** — no login required at all, which makes Linux the
most reliable choice for a machine that's meant to run unattended:
```bash
sudo systemctl enable docker
```
This starts the Docker daemon at boot before any user logs in, and your
containers (already `restart: unless-stopped`) come up with it.

**Important caveat:** `unless-stopped` means "always restart, unless a human
explicitly stopped it." If you ever run `docker compose down` (which removes
the containers) and then the PC restarts, there is nothing left to restart —
you'd need to run `docker compose up -d` again yourself. For a live server,
prefer leaving the stack running and only use `docker compose down` for real
maintenance; a normal reboot, power cut, or crash does **not** count as
stopping it and will always come back on its own once Docker starts.

---

## PART B — The Docker setup (what's actually running)

This project ships two Dockerfiles and one Compose file that wires them
together. You don't need to edit these files for normal use — this section
just explains what they do, so `docker compose up` isn't a black box.

### B.1 `Dockerfile` (repo root) — the Express API image

Multi-stage build: installs production Node dependencies (including native
modules like `bcrypt` and `sharp`), then a runtime stage with Chromium
(for PDF generation) and the PostgreSQL 16 client tools (for backups). Runs
`server/index.js`. Exposes port `3000` inside the container.

### B.2 `web/Dockerfile` — the Next.js frontend image

Multi-stage build: installs `web/`'s own dependencies, runs `next build`
(with full TypeScript checking — the build fails if there are type errors),
then copies only the resulting standalone server into a slim runtime image.
It does **not** touch `src/` (the old Vite app) at all — this image is built
entirely from `web/`. Exposes port `3000` inside the container.

### B.3 `docker-compose.yml` — how the pieces fit together

| Service | Image built from | Published port (`.env` var) | Purpose |
| --- | --- | --- | --- |
| `postgres` | official `postgres:16-bookworm` | *(not published — LAN can't reach it)* | The database. Data persists in the `postgres_data` volume. |
| `express-api` | `Dockerfile` | `${API_PORT:-3000}` | The core API + Socket.io. Waits for `postgres` to be healthy before starting. |
| `nextjs` | `web/Dockerfile` | `${WEB_PORT:-80}` | The POS website. Waits for `express-api` to be healthy, then proxies `/api/*` and `/files/*` to it internally. |
| `fastapi` | `backend-fastapi/Dockerfile` | `${FASTAPI_PORT:-8000}` | **Optional**, only starts with `--profile ml`. Future ML only — exposes `GET /health` today. |

Note that `postgres` has **no `ports:` published to the host** — only
containers on the internal `bytecrapos` Docker network can reach it. This is
intentional: the database is never exposed to the LAN.

### B.4 Build and start the containers

From the project root on the server PC:

```bash
docker compose build
docker compose up -d
docker compose ps
```

Wait a minute, then check `docker compose ps` again — `postgres`,
`express-api`, and `nextjs` should all show **healthy**. `fastapi` must
**not** appear at all (it's opt-in only).

If a service shows `unhealthy` or keeps restarting, see the Troubleshooting
table in Part D before continuing.

### B.5 Apply the database schema

Safe to run every time (it only applies new migrations):

```bash
docker compose run --rm express-api npm run migrate
```

### B.6 Open the firewall

The server PC's firewall must allow incoming connections on:
- **`WEB_PORT`** (default `80`) — so tills can load the website.
- **`API_PORT`** (default `3000`) — so the browser can talk to the API and
  Socket.io.

Do **not** open port `5432` (PostgreSQL) — it isn't published anyway.

Windows example (PowerShell, run as Administrator):
```powershell
New-NetFirewallRule -DisplayName "Bytecra POS Web" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Bytecra POS API" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### B.7 First login

On the server PC (or any till), open a browser to:

```
http://SERVER_IP
```

(e.g. `http://192.168.1.50`, or `http://192.168.1.50:8080` if you set
`WEB_PORT=8080`).

You'll land on the **setup wizard** — production does **not** ship a default
`admin`/`admin123` account. Follow the 8 steps (store profile, VAT, network
mode, admin account, cash drawer, bank account) to finish setup, then log in.

Follow live logs any time with:
```bash
docker compose logs -f
```

**Server setup is done.** The server PC should now be left running.

---

## PART C — Set up each Client (till) PC

Client PCs are the cash-register computers cashiers actually use. They need
**no installation at all** unless they also need silent thermal printing.

### C.1 Plain client (browser only — most tills)

1. Connect the till to the same LAN/Wi‑Fi as the server PC.
2. Open Chrome or Edge (a current version).
3. Go to `http://SERVER_IP` (the address from Part A/B — ask whoever set up
   the server, or check the router's DHCP reservation list).
4. Log in with the account created during setup.
5. Use the POS.

That's it — no repository, no Docker, no database, no Node.js on this
machine. Bookmark the URL for convenience. Ordinary PDF printing (invoices,
receipts) works through the browser's own print dialog — no extra software
needed.

### C.2 Client with a thermal printer (Hardware Agent)

Only needed on tills that must print **silently** to a local thermal/receipt
printer without the browser's print dialog popping up.

1. Get the project files onto this till (same as A.3), or just the
   `hardware-agent/` folder.
2. Install Node.js on this till (only this till, only for this purpose).
3. Start the agent:
   ```bash
   cd hardware-agent
   npm start
   ```
4. The first run creates a pairing token file:
   - Windows: `%USERPROFILE%\.bytecra-hardware-agent\pairing-token`
   - macOS/Linux: `~/.bytecra-hardware-agent/pairing-token`
5. Open the token file, copy its contents.
6. In the POS (this till's browser session), go to **Settings → Printers**
   and paste the token in.

The agent listens on `127.0.0.1:17473` only — it is never reachable from
other machines on the LAN. See `docs/web-migration/HARDWARE_AGENT_SECURITY.md`
for the full security model.

---

## PART D — Operations

### D.1 Everyday Docker commands (run on the server PC, from the project root)

```bash
docker compose ps                              # status of all services
docker compose logs -f                         # follow all logs
docker compose logs -f express-api nextjs postgres   # follow specific services
docker compose up -d                           # start (or apply changes after a build)
docker compose down                            # stop everything (data is kept)
docker compose build                           # rebuild images after pulling new code
```

Optional ML sidecar: `docker compose --profile ml up -d`

### D.2 Updating to a new version

1. **Back up the database first** (D.4).
2. Pull/copy the new code into the project folder.
3. ```bash
   docker compose build
   docker compose up -d
   docker compose run --rm express-api npm run migrate
   docker compose ps
   ```
4. Open the web UI and confirm it loads.

Never delete the `postgres_data` volume as part of an update.

### D.3 PostgreSQL persistence

Data lives in the Docker volume `postgres_data`.

- `docker compose down` stops containers; **data remains**.
- `docker compose down -v` **deletes the database**. Never run this on a live shop.

### D.4 Backup

The app writes scheduled backups (triggered from **Settings → Backup** in
the POS) to the `api_backups` volume (`/app/backups` inside `express-api`).

Manual one-off dump:
```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > shop-$(date +%Y%m%d).dump
```
On Windows, read the user/db values from `.env` and redirect the output to a
file on the server's disk.

### D.5 Restore

Restoring **overwrites live data**. Stop writes, take a fresh backup first,
then restore with `pg_restore` into the `postgres` service (or use the
in-app restore for app-format backup jobs). The system never restores
automatically on container start.

### D.6 Health checks

```bash
docker compose ps
curl -sS http://127.0.0.1/                 # Next.js (or :WEB_PORT)
curl -sS http://127.0.0.1:3000/api/health  # Express
# optional ML sidecar
curl -sS http://127.0.0.1:8000/health
```

Express health JSON includes `data.status: ok`. Postgres health is Compose's
built-in `pg_isready` check.

### D.7 Troubleshooting

| Symptom | What to run / check |
| --- | --- |
| Browser can't open the server | Ping `SERVER_IP`; check `WEB_PORT`; firewall rules from B.6 |
| Wrong/changed IP | Re-check with `ipconfig`/`ip addr`; update `SERVER_IP` in `.env`, then `docker compose up -d` to recreate `express-api` |
| Port already in use | Change `WEB_PORT` / `API_PORT` in `.env`, then `docker compose up -d` |
| Postgres unhealthy | `docker compose logs postgres` |
| API restarting in a loop | `docker compose logs express-api` — usually `JWT_SECRET`, DB password, or a failed migration |
| UI loads but API calls fail with CORS errors | `SERVER_IP` in `.env` must match the host used in the browser's address bar |
| Socket.io shows disconnected | Firewall must allow `API_PORT` (3000); confirm `NEXT_PUBLIC_EXPRESS_PORT` matches `API_PORT` |
| Login fails | Confirm the setup wizard was completed; check caps lock; look for a "session expired" modal |
| Printing doesn't work | Browser PDF print vs. Hardware Agent — check agent logs and `lpstat -p` on that till |
| Everything crash-looping | `docker compose logs --tail 100`; fix the cause in `.env`; do **not** use `-v` |

### D.8 Hardware Agent (reference)

Needed only for **local silent** printing on a specific till. Not needed to
view the POS or to print via the browser dialog. Security model: binds to
`127.0.0.1` only, requires a pairing token, only ever prints a specific
invoice/receipt by UUID (no arbitrary shell/printer commands). Full detail in
`docs/web-migration/HARDWARE_AGENT_SECURITY.md`.

### D.9 FastAPI / ML (reference)

Optional and off by default. Start it with `docker compose --profile ml up -d`.
It exposes `GET /health` today and nothing else — Express remains the POS
backend for everything. A normal `docker compose up -d` (no `--profile ml`)
never starts this service.

---

## PART E — Local development (not for the live shop)

For working on the code, on a laptop — not the shop's server PC:

```bash
cp .env.example .env   # use local JWT/Postgres values
npm install
npm run dev:server     # Express, on :3002 by default
cd web && npm install && npm run dev   # Next.js App Router (TypeScript), on :3001
```

`web/` is a self-contained TypeScript Next.js project (its own
`package.json`, `tsconfig.json`, `node_modules`). `npm run build` inside
`web/` runs `next build` with full type-checking (`ignoreBuildErrors:
false`) and produces a standalone server (`.next/standalone/web/server.js`),
which is exactly what `web/Dockerfile` packages for production.

Never run local dev processes as the live shop — the live shop is always
`docker compose up -d` (Part B).

More ops notes: `docker/README.md`. Architecture and migration record:
`docs/web-migration/` (start with `FRONTEND_MIGRATION_INVENTORY.md` and
`NEXTJS_NATIVE_PARITY.md`).
