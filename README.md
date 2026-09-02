# Bytecra POS

Point-of-sale for an electrical shop in the UAE. **Several Windows PCs** share one database: one **server PC** runs the API and PostgreSQL; every **till** runs the Bytecra POS window (Electron).

```text
Till POS-1  ─┐
Till POS-2  ─┼── LAN ──►  Server PC (Docker: API + PostgreSQL)
Till POS-3  ─┘
```

If the **server PC is off**, tills cannot sell.

---

## Which instructions should I follow?

| I am… | Do this |
|--------|---------|
| Setting up the **shop** (Windows server + tills) | Start at **[Shop setup](#shop-setup-do-this-in-order)** below. Details: [docker/README.md](docker/README.md) |
| Installing extra **tills only** | Jump to **[Part 2 — Client PC setup](#part-2--client-pc-setup-every-till)** |
| Developing on a **Mac / laptop** | Jump to **[Developers](#developers-mac--laptop)** |

Do **not** run the live shop with `npm run dev`. That is for development only.

---

## Shop setup (do this in order)

### What you need

- One Windows 11 Pro **server PC** that stays on during opening hours
- A **static LAN IP** on that PC (write it down, e.g. `192.168.1.100`)
- Other tills: 64-bit Windows 10/11, same Wi-Fi or Ethernet
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on the **server only** (Linux engine)
- This repository on the server (Git clone or ZIP), e.g. `C:\BytecraPOS`

Setup has two parts, done in order: **Part 1** sets up the one server PC (Docker backend, then the POS app in server mode). **Part 2** installs the POS app on every other till (no Docker). Finish Part 1 completely — including running migrations and testing a sale on the server — before starting Part 2.

---

## Part 1 — Server PC setup

Everything in this part runs **on the server PC**, from the project folder (e.g. `C:\BytecraPOS`).

### 1.1 Configure environment

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least (do not leave `CHANGE_ME` / `REPLACE_ME`):

- `JWT_SECRET` and `MAHALI_BACKUP_SECRET` (generate with the commands in `.env.example`)
- `POSTGRES_PASSWORD` (strong), `POSTGRES_USER`, `POSTGRES_DB`
- `API_PORT=3000`
- `SERVER_IP=` this PC's LAN IP (e.g. `192.168.1.100`)
- `SERVER_USE_HTTPS=true` for more than one till

### 1.2 Open the firewall (API only — not the database)

```powershell
New-NetFirewallRule -DisplayName "Bytecra POS API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Do **not** open port 5432 — PostgreSQL is never published to the LAN.

### 1.3 Build and start the backend (Docker)

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Both `api` and `postgres` should show **healthy**. If not, check `docker compose logs api`.

### 1.4 Apply the database schema

```powershell
docker compose run --rm api npm run migrate
```

Safe to run more than once. Full command reference (backup, restore, update, HTTPS): **[docker/README.md](docker/README.md)**.
**Never** run `docker compose down -v` — that deletes the database volume.

Do **not** `npm run seed` on a live shop. Production does not create `admin` / `admin123`. You create the admin in the POS wizard (next step).

### 1.5 Install the POS app on the server itself

Build the Windows installer (on the server, or any Windows machine with this repo, then copy the `.exe` over):

```powershell
npm install
npm run build
npm run build:electron
```

Installer: `release\BytecraPOS-Setup-*.exe`

Install it **on the server**, open **Bytecra POS**, choose **This is the SERVER PC**, create a **strong admin** password, finish the wizard, sign in.

At this point the server PC works on its own — Docker backend plus the POS app talking to `127.0.0.1`. Do a test sale here before moving on to Part 2.

---

## Part 2 — Client PC setup (every till)

No Docker on tills — repeat these steps on **each** other PC.

1. Copy the **same** `.exe` built in step 1.5 and install it.
2. Open Bytecra POS → **This is a CLIENT PC**.
3. Server IP = the address from step 1.1 (not `localhost`).
4. Click **Test connection** — it must succeed before continuing.
5. Give it a unique PC name (`POS-2`, `POS-3`, …).
6. Sign in with a user created on the server.

If HTTPS is on (`SERVER_USE_HTTPS=true`), `%APPDATA%\BytecraPOS\appConfig.json` on that till must have `"serverUseHttps": true` and the same `serverPort` as `API_PORT`.

---

## Before live sales

On **server + at least two tills**, check: login, one sale, stock updating on the other screen, print, backup. Full list: [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md).

---

## Daily use

- Leave the **server PC** on.
- Staff only open **Bytecra POS** on each till.
- If something is down: on the server run `docker compose ps` and `docker compose logs api`.

| Task | Command (server, project folder) |
|------|----------------------------------|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f api` |
| Restart | `docker compose restart` |
| Stop (keep data) | `docker compose down` |

---

## Developers (Mac / laptop)

```bash
cp .env.example .env   # set JWT_SECRET; local Postgres on PGHOST=localhost
npm install
npm run migrate
npm run dev            # Vite + API + Electron
```

If port 3000 is already used, set `PORT` in `.env` (this machine often uses 3000 for other apps). Local notes: [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md).

Dev seed may create `admin` / `admin123`. Production seed does **not**.

---

## Other docs

| Doc | When |
|-----|------|
| [docker/README.md](docker/README.md) | Shop server: Docker, env, backup, restore, HTTPS, checklist |
| [docs/SHOP_MULTI_PC.md](docs/SHOP_MULTI_PC.md) | Same shop layout **without** Docker (PM2 + Postgres on Windows) |
| [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) | Long Windows install reference |
| [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) | Go-live tests |
| [docs/RELEASE.md](docs/RELEASE.md) | Building the installer / GitHub release |

PM2 (`npm run pm2:start`) is only if you are **not** using Docker.

---

## Stack (short)

Electron on each till · Express + Socket.io API · PostgreSQL 16 · JWT. Tills never connect to Postgres; they only call the API on the server LAN IP.
