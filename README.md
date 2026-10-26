# Bytecra POS

Point of sale for an electrical shop (UAE). One **server PC** runs everything
in Docker; every **till/cashier PC** is just a browser pointed at the server
over the shop's LAN. Several tills share one PostgreSQL database.

> **Version**: 1.10.0 | **License**: UNLICENSED | **Author**: Ali Aldahmani (hello@bytecra.com)

## 1. Project overview

- **Next.js 15 (App Router, TypeScript)** — the real, native browser POS frontend
  (cashiers open a URL). It is a standalone application under `web/` with its
  own routes, components, Zustand stores, and services, and does not use
  `react-router-dom`. Route groups: `(auth)`, `(cashier)`, `(dashboard)`, and
  `(mobile)` (a phone-friendly view under `/m`). See `docs/web-migration/` for
  the migration record.
- **Express** — permanent core API (JWT, RBAC, invoices, inventory, purchasing,
  returns/warranties, cash drawer & treasury, HR/attendance, finance, reports,
  backups, in-app updates).
- **PostgreSQL 16** — permanent database.
- **Socket.io** — realtime events (stock, force-logout, notifications), hosted on Express.
- **Caddy (`web-tls`)** — HTTPS front door on `:443` with an auto-generated
  self-signed cert, so phones can use the camera for barcode scanning
  (browsers only allow camera access over HTTPS).
- **Hardware Agent** (optional, per till) — silent thermal print / local printers. Not required for ordinary use.
- **FastAPI** (optional) — future ML/AI only. **Not** part of normal POS startup and **not** a replacement for Express.

The old React/Vite SPA and the Electron desktop shell that used to wrap it
have been removed from this repo (see
`docs/web-migration/VITE_ARCHIVE_STATUS.md`) — `web/` fully replaces them.
Normal tills do **not** install Node, Python, or PostgreSQL — only a browser.

### 1.1 Key Features

**POS & Sales:**
- Product management with barcode scanning (camera-based on phones)
- Multi-line invoice creation with item-level discounts
- Multiple payment methods: cash, card, bank transfer, check
- Cash drawer management with opening/closing balances
- Returns and exchanges with refund handling
- Customer profiles and credit limits
- Pricing restrictions and special pricing

**Inventory & Purchasing:**
- Stock level tracking with real-time updates
- Purchase order management with supplier integration
- Purchase returns and supplier payments
- Stock transfers and adjustments
- Barcode lookup integration (UPCitemdb, configurable)
- Low stock alerts and reorder points

**Financial Management:**
- Treasury and cash drawer reconciliation
- Bank account management
- Expense tracking with categories
- Bill payment tracking
- Financial reports (sales, profit/loss, cash flow)
- Invoice integrity with payment idempotency

**HR & Attendance:**
- Employee management with roles and permissions
- Attendance tracking with check-in/check-out
- Leave management (types, balances, approval)
- Holiday calendar
- Attendance policies (late arrival, early departure)
- Shift management

**Warranty & Support:**
- Warranty claim management
- Warranty terms and policies
- Supplier warranty tracking
- Customer warranty history

**Operations & Security:**
- Role-Based Access Control (RBAC) with granular permissions
- JWT authentication with configurable expiration
- Real-time notifications via Socket.io
- Force-logout capability (admin-controlled)
- Rate limiting and CORS protection
- Automated backups with NAS support
- Encrypted backup archives
- In-app update system
- Audit logging for critical operations

**Reporting & Analytics:**
- Sales reports (daily, weekly, monthly)
- Inventory reports
- Financial summaries
- Customer purchase history
- Employee performance reports
- Custom report generation with Excel export

## 2. Architecture

```text
LAN browsers (tills)  →  Next.js (:80)  →  Express API (:3000)  →  PostgreSQL
                               ↑                    │
Phones (HTTPS)  →  Caddy web-tls (:443)             └── Socket.io (browsers also connect to :3000)

                      optional Hardware Agent on a till (127.0.0.1 only)

optional: docker compose --profile ml  →  FastAPI (future ML)
```

Everything above the "LAN browsers" line runs in Docker **on one machine**
(the server PC). Nothing below it is installed on tills.

### 2.1 Technology Stack

**Frontend (Next.js 15):**
- **Framework**: Next.js 15 with App Router and TypeScript
- **UI Components**: Radix UI (headless components), Tailwind CSS
- **Icons**: Lucide React
- **Animations**: Motion (Framer Motion)
- **State Management**: Zustand
- **HTTP Client**: Axios
- **Real-time**: Socket.io Client
- **Charts**: Recharts
- **Barcode Scanning**: barcode-detector (camera-based)
- **Testing**: Vitest + Testing Library

**Backend (Express.js):**
- **Framework**: Express 4.19
- **Database**: PostgreSQL 16 with node-pg
- **Authentication**: JWT (jsonwebtoken), bcrypt for password hashing
- **Real-time**: Socket.io 4.8
- **PDF Generation**: Puppeteer with Chromium
- **Image Processing**: Sharp
- **File Uploads**: Multer
- **Validation**: Zod
- **Security**: Helmet, CORS, express-rate-limit
- **Scheduled Tasks**: node-cron
- **Backup**: Archiver, tar
- **Excel Export**: ExcelJS, fast-csv
- **QR Codes**: qrcode
- **Testing**: Vitest, Supertest

**Optional Components:**
- **Hardware Agent**: Node.js (localhost-only print service)
- **FastAPI (ML)**: Python 3.11+, FastAPI, SQLAlchemy, Pydantic, Alembic

**Infrastructure:**
- **Containerization**: Docker, Docker Compose
- **Reverse Proxy**: Caddy 2.8 (self-signed HTTPS)
- **Process Management**: PM2 (for native installs)
- **Version Control**: Git with GitHub Actions CI/CD

### 2.2 Project Structure

```
mahali-light/
├── web/                      # Next.js frontend (standalone)
│   ├── app/                 # App Router pages
│   │   ├── (auth)/         # Login, setup wizard
│   │   ├── (cashier)/      # POS interface
│   │   ├── (dashboard)/    # Admin dashboard
│   │   └── (mobile)/       # Mobile views
│   ├── components/         # React components
│   ├── services/           # API client services
│   ├── store/              # Zustand stores
│   ├── lib/                # Utilities
│   └── hooks/              # Custom hooks
│
├── server/                  # Express API
│   ├── controllers/       # Request handlers
│   ├── routes/            # API endpoints (45+ routes)
│   ├── services/          # Business logic
│   ├── middleware/        # Express middleware
│   ├── socket/            # Socket.io handlers
│   ├── db/                # Database & migrations
│   ├── backup/            # Backup logic
│   ├── jobs/              # Scheduled tasks
│   └── utils/             # Helper functions
│
├── shared/                 # Shared business logic
│   ├── authzPolicy.js     # Authorization rules
│   ├── permissions.js     # Permission definitions
│   ├── errorCodes.js      # Error registry
│   ├── attendancePolicy.js
│   └── warrantyClaimPolicy.js
│
├── backend-fastapi/       # Optional ML sidecar
│   ├── app/              # FastAPI app
│   ├── alembic/          # Python migrations
│   └── tests/            # pytest tests
│
├── hardware-agent/       # Local print service
│   ├── server.js         # Agent server
│   └── print.ps1         # Windows print script
│
├── docker/               # Docker configs
│   ├── postgres/         # PG init scripts
│   ├── Caddyfile         # Caddy config
│   └── caddy-entrypoint.sh
│
├── scripts/              # Maintenance scripts
│   ├── reconcile.js      # Balance reconciliation
│   ├── decryptBackup.js  # Backup decryption
│   ├── applyUpdate.js    # In-app updater
│   └── dev.js            # Dev launcher
│
├── tests/                # Test suites
│   ├── unit/            # Backend unit tests
│   ├── integration/     # Integration tests
│   ├── contracts/       # Contract tests
│   └── migration/       # Migration tests
│
├── docs/                 # Documentation
│   ├── web-migration/   # Migration records
│   ├── LOCAL_DEV.md     # Local dev guide
│   └── Setup guides
│
└── [Audit files]        # Financial/POS audit reports
```

### 2.3 API Endpoints

The Express API exposes 45+ route modules covering:

- **Authentication**: `/api/auth` (login, logout, refresh tokens)
- **Users & Roles**: `/api/users`, `/api/roles`, `/api/employees`
- **Products & Inventory**: `/api/products`, `/api/stock`, `/api/categories`, `/api/variants`
- **Sales & Invoices**: `/api/invoices`, `/api/invoiceEditRequests`
- **Customers**: `/api/customers`, `/api/customerPayments`
- **Purchasing**: `/api/purchaseOrders`, `/api/suppliers`, `/api/supplierPayments`, `/api/supplierReturns`
- **Returns**: `/api/returnOrders`, `/api/returnRequests`
- **Warranties**: `/api/warranties`, `/api/warrantyClaims`
- **Cash & Treasury**: `/api/cashDrawer`, `/api/treasury`
- **Finance**: `/api/finance`, `/api/bankAccounts`, `/api/expenses`, `/api/bills`, `/api/billPayments`
- **HR**: `/api/attendance`, `/api/leaves`, `/api/leaveBalances`, `/api/holidays`
- **Reports**: `/api/reports`, `/api/analytics`
- **Settings**: `/api/settings`, `/api/appSettings`, `/api/backup`
- **Files**: `/api/files` (upload/download)
- **Real-time**: Socket.io events (stock, notifications, presence)
- **Setup**: `/api/setup` (initial setup wizard)

Full API documentation: See `API-doc.md` in the repository root.

### 2.4 Audit & Quality Assurance

Nine audit reports reviewed the system (invoices, payments, purchase orders, cash drawer, warranties, retries, transactions, sessions, AI readiness). Their fixes, test results and every open item are summarised in **`PROJECT_REPORT.md`** in the repository root. The original audit files were removed to keep one source of truth; they remain in git history (`git show f7b874a:POS_WARRANTY_AUDIT.md`).

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
| `MAHALI_BACKUP_SECRET` | Random 32+ byte hex string; encrypts NAS credentials and (if enabled) backup archives | see command below |
| `SERVER_IP` | This PC's LAN IP (find it in A.5). Also used as the IP in the HTTPS cert | `192.168.1.50` |
| `WEB_PORT` | Port the POS website listens on. `80` is normal; use `8080` if `80` is taken | `80` |
| `WEB_TLS_PORT` | HTTPS port for phones (Caddy `web-tls`) | `443` |
| `API_PORT` | Port the API + Socket.io listens on; must be open on the firewall | `3000` |
| `STORE_TIMEZONE` | IANA timezone that defines the store's business day | `Asia/Dubai` |
| `SERVER_USE_HTTPS` | Leave `false` for plain HTTP over Docker unless you've added TLS certs | `false` |

Optional: `BARCODE_LOOKUP_PROVIDER` / `BARCODE_LOOKUP_API_KEY` for
scan-to-autofill when adding products (defaults to a free UPCitemdb trial
tier; set the provider to `none` to disable outbound lookups).

Generate the two secrets (run on any machine with Node.js — your laptop is
fine, you're just generating random text):

```bash
node -e "require('crypto').randomBytes(48,(e,b)=>console.log(b.toString('hex')))"   # → JWT_SECRET
node -e "require('crypto').randomBytes(32,(e,b)=>console.log(b.toString('hex')))"   # → MAHALI_BACKUP_SECRET
```

Paste each output into the matching line in `.env`.

> In production the API **refuses to start** if `JWT_SECRET` is missing,
> shorter than 32 characters, or still a placeholder (`REPLACE_ME…`,
> `change-me`, …), or if `MAHALI_BACKUP_SECRET` is missing. Keep a copy of
> `MAHALI_BACKUP_SECRET` **off the server** — without it, encrypted backups
> cannot be restored.

### A.5 Find this PC's LAN IP (needed for `SERVER_IP` above)

- **Windows**: open PowerShell, run `ipconfig`, look for "IPv4 Address" under
  your active Ethernet or Wi‑Fi adapter.
- **macOS/Linux**: run `ifconfig` or `ip addr`, look for the address on your
  active network interface (usually starts with `192.168.` or `10.`).

By default this address is handed out by DHCP, which means it **can change**
after a reboot, a long power-off, or a router restart — and if it does,
`SERVER_IP` in `.env` goes stale and every till silently loses connection
(page loads, but Socket.io/API calls fail CORS). Pick **one** of these two
ways to make it permanent, then make sure every till is on the **same**
Wi‑Fi/VLAN as the server:

**Option 1 — DHCP reservation on the router (recommended)**

Log into your router's admin page and reserve the server PC's current IP for
its MAC address (sometimes called a "DHCP reservation" or "static lease").
The OS side stays on DHCP — the router just always hands back the same
address. Find the MAC address with `ipconfig /all` (Windows, look for
"Physical Address" under the same adapter) or `ip link` (Linux) /
`ifconfig` (macOS).

**Option 2 — Static IP set directly on the server PC**

Use the server's *current* IP, gateway, and subnet so nothing else (`.env`,
firewall rules, router) needs to change — just make DHCP stop being able to
reassign it. Find the current gateway/DNS first:

- Windows: `ipconfig /all` (look for "Default Gateway" under the same adapter)
- macOS/Linux: `netstat -nr | grep default` (macOS) or `ip route` (Linux)

Then, **Windows** (PowerShell, run as Administrator — replace the adapter
name, IP, and gateway with your own):
```powershell
Set-NetIPInterface -InterfaceAlias "Ethernet" -Dhcp Disabled
New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.1.50 -PrefixLength 24 -DefaultGateway 192.168.1.1
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses 192.168.1.1
```
To undo and go back to DHCP:
```powershell
Set-NetIPInterface -InterfaceAlias "Ethernet" -Dhcp Enabled
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ResetServerAddresses
```

**macOS** (replace `Wi-Fi` with `Ethernet` if wired):
```bash
sudo networksetup -setmanual "Wi-Fi" 192.168.1.50 255.255.255.0 192.168.1.1
sudo networksetup -setdnsservers "Wi-Fi" 192.168.1.1
```
Undo: `sudo networksetup -setdhcp "Wi-Fi"`

**Linux** (NetworkManager — find your connection name with `nmcli con show`):
```bash
sudo nmcli connection modify "Wired connection 1" ipv4.addresses 192.168.1.50/24 ipv4.gateway 192.168.1.1 ipv4.dns 192.168.1.1 ipv4.method manual
sudo nmcli connection up "Wired connection 1"
```
Undo: `sudo nmcli connection modify "Wired connection 1" ipv4.method auto && sudo nmcli connection up "Wired connection 1"`

Whichever option you pick, reboot the server PC once afterward and confirm
the IP is unchanged (`ipconfig` / `ip addr`) before relying on it.

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
together (plus a stock Caddy image for HTTPS). You don't need to edit these
files for normal use — this section just explains what they do, so
`docker compose up` isn't a black box.

### B.1 `Dockerfile` (repo root) — the Express API image

Multi-stage build on Node 22: installs production Node dependencies
(including native modules like `bcrypt` and `sharp`), then a runtime stage
with Chromium (for PDF generation via Puppeteer) and the PostgreSQL 16
client tools (for backups). `docker/entrypoint.sh` fixes volume ownership
and drops to the unprivileged `node` user, then runs `server/index.js`.
Exposes port `3000` inside the container.

### B.2 `web/Dockerfile` — the Next.js frontend image

Multi-stage build: installs `web/`'s own dependencies, runs `next build`
(with full TypeScript checking — the build fails if there are type errors),
then copies only the resulting standalone server into a slim runtime image
running as a non-root user. It is built entirely from `web/`.
`NEXT_PUBLIC_EXPRESS_PORT` is baked in at **build** time from `API_PORT`, so
changing `API_PORT` requires rebuilding this image. `web/forwarded-for.cjs`
is preloaded so Express sees each till's real IP (for rate limits and audit).
Exposes port `3000` inside the container.

### B.3 `docker-compose.yml` — how the pieces fit together

| Service | Image built from | Published port (`.env` var) | Purpose |
| --- | --- | --- | --- |
| `postgres` | official `postgres:16-bookworm` | *(not published — LAN can't reach it)* | The database. Data persists in the `postgres_data` volume. |
| `express-api` | `Dockerfile` | `${API_PORT:-3000}` | The core API + Socket.io. Waits for `postgres` to be healthy before starting. |
| `nextjs` | `web/Dockerfile` | `${WEB_PORT:-80}` | The POS website. Waits for `express-api` to be healthy, then proxies `/api/*` and `/files/*` to it internally. |
| `web-tls` | official `caddy:2.8-alpine` | `${WEB_TLS_PORT:-443}` | HTTPS reverse proxy to `nextjs` for phones. Generates a 10-year self-signed cert for `SERVER_IP` on first start (stored in the `web_tls` volume). |
| `fastapi` | `backend-fastapi/Dockerfile` | `${FASTAPI_PORT:-8000}` | **Optional**, only starts with `--profile ml`. Future ML only — exposes `GET /health` today. |

Named volumes: `postgres_data`, `api_uploads`, `api_backups`, `api_tls`,
`web_tls`.

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
`express-api`, and `nextjs` should all show **healthy**, and `web-tls`
should be **running** (it has no healthcheck). `fastapi` must **not**
appear at all (it's opt-in only).

If a service shows `unhealthy` or keeps restarting, see the Troubleshooting
table in Part D before continuing.

### B.5 Database schema (automatic)

The API applies any pending migrations (taking a pre-migration backup first)
and seeds default data **every time it starts**, so there is normally
nothing to do. To run migrations by hand anyway (safe to repeat):

```bash
docker compose run --rm express-api npm run migrate
```

### B.6 Open the firewall

The server PC's firewall must allow incoming connections on:
- **`WEB_PORT`** (default `80`) — so tills can load the website.
- **`API_PORT`** (default `3000`) — so the browser can talk to the API and
  Socket.io.
- **`WEB_TLS_PORT`** (default `443`) — only if phones will be used (B.8).

Do **not** open port `5432` (PostgreSQL) — it isn't published anyway.

Windows example (PowerShell, run as Administrator):
```powershell
New-NetFirewallRule -DisplayName "Bytecra POS Web" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Bytecra POS API" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Bytecra POS HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

### B.7 First login

On the server PC (or any till), open a browser to:

```
http://SERVER_IP
```

(e.g. `http://192.168.1.50`, or `http://192.168.1.50:8080` if you set
`WEB_PORT=8080`).

You'll land on the **setup wizard** — production does **not** ship a default
`admin`/`admin123` account. The wizard first asks for a **setup code**, which
the API prints to its log on startup (so only someone with access to the
server can create the Admin account):

```bash
docker compose logs express-api | grep -A1 "SETUP CODE"
```

It is also saved as `setup-code.txt` inside the API container (native
installs: in the app folder) and is valid for 24 hours; restart the API to get
a new one. Then follow the remaining steps (store profile, VAT, network mode,
admin account, cash drawer, bank account) to finish setup, and log in.

Follow live logs any time with:
```bash
docker compose logs -f
```

### B.8 Phones (HTTPS for barcode scanning)

Phone browsers only allow camera access on HTTPS, so phones should open:

```
https://SERVER_IP
```

(add `:WEB_TLS_PORT` if you changed it from `443`). The certificate is
self-signed, so the phone will show a security warning the first time —
accept it to continue. Desktop tills can keep using plain `http://SERVER_IP`.
If `SERVER_IP` ever changes, delete the `web_tls` volume (or the cert files
inside it) and restart `web-tls` so a new cert is issued for the new IP.

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

**Full update (recommended — updates API *and* UI):**

1. **Back up the database first** (D.4).
2. Pull/copy the new code (or a release tag) into the project folder.
3. ```bash
   docker compose up -d --build
   docker compose ps
   ```
   Migrations run automatically when the API restarts.
4. Open the web UI and confirm it loads.

**In-app update:** Admins can also use **Settings → About → Check for
updates**, which downloads the latest GitHub release and swaps it into the
running API container (`scripts/applyUpdate.js`). This only updates the
**API** (`server/`, `shared/`, dependencies) — the Next.js UI image is not
rebuilt, so releases with UI changes still need the full update above.

Never delete the `postgres_data` volume as part of an update.

### D.3 PostgreSQL persistence

Data lives in the Docker volume `postgres_data`.

- `docker compose down` stops containers; **data remains**.
- `docker compose down -v` **deletes the database**. Never run this on a live shop.

### D.4 Backup

The app writes scheduled backups (configured from **Settings → Backup** in
the POS, optionally to a NAS) to the `api_backups` volume (`/app/backups`
inside `express-api`).

If "Encrypt backup archives" is on, archives are encrypted with
`MAHALI_BACKUP_SECRET`. Decrypt one by hand with:
```bash
node scripts/decryptBackup.js <file.tar.gz.enc> <out.tar.gz>
```

Manual one-off dump:
```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > shop-$(date +%Y%m%d).dump
```
On Windows, read the user/db values from `.env` and redirect the output to a
file on the server's disk. (`./docker/postgres/backups` on the host is also
mounted at `/backups` inside the `postgres` container.)

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

Express `/api/health` actually queries the database: it returns `200` with
`data.status: ok` when healthy, or `503` with `data.status: degraded` /
`database: unreachable` if PostgreSQL can't be reached. Postgres health is
Compose's built-in `pg_isready` check.

### D.7 Troubleshooting

| Symptom | What to run / check |
| --- | --- |
| Browser can't open the server | Ping `SERVER_IP`; check `WEB_PORT`; firewall rules from B.6 |
| Wrong/changed IP | Re-check with `ipconfig`/`ip addr`; update `SERVER_IP` in `.env`, then `docker compose up -d` to recreate `express-api` |
| Port already in use | Change `WEB_PORT` / `API_PORT` in `.env`, then `docker compose up -d` |
| Postgres unhealthy | `docker compose logs postgres` |
| API restarting in a loop | `docker compose logs express-api` — usually `JWT_SECRET`, DB password, or a failed migration |
| UI loads but API calls fail with CORS errors | `SERVER_IP` in `.env` must match the host used in the browser's address bar |
| Code/UI updated but POS looks unchanged | Rebuild the web image: `docker compose build nextjs && docker compose up -d nextjs` (restart alone keeps the old UI). Use `http://SERVER_IP` (`WEB_PORT`), not `:3000`. Hard-refresh (**Ctrl+Shift+R**) |
| Socket.io shows disconnected | Firewall must allow `API_PORT` (3000); `NEXT_PUBLIC_EXPRESS_PORT` is baked from `API_PORT` at build time — after changing `API_PORT`, run `docker compose build nextjs && docker compose up -d` |
| Phone camera / barcode scanner won't start | Open `https://SERVER_IP` (B.8), not `http://`; accept the cert warning; firewall must allow `WEB_TLS_PORT` |
| API exits on start with a `JWT_SECRET` / `MAHALI_BACKUP_SECRET` error | Generate real secrets (A.4) — placeholders are rejected in production |
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
It exposes `GET /health` today and nothing else — draft forecast/analytics
routers exist under `backend-fastapi/app/api/v2/` but are not mounted.
Express remains the POS backend for everything. A normal
`docker compose up -d` (no `--profile ml`) never starts this service.

### D.10 Maintenance scripts

| Script | Purpose |
| --- | --- |
| `scripts/reconcile.js [--json] [--strict]` | Read-only report comparing stored running balances (cash drawer, etc.) against their source records. Runs in a `READ ONLY` transaction. |
| `scripts/decryptBackup.js` | Decrypt an encrypted backup archive (D.4). |
| `scripts/applyUpdate.js` | Used internally by the in-app updater (D.2). Don't run by hand. |

Inside Docker, run them via the API container, e.g.
`docker compose exec express-api node scripts/reconcile.js`.

---

## PART E — Local development (not for the live shop)

For working on the code, on a laptop — not the shop's server PC. You need
Node.js 22 and a local PostgreSQL 15+ (see `docs/LOCAL_DEV.md` if you hit
`ECONNREFUSED 127.0.0.1:5432`).

```bash
cp .env.example .env   # set PG* to your local Postgres, PGHOST=localhost, NODE_ENV=development
npm install
npm --prefix web install
npm run dev            # Express (nodemon) + Next.js dev server together
```

Or run them separately: `npm run dev:server` (Express) and
`npm run dev:web` (Next.js on `:3001`).

Ports: Express listens on `PORT` from `.env` (`3000` in `.env.example`;
`3002` if `PORT` is unset). The Next.js dev server proxies `/api` and
`/files` to `EXPRESS_INTERNAL_URL` (default `http://127.0.0.1:3000`), so
keep the two in sync. Open the app at `http://localhost:3001`.

`web/` is a self-contained TypeScript Next.js project (its own
`package.json`, `tsconfig.json`, `node_modules`). `npm run build` inside
`web/` runs `next build` with full type-checking (`ignoreBuildErrors:
false`) and produces a standalone server (`.next/standalone/web/server.js`),
which is exactly what `web/Dockerfile` packages for production.

### Tests

```bash
npm test                 # backend (Vitest): unit, contract, integration, migration
npm --prefix web test    # frontend (Vitest + Testing Library)
cd backend-fastapi && pip install -e ".[dev]" && pytest -v   # ML sidecar
```

Live-database suites (invoice integrity, concurrency) run automatically when
a PostgreSQL is reachable on `127.0.0.1:5432` (user/password `postgres` by
default; override with `INVOICE_TEST_PG_*`), and are skipped otherwise.
CI (`.github/workflows/build.yml`) runs all three suites against a real
Postgres 16 on every PR; pushing a `v*.*.*` tag runs
`.github/workflows/release.yml`, which publishes the GitHub release used by
the in-app updater.

Never run local dev processes as the live shop — the live shop is always
`docker compose up -d` (Part B).

More ops notes: `docker/README.md`. Architecture and migration record:
`docs/web-migration/` (start with `FRONTEND_MIGRATION_INVENTORY.md` and
`NEXTJS_NATIVE_PARITY.md`). Audit fixes and open
items: `PROJECT_REPORT.md`.

Invoice integrity changes, payment idempotency migration, private-file access,
and PostgreSQL regression-test instructions: [docs/INVOICE_INTEGRITY_FIXES.md](docs/INVOICE_INTEGRITY_FIXES.md).

---

## PART F — Environment Variables Reference

### F.1 Required Variables

| Variable | Description | Example |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | PostgreSQL database password | `Sup3rSecret!` |
| `POSTGRES_USER` | PostgreSQL user | `mahali` |
| `POSTGRES_DB` | PostgreSQL database name | `mahali_light` |
| `JWT_SECRET` | JWT signing secret (48+ hex bytes) | Generate with Node.js |
| `MAHALI_BACKUP_SECRET` | Backup encryption key (32+ hex bytes) | Generate with Node.js |
| `SERVER_IP` | Server's LAN IP address | `192.168.1.50` |
| `STORE_TIMEZONE` | Store's timezone (IANA format) | `Asia/Dubai` |

### F.2 Docker Ports

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_PORT` | `80` | Next.js web UI port |
| `WEB_TLS_PORT` | `443` | HTTPS port (Caddy) |
| `API_PORT` | `3000` | Express API + Socket.io port |
| `FASTAPI_PORT` | `8000` | Optional ML sidecar port |

### F.3 Security Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_EXPIRES_IN` | `8h` | JWT token expiration |
| `BCRYPT_ROUNDS` | `12` | Password hashing rounds |
| `TRUSTED_PROXIES` | `nextjs` | Trusted proxy IPs for X-Forwarded-For |
| `CORS_ORIGINS` | (empty) | Additional CORS origins |
| `SERVER_USE_HTTPS` | `false` | Enable HTTPS on Express (not Docker) |

### F.4 Optional Features

| Variable | Default | Description |
| --- | --- | --- |
| `BARCODE_LOOKUP_PROVIDER` | `upcitemdb` | Barcode lookup service |
| `BARCODE_LOOKUP_API_KEY` | (empty) | API key for barcode service |
| `NEXT_PUBLIC_HARDWARE_AGENT_URL` | `http://127.0.0.1:17473` | Hardware agent endpoint |
| `LOG_LEVEL` | `info` | Application logging level |

---

## PART G — CI/CD & Release Process

### G.1 GitHub Actions Workflows

The repository uses GitHub Actions for continuous integration and automated releases:

**Build Workflow** (`.github/workflows/build.yml`):
- Runs on every pull request
- Executes all test suites (backend, frontend, ML)
- Tests against PostgreSQL 16
- Validates TypeScript types
- Runs migration tests

**Release Workflow** (`.github/workflows/release.yml`):
- Triggered by pushing `v*.*.*` tags
- Creates GitHub release
- Publishes release artifacts
- Used by in-app updater

### G.2 Version Management

- Current version: `1.10.0`
- Version numbers are synchronized across:
  - Root `package.json`
  - `web/package.json`
  - Docker image tags in `docker-compose.yml`
- Semantic versioning is recommended for releases

### G.3 In-App Updates

Admins can update the API directly from the POS UI:
1. Go to **Settings → About → Check for updates**
2. The system downloads the latest GitHub release
3. Updates are applied via `scripts/applyUpdate.js`
4. Only updates the API (`server/`, `shared/`, dependencies)
5. UI changes require full Docker rebuild (see D.2)

---

## PART H — Support & Resources

### H.1 Documentation

- **API Documentation**: `API-doc.md` - Complete API reference
- **Migration Records**: `docs/web-migration/` - Frontend migration history
- **Local Development**: `docs/LOCAL_DEV.md` - Development setup guide
- **Invoice Integrity**: `docs/INVOICE_INTEGRITY_FIXES.md` - Financial integrity details
- **Setup Guides**: `docs/SETUP_GUIDE.md`, `docs/SHOP_MULTI_PC.md` - Additional setup instructions

### H.2 Audit Reports

See section 2.4 for a complete list of audit reports covering:
- POS invoice financial integrity
- Transaction atomicity
- Idempotency and duplicate operations
- Warranty system
- Purchase order payments
- Cash drawer operations
- Customer profiles
- User presence and logout
- AI/ML feasibility

### H.3 Contact

- **Author**: Ali Aldahmani
- **Email**: hello@bytecra.com
- **Website**: https://bytecra.com
- **License**: UNLICENSED (proprietary)

### H.4 Troubleshooting Resources

- See Part D.7 for common issues and solutions
- Check `docker compose logs` for container-specific errors
- Review audit reports for known issues and fixes
- Consult `docs/` directory for detailed guides

---

## Summary

Bytecra POS is a production-ready, Docker-first point of sale system designed for electrical retail in the UAE. It combines a modern Next.js frontend with a robust Express API backend, PostgreSQL database, and optional ML capabilities. The system emphasizes:

- **Simplicity**: Browser-only clients, no local installation
- **Reliability**: Docker containers with auto-restart, automated backups
- **Security**: JWT auth, RBAC, encrypted backups, rate limiting
- **Scalability**: Multiple tills sharing one database, real-time updates
- **Maintainability**: Comprehensive documentation, audit trails, in-app updates

The system is designed to run unattended on a server PC with minimal maintenance, while providing cashiers with a responsive, feature-rich POS interface accessible from any browser on the shop's LAN.
