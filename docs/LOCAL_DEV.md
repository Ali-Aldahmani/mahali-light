# Local development (Windows)

## Why you see `ECONNREFUSED` on port 5432

The Express server runs migrations on startup and connects to PostgreSQL. If nothing is listening on **5432**, you get:

```text
connect ECONNREFUSED 127.0.0.1:5432
```

The Electron/React UI then shows **“Network unavailable”** because `http://127.0.0.1:3000/api` never comes up.

## Quick fix

1. **Install PostgreSQL 15+** (if not installed).

2. **Start the PostgreSQL Windows service**
   - `Win + R` → `services.msc` → **postgresql-x64-…** → **Start**.

3. **Create the database** (adjust user/password if yours differ):

   ```sql
   CREATE DATABASE mahali_light;
   ```

4. **Configure `.env`** at the repo root (copy from `.env.example`):

   ```env
   PGHOST=localhost
   PGPORT=5432
   PGUSER=postgres
   PGPASSWORD=your_password
   PGDATABASE=mahali_light
   ```

5. **Migrate and seed** (optional but typical for first run):

   ```powershell
   npm run migrate
   npm run seed
   ```

6. **Start the app again**

   ```powershell
   npm run dev
   ```

## PATH note (Cursor / some terminals)

If `npm run dev` fails with `spawn cmd.exe ENOENT`, your `PATH` is missing Windows system folders. Prepend:

`C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem`

or fix **System Environment Variables** permanently and restart the terminal.
