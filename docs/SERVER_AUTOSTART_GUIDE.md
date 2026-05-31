# Server Auto-Start Guide (Windows)

This guide walks you through making the **Mahali Light API server** start automatically every time Windows boots, using **PM2**.

---

## Prerequisites

Make sure you have the following installed before starting:

| Tool | Check | Install |
|------|-------|---------|
| Node.js (v18+) | `node -v` | https://nodejs.org |
| npm | `npm -v` | Comes with Node.js |
| PM2 | `pm2 -v` | See step below |

---

## Step 1 — Install PM2 Globally

Open **PowerShell as Administrator** and run:

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
```

---

## Step 2 — Set Up PM2 to Start on Windows Boot

Still in PowerShell (as Administrator), run:

```powershell
pm2-startup install
```

This registers PM2 as a Windows service so it launches automatically on boot.

---

## Step 3 — Navigate to the Project Folder

```powershell
cd "E:\Udemy\mahali-light"
```

---

## Step 4 — Start the Server with PM2

```powershell
npm run pm2:start
```

This is equivalent to:

```powershell
pm2 start ecosystem.config.js
```

Verify the server is running:

```powershell
npm run pm2:status
```

You should see `mahali-light` with status **online**.

---

## Step 5 — Save the PM2 Process List

This is the most important step. It tells PM2 to remember which apps to restart on boot:

```powershell
pm2 save
```

> **Without this step, PM2 will not restore the server after a reboot.**

---

## Step 6 — Test It

Restart your PC and then check if the server came back up automatically:

```powershell
pm2 status
```

Or open a browser and hit the API:

```
http://localhost:3000/api/health
```

---

## Daily Management Commands

| Task | Command |
|------|---------|
| Start server | `npm run pm2:start` |
| Stop server | `npm run pm2:stop` |
| Restart server | `npm run pm2:restart` |
| View live logs | `npm run pm2:logs` |
| Live dashboard | `pm2 monit` |
| Check status | `npm run pm2:status` |
| Save process list | `pm2 save` |

---

## Log Files

PM2 writes logs to the `logs/` folder inside the project:

| File | Contents |
|------|---------|
| `logs/pm2-out.log` | Normal server output |
| `logs/pm2-error.log` | Errors and crashes |

To tail logs in real time:

```powershell
npm run pm2:logs
```

Logs rotate automatically at **10 MB** and are kept for **30 days**.

---

## Crash Recovery

PM2 is configured to:

- **Auto-restart** the server if it crashes
- Wait **3 seconds** between restarts to avoid rapid crash loops
- Give up after **10 consecutive crashes** within 30 minutes (marks as `errored` so you are alerted)

---

## Uninstalling Auto-Start

If you ever want to remove the Windows auto-start:

```powershell
pm2-startup uninstall
pm2 delete mahali-light
pm2 save
```

---

## Troubleshooting

### Server shows `errored` status
```powershell
pm2 logs mahali-light --lines 50
```
Check `logs/pm2-error.log` for the root cause.

### PM2 not found after reboot
Re-run the startup setup:
```powershell
pm2-startup install
pm2 start ecosystem.config.js
pm2 save
```

### Port already in use
Another process is using port 3000. Find and stop it:
```powershell
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F
```

### PostgreSQL not ready when server starts
If the server starts before your database is up, increase the `restart_delay` in `ecosystem.config.js` from `3000` to `8000` (8 seconds), then run `pm2 restart ecosystem.config.js && pm2 save`.

---

*Bytecra POS — Mahali Light · Ali Aldahmani · hello@bytecra.com*
