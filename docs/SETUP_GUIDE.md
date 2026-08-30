# Mahali Light — Full Setup Guide (Windows)

**Opening a shop with several Windows PCs?** Use **[SHOP_MULTI_PC.md](./SHOP_MULTI_PC.md)** first (numbered server + client steps). This page is the detailed Windows install reference (paths, PM2, TLS).


This guide covers everything needed to install, configure, and run **Mahali Light (Bytecra POS)** on a Windows machine from scratch — including making the server start automatically on every Windows boot.

---

## Table of Contents

1. [What You Will Install](#1-what-you-will-install)
2. [Install Node.js and npm](#2-install-nodejs-and-npm)
3. [Install Git](#3-install-git)
4. [Install PostgreSQL](#4-install-postgresql)
5. [Install PM2 (Process Manager)](#5-install-pm2-process-manager)
6. [Install OpenSSL (for HTTPS/TLS)](#6-install-openssl-for-httpstls)
7. [Get the Project Files](#7-get-the-project-files)
8. [Install Project Dependencies](#8-install-project-dependencies)
9. [Configure Environment Variables (.env)](#9-configure-environment-variables-env)
10. [Set Up the Database](#10-set-up-the-database)
11. [Start the Server with PM2](#11-start-the-server-with-pm2)
12. [Make the Server Auto-Start on Windows Boot](#12-make-the-server-auto-start-on-windows-boot)
13. [Run the Electron Desktop App](#13-run-the-electron-desktop-app)
14. [Daily Management Commands](#14-daily-management-commands)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. What You Will Install

| Software | Purpose |
|----------|---------|
| Node.js v20 LTS | Runs the API server and build tools |
| npm | Installs JavaScript packages |
| Git | Downloads the project (optional if you have a ZIP) |
| PostgreSQL 16 | The database |
| PM2 | Keeps the server alive and starts it on boot |
| pm2-windows-startup | Registers PM2 as a Windows service |
| OpenSSL | Generates the TLS certificate for HTTPS on the LAN |

---

## 2. Install Node.js and npm

1. Go to **https://nodejs.org** and download the **LTS** version (v20 or newer).
2. Run the installer — keep all defaults, make sure **"Add to PATH"** is checked.
3. Open a **new** PowerShell window and verify:

```powershell
node -v   # should print v20.x.x or higher
npm -v    # should print 10.x.x or higher
```

---

## 3. Install Git

> Skip this step if you will copy the project as a ZIP file.

1. Go to **https://git-scm.com/download/win** and download the installer.
2. Run it — keep all defaults.
3. Verify:

```powershell
git --version   # should print git version 2.x.x
```

> Git for Windows also bundles **OpenSSL**, which is needed for TLS certificate generation.

---

## 4. Install PostgreSQL

1. Go to **https://www.postgresql.org/download/windows/** and download **PostgreSQL 16**.
2. Run the installer:
   - Choose an installation directory (default is fine).
   - Set a **password for the `postgres` superuser** — remember this, you will need it.
   - Keep the default port **5432**.
   - Keep the default locale.
3. When the installer finishes, **uncheck** "Launch Stack Builder" and click Finish.
4. Verify PostgreSQL is running:

```powershell
# Open PowerShell and try connecting
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "\l"
```

Enter the password you set. You should see a list of databases.

> PostgreSQL installs itself as a Windows service and starts automatically on boot by default. No extra steps needed.

---

## 5. Install PM2 (Process Manager)

Open **PowerShell as Administrator** (right-click → Run as administrator):

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
```

Verify:

```powershell
pm2 -v   # should print a version number
```

---

## 6. Install OpenSSL (for HTTPS/TLS)

The server auto-generates a self-signed TLS certificate on first start. It needs `openssl` in the PATH.

**If you installed Git for Windows (Step 3), OpenSSL is already available.** Verify:

```powershell
openssl version   # should print OpenSSL 3.x.x
```

If not found, add Git's OpenSSL to your PATH:

```powershell
# Add to your PowerShell session temporarily to test
$env:PATH += ";C:\Program Files\Git\usr\bin"
openssl version
```

To add it permanently, open **System Properties → Environment Variables → Path** and add:
```
C:\Program Files\Git\usr\bin
```

---

## 7. Get the Project Files

### Option A — Clone with Git

```powershell
cd "E:\Udemy"
git clone <your-repo-url> mahali-light
cd mahali-light
```

### Option B — Extract from ZIP

Extract the ZIP to `E:\Udemy\mahali-light` and then:

```powershell
cd "E:\Udemy\mahali-light"
```

---

## 8. Install Project Dependencies

Inside the project folder:

```powershell
npm install
```

This installs all packages listed in `package.json`. It may take a few minutes on first run.

---

## 9. Configure Environment Variables (.env)

The server reads its configuration from a `.env` file in the project root.

1. Copy the example file:

```powershell
Copy-Item .env.example .env
```

2. Open `.env` in Notepad (or any text editor):

```powershell
notepad .env
```

3. Update the following values:

### Database password

```env
PGPASSWORD=postgres          # change to the password you set in Step 4
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/mahali_light
```

### JWT Secret (required — server refuses to start without it)

Generate a secure random value:

```powershell
node -e "require('crypto').randomBytes(48, (e,b) => console.log(b.toString('hex')))"
```

Copy the output and paste it:

```env
JWT_SECRET=paste_the_output_here
```

### Backup encryption key (required)

```powershell
node -e "require('crypto').randomBytes(32, (e,b) => console.log(b.toString('hex')))"
```

```env
MAHALI_BACKUP_SECRET=paste_the_output_here
```

### Server IP address

Set this to the **LAN IP address** of this Windows machine (other PCs on the network use this to connect):

```powershell
# Find your LAN IP
ipconfig
# Look for "IPv4 Address" under your Ethernet or Wi-Fi adapter
```

```env
SERVER_IP=192.168.1.10       # replace with your actual LAN IP
MAHALI_SERVER_IP=192.168.1.10
VITE_SERVER_IP=192.168.1.10
```

### HTTPS

Keep `SERVER_USE_HTTPS=true` (recommended). The server generates a self-signed cert automatically in the `tls/` folder on first start.

4. Save and close the file.

---

## 10. Set Up the Database

### Create the database

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE mahali_light;"
```

Enter your PostgreSQL password when prompted.

### Run migrations (creates all tables)

```powershell
npm run migrate
```

### Seed initial data (admin user, default settings, sample products)

```powershell
npm run seed
```

---

## 11. Start the Server with PM2

```powershell
cd "E:\Udemy\mahali-light"
npm run pm2:start
```

Check that it is running:

```powershell
npm run pm2:status
```

You should see `mahali-light` with status **online**.

Test the API in your browser or PowerShell:

```powershell
# HTTP test (if HTTPS is disabled)
Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing

# HTTPS test (self-signed cert, ignore cert warning)
Invoke-WebRequest -Uri "https://localhost:3000/api/health" -UseBasicParsing -SkipCertificateCheck
```

---

## 12. Make the Server Auto-Start on Windows Boot

This is the key step. Open **PowerShell as Administrator**:

```powershell
# 1. Register PM2 as a Windows startup service
pm2-startup install

# 2. Save the current process list so PM2 restores it after reboot
pm2 save
```

### Test the auto-start

Restart your PC, then open PowerShell and run:

```powershell
pm2 status
```

`mahali-light` should be **online** without you doing anything.

---

## 13. Run the Electron Desktop App

### Development mode (with hot reload)

```powershell
cd "E:\Udemy\mahali-light"
npm run dev
```

This starts:
- The Vite frontend dev server (port 5173)
- The Express API server (port 3000) via nodemon
- The Electron window

### Production build

Build the frontend:

```powershell
npm run build
```

Build the Windows installer:

```powershell
npm run build:electron
```

The installer will be in the `release/` folder: `BytecraPOS-Setup-1.0.0.exe`

---

## 14. Daily Management Commands

| Task | Command |
|------|---------|
| Start server | `npm run pm2:start` |
| Stop server | `npm run pm2:stop` |
| Restart server | `npm run pm2:restart` |
| View live logs | `npm run pm2:logs` |
| Live dashboard | `pm2 monit` |
| Check status | `npm run pm2:status` |
| Save process list | `pm2 save` |
| Run migrations | `npm run migrate` |

### Log files

| File | Contents |
|------|---------|
| `logs/pm2-out.log` | Normal server output |
| `logs/pm2-error.log` | Errors and crashes |

Logs rotate at **10 MB** and are kept for **30 days**.

---

## 15. Troubleshooting

### `npm install` fails with node-gyp errors

Some packages (bcrypt, sharp) compile native code. Install the Windows build tools:

```powershell
npm install -g windows-build-tools
```

Or install **"Desktop development with C++"** from Visual Studio Build Tools:
https://visualstudio.microsoft.com/visual-cpp-build-tools/

---

### Server shows `errored` in PM2

```powershell
pm2 logs mahali-light --lines 50
```

Common causes:
- `.env` is missing or `JWT_SECRET` / `MAHALI_BACKUP_SECRET` are still set to the placeholder values
- PostgreSQL is not running (`services.msc` → check **postgresql-x64-16**)
- Wrong database password in `.env`

---

### `psql` command not found

Add PostgreSQL's bin folder to your PATH:

```
C:\Program Files\PostgreSQL\16\bin
```

Go to **System Properties → Environment Variables → Path** and add it, then restart PowerShell.

---

### Port 3000 already in use

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F
```

---

### PM2 not auto-starting after reboot

Re-run the startup setup (as Administrator):

```powershell
pm2-startup install
cd "E:\Udemy\mahali-light"
npm run pm2:start
pm2 save
```

---

### PostgreSQL not ready when PM2 starts the server

The server may start before PostgreSQL finishes initializing on boot. Fix: increase `restart_delay` in `ecosystem.config.js` from `3000` to `8000` (8 seconds), then:

```powershell
pm2 restart ecosystem.config.js
pm2 save
```

---

### Client PCs cannot connect over the LAN

1. Make sure `SERVER_IP` in `.env` matches the server's actual LAN IP (`ipconfig`).
2. Allow port 3000 through Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName "Mahali Light API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

3. On each client PC, update `%APPDATA%\BytecraPOS\appConfig.json` with the server IP.

---

*Bytecra POS — Mahali Light · Ali Aldahmani · hello@bytecra.com*
