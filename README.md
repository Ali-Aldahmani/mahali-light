# A1 Smart Light

Point-of-sale for an electrical shop in the UAE. **Several Windows PCs** share one database: one **server PC** runs the API and PostgreSQL; every **till** runs the A1 Smart Light window (Electron).

```text
Till POS-1  ─┐
Till POS-2  ─┼── LAN ──►  Server PC (Docker: API + PostgreSQL)
Till POS-3  ─┘
```

If the **server PC is off**, tills cannot sell. Docker (the database + API) and the server PC's own copy of the app can both be set to start automatically when the PC turns on — see [1.9](#19-optional-make-everything-start-automatically) below.

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
- Other tills: 64-bit Windows 10/11, same Wi-Fi or Ethernet
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on the **server only** (Linux engine)
- This repository on the server (Git clone or ZIP), e.g. `C:\A1SmartLight`

Setup has two parts, done in order: **Part 1** sets up the one server PC (fixed IP, Docker backend, then the app in server mode). **Part 2** installs the app on every other till (no Docker). Finish Part 1 completely — including running migrations and testing a sale on the server — before starting Part 2.

Two layers to keep straight: **Docker** is the invisible database + API — it has no window, nothing to click, and it must run on the server PC no matter what. **The app (`.exe`)** is the window a person actually uses — it's empty and useless without Docker running somewhere to talk to. The server PC needs Docker always; it only needs the app *too* if someone will also sell from that same PC.

---

## Part 1 — Server PC setup

Everything in this part runs **on the server PC**.

### 1.1 Give the server PC a fixed IP address

Every till needs to reach the server at the same network address every time — if that address changes (which normal Wi-Fi/DHCP addresses can, e.g. after a router reboot), every till breaks until you fix it. Pick **one** of these:

**Option A — router reservation (recommended, safer)**. This locks the address in on the router, so nothing on the PC itself can misconfigure it.

1. On the server PC, open PowerShell and run:
   ```powershell
   ipconfig /all
   ```
   Note the **IPv4 Address** and **Physical Address** (MAC, looks like `AA-BB-CC-11-22-33`) of your active adapter.
2. Log into your router (usually `http://192.168.1.1` or `http://192.168.0.1` in a browser — login is often printed on the router itself).
3. Find **"DHCP Reservation"**, **"Address Reservation"**, or **"Static Lease"** (wording varies by brand). Enter the server's MAC address and the IP it should always get — its current IP is usually fine, you're just locking it in.
4. Save. The server PC now keeps that address permanently, even after restarts.

**Option B — set it manually on Windows** (if you don't have router access):

1. **Settings → Network & Internet →** your connection **→ Properties**.
2. Under **IP assignment**, click **Edit → Manual**, turn on **IPv4**.
3. Fill in: **IP address** (e.g. `192.168.1.100` — pick something outside your router's normal DHCP range so nothing else grabs it later), **Subnet mask** `255.255.255.0`, **Gateway** = your router's IP (e.g. `192.168.1.1`), **Preferred DNS** `8.8.8.8`.
4. Save.

   ⚠️ If you pick an IP another device is already using, you'll get a conflict and lose network access — Option A avoids this risk entirely.

**Write this IP address down** — you'll enter it in step 1.4 below and on every till in Part 2.

### 1.2 Install Docker Desktop

Download from [docker.com](https://www.docker.com/products/docker-desktop/) and install — **server PC only**, with the Linux engine (the default).

### 1.3 Get the project files onto the server

Git clone or copy this repository, e.g. into `C:\A1SmartLight`.

### 1.4 Configure environment

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least (do not leave `CHANGE_ME` / `REPLACE_ME`):

- `JWT_SECRET` and `MAHALI_BACKUP_SECRET` (generate with the commands shown inside `.env.example`)
- `POSTGRES_PASSWORD` (strong), `POSTGRES_USER`, `POSTGRES_DB`
- `API_PORT=3000`
- `SERVER_IP=` the fixed IP address from step 1.1
- `SERVER_USE_HTTPS=true` for more than one till

### 1.5 Open the firewall (API only — not the database)

```powershell
New-NetFirewallRule -DisplayName "A1 Smart Light API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Do **not** open port 5432 — PostgreSQL is never published to the LAN; only the API port needs to be reachable.

### 1.6 Build and start the backend (Docker)

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Both `api` and `postgres` should show **healthy**. If not, check `docker compose logs api`.

### 1.7 Apply the database schema

```powershell
docker compose run --rm api npm run migrate
```

Safe to run more than once — already-applied changes are skipped. Full command reference (backup, restore, update, HTTPS): **[docker/README.md](docker/README.md)**.
**Never** run `docker compose down -v` — that deletes the database volume (all your data).

Do **not** `npm run seed` on a live shop. Production does not create `admin` / `admin123`. You create the real admin account in the app's setup wizard (next step).

### 1.8 Install the app on the server PC

Only needed if someone will also sell from this same PC (see the note at the top of Part 1) — otherwise Docker alone is enough to serve every other till.

Build the Windows installer (on the server, or any Windows machine with this repo, then copy the `.exe` over):

```powershell
npm install
npm run build
npm run build:electron
```

Installer: `release\A1SmartLight-Setup-*.exe`

Install it **on the server**, open **A1 Smart Light**, choose **This is the SERVER PC**, create a **strong admin** password, finish the wizard, sign in. It connects to `127.0.0.1` (itself) automatically — no IP to type in here.

### 1.9 (Optional) Make everything start automatically

So that if the PC restarts (update, power cut, etc.), the shop comes back online without anyone touching a keyboard.

**Docker Desktop → starts on login** (containers come back on their own after this, since `docker-compose.yml` already sets `restart: unless-stopped` on both services):

1. Open Docker Desktop → gear icon (**Settings**) → **General**.
2. Enable **"Start Docker Desktop when you sign in to your computer."**
3. Save.

**Windows → logs in automatically** (Docker Desktop only starts *after* a Windows sign-in, so without this, the PC sits at the login screen after a power loss until someone logs in by hand):

1. Press `Win + R`, type `netplwiz`, Enter.
2. Uncheck **"Users must enter a password to use this computer."**
3. Click **Apply**, confirm that account's password once.

   ⚠️ **Security tradeoff**: this means anyone who can physically power on the PC gets in with no login screen at all. Fine for a server in a back office; skip this if the PC is anywhere publicly accessible.

**The app → opens itself too** (optional, only relevant if you installed it in step 1.8):

1. Press `Win + R`, type `shell:startup`, Enter.
2. Drop a shortcut to `A1 Smart Light.exe` into that folder.

With all three: PC turns on → Windows logs in by itself → Docker starts → containers come back up → the app opens, ready for someone to sign in.

### 1.10 Test it

Do one sale right there on the server PC (if you installed the app in step 1.8) or from a till once Part 2 is done, to confirm Docker and the app are talking to each other correctly before relying on it live.

---

## Part 2 — Client PC setup (every till)

No Docker on tills — repeat these steps on **each** other PC.

1. Copy the **same** `.exe` built in step 1.8 and install it.
2. Open A1 Smart Light → **This is a CLIENT PC**.
3. Server IP = the fixed address from step 1.1 (never `localhost`).
4. Click **Test connection** — it must succeed before continuing.
5. Give it a unique PC name (`POS-2`, `POS-3`, …).
6. Sign in with a user created on the server.

If HTTPS is on (`SERVER_USE_HTTPS=true`), `%APPDATA%\A1 Smart Light\appConfig.json` on that till must have `"serverUseHttps": true` and the same `serverPort` as `API_PORT`.

---

## Before live sales

On **server + at least two tills**, check: login, one sale, stock updating on the other screen, print, backup. Full list: [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md).

---

## Daily use

- Leave the **server PC** on. If you set up step 1.9, it recovers on its own after a restart.
- Staff only open **A1 Smart Light** on each till.
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
