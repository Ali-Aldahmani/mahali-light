# Shop rollout — multiple Windows PCs

**Preferred on the server PC:** Docker (API + PostgreSQL). Follow **[docker/README.md](../docker/README.md)**. Electron on every till stays a normal Windows install.

PM2 + host PostgreSQL remains supported; this document still describes that path.

Use this when the store has **several Windows tills**. One PC is the **server**. Every other PC is a **client**. Do not run the shop from a Mac.

Work **in order**. Do not skip a step.

---

## What you will have at the end

| PC | Software | Role |
|----|----------|------|
| **Server PC** (counter 1 / office) | PostgreSQL + API (PM2) + Bytecra POS | Database and API. Can also sell. |
| **Client PC 2, 3, …** | Bytecra POS only | Talks to the server over the LAN |

All tills share stock, invoices, and users. If the **server PC is off**, clients cannot sell.

Pick a folder on the server and stick to it, for example:

```text
C:\BytecraPOS\
```

---

## Before you start

- Every till is **64-bit Windows 10/11**.
- Server and clients are on the **same LAN** (same router / same Wi‑Fi SSID).
- You know which machine will stay on during shop hours (that is the **server PC**).
- Give the server a **fixed IPv4 address** (router DHCP reservation, or a static IP). Write it down, e.g. `192.168.1.50`.

---

# Part A — Server PC (do this first)

## Step 1 — Install Node.js

1. Download **LTS** from https://nodejs.org  
2. Install with **Add to PATH** checked.  
3. Open a **new** PowerShell:

```powershell
node -v
npm -v
```

## Step 2 — Install Git

1. https://git-scm.com/download/win  
2. Default options. Git also provides `openssl` for HTTPS.

```powershell
git --version
openssl version
```

If `openssl` is missing, add `C:\Program Files\Git\usr\bin` to the system PATH.

## Step 3 — Install PostgreSQL 16

1. https://www.postgresql.org/download/windows/  
2. Set a **strong password** for user `postgres`. Keep port **5432**.  
3. Uncheck Stack Builder at the end.

PostgreSQL installs as a Windows service and starts on boot.

## Step 4 — Install PM2 (Administrator PowerShell)

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
pm2 -v
```

## Step 5 — Copy the project onto the server

```powershell
cd C:\
git clone <your-repo-url> BytecraPOS
cd C:\BytecraPOS
npm install
```

Or extract a ZIP to `C:\BytecraPOS` and run `npm install` there.

## Step 6 — Create `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Set **all** of the following (do not leave `REPLACE_ME` values):

```env
PORT=3000
NODE_ENV=production

JWT_SECRET=          # generate below
JWT_EXPIRES_IN=8h
MAHALI_BACKUP_SECRET=  # generate below

PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=          # the password from Step 3
PGDATABASE=mahali_light
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/mahali_light

CORS_ORIGINS=

SERVER_USE_HTTPS=true
SERVER_IP=192.168.1.50
MAHALI_SERVER_IP=192.168.1.50
VITE_SERVER_IP=192.168.1.50
VITE_SERVER_PORT=3000
```

Replace `192.168.1.50` with this PC’s LAN IP:

```powershell
ipconfig
```

Use **IPv4 Address** on Ethernet (prefer cable for the server).

Generate secrets:

```powershell
node -e "require('crypto').randomBytes(48,(e,b)=>console.log(b.toString('hex')))"
node -e "require('crypto').randomBytes(32,(e,b)=>console.log(b.toString('hex')))"
```

First line → `JWT_SECRET`. Second → `MAHALI_BACKUP_SECRET`.

Save `.env`.

## Step 7 — Create the database and tables

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE mahali_light;"
cd C:\BytecraPOS
npm run migrate
```

Do **not** run `npm run seed` for a live shop. Production skips the default `admin` / `admin123` user. You will create the admin in the setup wizard.

## Step 8 — Open the firewall

Administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Bytecra POS API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

## Step 9 — Start the API and auto-start on boot

```powershell
cd C:\BytecraPOS
npm run pm2:start
npm run pm2:status
```

Status must be **online**. Then (Administrator):

```powershell
pm2-startup install
pm2 save
```

Reboot once. After login, `pm2 status` should still show **online**.

Health check (HTTPS, self-signed):

```powershell
Invoke-WebRequest -Uri "https://localhost:3000/api/health" -UseBasicParsing -SkipCertificateCheck
```

If this fails, run `npm run pm2:logs` and fix `.env` / PostgreSQL before continuing.

## Step 10 — Build the Windows installer

On the **same server** (or any Windows PC with this repo):

```powershell
cd C:\BytecraPOS
npm run build
npm run build:electron
```

Installer: `C:\BytecraPOS\release\BytecraPOS-Setup-1.0.1.exe` (version may differ).

Copy that `.exe` to a USB stick for the other tills.

## Step 11 — Install Bytecra POS on the server PC

1. Run the installer.  
2. Open **Bytecra POS**.  
3. Setup wizard: **This is the SERVER PC**.  
4. Create the **real admin** (strong password — not `admin123`).  
5. Finish store / VAT / cash drawer. Skip bank if you want.  
6. Sign in with that admin.

The server till should use **loopback** (`127.0.0.1`) to talk to the API. Other PCs use the LAN IP.

---

# Part B — Each client PC

Repeat on **every** extra till. No PostgreSQL. No Node. No PM2.

## Step 12 — Install the same `.exe`

Run `BytecraPOS-Setup-….exe`.

## Step 13 — First-run wizard (client)

1. Open Bytecra POS.  
2. Choose **This is a CLIENT PC**.  
3. **Server IP** = the address from Step 6 (`192.168.1.50`).  
4. **Test connection** — it must succeed before you continue.  
5. Finish the wizard (admin is already on the server).  
6. Sign in with a user created on the server (create cashiers under Users on the server till).

If Test connection fails:

- Server PC is on and `pm2 status` is online.  
- Client IP is on the same subnet.  
- Firewall rule from Step 8 exists.  
- IP in the wizard matches `ipconfig` on the server.  
- If the server uses HTTPS, client `%APPDATA%\BytecraPOS\appConfig.json` must include `"serverUseHttps": true`.

Example `appConfig.json` on a client:

```json
{
  "mode": "client",
  "serverIp": "192.168.1.50",
  "serverPort": 3000,
  "serverUseHttps": true,
  "pcIdentifier": "POS-2"
}
```

Restart the app after editing that file.

## Step 14 — Give each till a unique PC identifier

In the wizard or in `appConfig.json`, use `POS-1`, `POS-2`, `POS-3`, etc. Do not reuse the same identifier.

---

# Part C — Go live (do not skip)

On **server + at least two clients**, check:

1. Login works; wrong password shows an error.  
2. Sale on PC A: stock drops on PC B within a few seconds.  
3. VAT 5% on a sample invoice looks correct.  
4. Thermal and/or A4 print from the till that has the printer.  
5. Create a cashier user; they cannot open Admin-only screens.  
6. Open **Settings → Backup**, run a backup, confirm a file was written.  
7. Reboot the **server PC**; API comes back (`pm2 status`); clients reconnect.  
8. Full checklist: [QA_CHECKLIST.md](./QA_CHECKLIST.md).

Until that list is done on the **shop Windows PCs**, do not put live cash through the system.

---

## Daily shop use

- Leave the **server PC powered on** during opening hours.  
- Staff open **Bytecra POS** on each till (desktop shortcut).  
- Do not run `npm run dev` in the shop.

| Task | Where | Command |
|------|--------|---------|
| API status | Server PowerShell | `pm2 status` |
| API logs | Server | `pm2 logs mahali-light` |
| Restart API | Server | `npm run pm2:restart` then `pm2 save` |

---

## If something breaks

| Symptom | Fix |
|---------|-----|
| Client: Network unavailable / timeout | Server off, wrong IP, or port 3000 blocked. Recheck Steps 8–9 and 13. |
| Server: JWT_SECRET / placeholder | `.env` still has example secrets. Step 6. |
| `EADDRINUSE` port 3000 | Another app on 3000. Change `PORT` in `.env` **and** `serverPort` on every client. |
| After reboot API is down | Re-run `pm2-startup install` and `pm2 save` as Administrator. |
| HTTPS / certificate errors | `SERVER_USE_HTTPS=true` and clients `"serverUseHttps": true`. |
