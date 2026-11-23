# Bytecra POS — Production Upgrade Safety & Zero Data Loss Audit

Date: 17 Nov 2026 · Audited: `main` at `6d8f89e` (25 commits and 10 migrations ahead of tag `v1.10.2`) · No source code was changed.

## Scope and what was actually tested

| | |
| --- | --- |
| New release | `main` @ `6d8f89e`. `package.json` still says `1.10.2`; migrations 059–068 are new. |
| Previous release used | Tag `v1.10.2` (latest published GitHub release, 58 migrations). **Which version the customer really runs is not recorded anywhere in the repo.** |
| Environment | Two throw-away Compose projects (`upgtest`, `upgtest2`) built from `git archive`, own volumes, own secrets, ports 18080/18443 and 28080/28443. The existing local `bytecrapos` stack and its volumes were only read (version, mounts, one `SELECT count`). |
| Old-store data | Created through the real v1.10.2 HTTP API: setup wizard, 3 users (Admin/Cashier/Manager), 2 bank accounts, open cash drawer, 6 products, supplier + part-received, part-paid PO, 2 customers (one on credit), 7 invoices (cash, card, credit, split, discount, custom item, cancelled, open draft), customer payment, approved return with cash refund, 2 expenses, drawer adjust + transfer, stock adjustment. |
| Baseline | Row count + content hash of all 91 tables (hash over the pre-upgrade column list), 30 financial/identity totals, SHA-256 of every uploaded file and of the TLS cert/key, plus a `pg_dump`. |

Not tested (stated, not assumed): an upgrade from `v1.10.0` or older; the customer's real data; a real browser session on the upgraded UI (the self-signed certificate blocked the browser tool — pages were only checked for HTTP 200); thermal printing / Hardware Agent; power loss in the middle of a migration; disk full; Windows reboot; a real GitHub download of the new release (it is not published).

---

## A. Executive verdict

**SAFE WITH CONDITIONS** — for one path only.

- **Full update by the developer** (`new code` → `docker compose up -d --build`) from **v1.10.2**: tested twice, all business data preserved, store reopens without setup, both tills trade. Conditions are in section E.
- **In-app updater ("Check for updates")**: **UNSAFE for this release.** It leaves a new API with the old UI, and the new API silently disappears the next time the container is recreated, leaving old code running on the new database.
- **Upgrade from v1.10.0 or older**: **NOT VERIFIED.** The network layout changed between v1.10.0 and v1.10.1 and 21 more migrations apply.

---

## B. Direct answers

| # | Question | Answer | Evidence and test | Remaining risk |
| --- | --- | --- | --- | --- |
| 1 | Will the customer's data be deleted? | **NO** (full update from v1.10.2) | No `DROP TABLE`/`TRUNCATE`/`DELETE` of business rows in 059–068. Test: 79/91 tables byte-identical in every pre-existing column; the other 12 only gained rows (listed in section D2). Postgres container was not even recreated; volume name is pinned by `name: bytecrapos` (`docker-compose.yml:5`). | Running Compose with a different project name (`-p`, `COMPOSE_PROJECT_NAME`) starts an **empty** database and the setup wizard — seen with `upgtest2`. Changing `POSTGRES_PASSWORD` in `.env` locks the API out (not tested). |
| 2 | Will the updated application work correctly? | **CONDITIONAL** | After upgrade: 3 sales from 2 tills (cash, card, credit) succeeded, stock 287 → 280, health OK, `/`, `/login` return 200. | UI not exercised in a real browser. For up to 60 s after every restart every request is refused with "This connection isn't secure" (finding M2). |
| 3 | Will the customer need to create the store again? | **NO** | Setup is decided only by `app_settings.setup_completed` in the database (`server/services/setupService.js:28-38`, `setupTokenService.js:95-99`). Test: `GET /api/setup/status` → `setup_completed: true, has_admin: true`; one `app_settings` row; one Admin; no setup code issued. | Only if the database volume is not the original one (see #1). |
| 4 | Will existing accounts and passwords remain? | **YES** | `users` table hash identical; all three accounts logged in after upgrade with their original passwords; role-permission counts unchanged for existing permissions. `seed.js:199-203` never creates a default admin in production. | 5 new permissions are granted only to roles that hold defaults; custom roles do not get payroll / card-fee permissions. |
| 5 | Will products, invoices, inventory, financial records remain correct? | **CONDITIONAL** | Invoices, items, payments, customer balances, PO totals, stock, cash drawer, bank balances, refunds: identical before/after. Trial balance identical **except one new journal entry** (finding H4). | The upgrade changes the stock valuation policy to weighted average and books a one-time correction to Retained Earnings (167.98 in the test). Amount on real data is unknown until run. |
| 6 | Will the developer need to configure the server again? | **NO** from v1.10.2; **YES** from ≤ v1.10.0 | From v1.10.2: the old `.env` was reused untouched, no new required variable (`.env.example` diff adds one optional comment), same ports, same cert. From ≤ v1.10.0: Compose moved the front door to Caddy/HTTPS and bound the API to `127.0.0.1` (commit `807fe66`). | ≤ v1.10.0 path not tested. |
| 7 | Can the customer update with one click? | **NO** | `GET /api/app-updates/check` on the test stack: `currentVersion 1.10.2, latestVersion 1.10.2, updateAvailable false` — the release is not published and its version was not bumped. When forced with a test tarball, `scripts/applyUpdate.js` updated only the API. | See C1, C2. |
| 8 | Will all cashier computers work after updating? | **CONDITIONAL** | Two tills (`TILL-1` Admin, `TILL-2` Cashier) logged in and sold after the upgrade; same URL, same certificate (SHA-256 unchanged), so no re-trust. | Not tested in real browsers; open pages need a reload; from ≤ v1.10.0 every till needs the new `https://` address and a one-time certificate trust. |
| 9 | What happens if the update fails? | **Store is down until someone with a terminal fixes it** | Three dirty-data copies: migration aborted, that file rolled back, earlier files stayed applied, business data intact (`invoices 7 / 1709.27` each time), re-run after repair completed. `server/index.js` exits on migration error and Docker restarts it in a loop. | Each loop writes another pre-migration backup that is never pruned (code review, not run to disk-full). |
| 10 | Can the customer safely return to the previous version? | **CONDITIONAL — developer only** | In-app restore of the automatic pre-migration backup **failed** (`pg_restore ... cannot drop constraint users_pkey`), safely rolled back. Manual rollback **worked**: stop app → empty schema → `pg_restore` the pre-migration dump → start old images → all 30 totals equal to baseline, store trades. | Sales made after the upgrade are lost on rollback. Old images survive only if tagged before rebuilding (both builds use tag `1.1.0`). Old code on the new schema is **not** a rollback (C1). |

---

## C. Findings

### C1 — CRITICAL — In-app update is not durable; old code ends up on the new schema
- **Where:** `scripts/applyUpdate.js:274-315` (files swapped into `/app`), `Dockerfile:61-65` (`/app` is image content), `docker-compose.yml:70-73` (only uploads, backups, tls are volumes), `server/db/migrate.js:67-79` (unknown applied migrations are ignored, no "database is newer than this code" check).
- **Root cause:** the update lives in the container's writable layer. Any container recreate (`docker compose up -d` after an `.env` edit, `down`/`up`, a rebuild, a Docker reset) brings back the image's old code while the database keeps the new schema.
- **Reproduced:** in-app update → API `1.11.0`, 68 migrations, status `done`. `docker compose up -d --force-recreate express-api` → API `1.10.2`, 58 migration files, database still at 68, container **healthy**, no warning. Three sales then succeeded and left stock ≠ cost batches on 3 products (e.g. stock 273 vs batches 280, book value 1890.00 vs 1842.75) and 3 invoice lines without recorded cost.
- **Customer impact:** silent, growing inventory-value and profit errors; new features vanish.
- **Fix:** refuse to start when `_migrations` contains files this build does not have; stop swapping files into a container — update by image.

### C2 — HIGH — In-app updater updates only part of the product and reports success
- **Where:** `scripts/applyUpdate.js:275-276` (`server`, `package.json`, `shared`, lockfile, `node_modules` only), `server/services/updateCheckService.js:255-268` (success = version string matches).
- **Reproduced:** after "Update installed", `nextjs` was still image `upgtest-web:old`, never restarted; `scripts/`, `docker/`, `docker-compose.yml`, the Dockerfile's system packages and the Hardware Agent are never touched. This release has 158 changed files including new UI (payroll, batches, card fees).
- **Impact:** new backend + old frontend; migrations for features the customer cannot see.
- **Fix:** mark the in-app updater "API hot-fix only" or disable it until it can update images.

### H1 — HIGH — The release has no version of its own
- **Where:** `package.json:3`, `web/package.json:3`, `web/services/http.ts:10` (hard-coded `1.10.2`), `docker-compose.yml:36,94` (image tags fixed at `1.1.0`).
- **Evidence:** tag `v1.10.2` has 58 migrations; `main` has 68 and the same version. The local dev stack reports `1.10.2` with 64 migrations.
- **Impact:** the updater never offers it; support cannot tell builds apart; rebuilding overwrites the only image tag, so the previous image is gone unless tagged by hand.
- **Fix:** bump version at release; tag images with it; show version + schema level in About.

### H2 — HIGH — New migrations abort on data that older versions could store, and the store goes down
- **Where / reproduced:**
  - `059_inventory_cost_batches.sql:88-95` — a variant with negative stock and positive quarantine (or the reverse) → `inventory_batches_qty_on_hand_check` → abort at 059.
  - `061_weighted_average_and_receipt_layers.sql:74-76` — `quarantine_qty` (or `stock_qty`) NULL with stock > 0 → `cost_price` NULL → abort at 061 with 059–060 already applied.
  - `065_supplier_delivery_history.sql` `chk_po_item_cancelled_range` — a PO line received above its ordered quantity → abort at 065 with 059–064 applied.
- **Root cause:** 047/057 added their rules `NOT VALID`, so old bad rows exist legally; the new migrations assume clean data and have no pre-check.
- **Impact:** API crash-loops; with the new image already built there is no running old version to fall back to.
- **Fix:** a read-only preflight (queries in section E) run before the update; make the three statements tolerant (`GREATEST(…,0)`, `COALESCE`, `NOT VALID`).

### H3 — HIGH — No tested rollback a customer can perform
- **Where:** `server/backup/strategies/dbBackup.js:84-93` (`pg_restore -c --single-transaction` into the live schema), no down-migrations, fixed image tag.
- **Reproduced:** in-app restore of `BKP-2026-00001` on the upgraded store returned `200 queued`, then failed in the log; database unchanged. The working rollback needed `DROP SCHEMA public CASCADE`, `pg_restore`, and the old images.
- **Fix:** restore into an emptied schema (or a new database, then swap); keep the previous image; ship a rollback script.

### H4 — HIGH — The upgrade posts an accounting entry and changes the costing policy without asking
- **Where:** `server/index.js:171-178`, `server/services/inventoryValuationService.js:44-83`, `061_…sql:60-76`.
- **Measured:** ledger inventory 10330.60 vs stock book value 10498.58 → `JE-2026-00034`, DR Inventory 167.98 / CR Retained Earnings 167.98, dated the upgrade day. Existing journal rows, invoices and `cost_price` values were not modified.
- **Impact:** balance sheet changes on upgrade day; future COGS uses weighted average instead of latest purchase cost. Logged in the activity log, not shown to the user.
- **Fix:** tell the owner/accountant first; show the amount (the reconciliation report has it) and get agreement before delivery.

### M1 — MEDIUM — Every API start duplicates the 7 default root categories and overwrites their settings
- **Where:** `server/db/seedProducts.js:141-155` (`ON CONFLICT DO NOTHING` with no unique rule on `product_categories`).
- **Evidence:** 20 → 27 categories after one restart, 3 copies after two; the local dev database has 16 copies of each. The `UPDATE` also resets `description`, `requires_serial`, `sort_order` on every boot.
- **Not new in this release**, but every upgrade and restart triggers it.

### M2 — MEDIUM — Up to 60 s of "This connection isn't secure" after every start
- **Where:** `server/utils/trustProxy.js:16,47-66`; `docker-compose.yml:122-126` (Caddy starts only after the API is healthy, so the API cannot resolve `web-tls` at boot).
- **Evidence:** log `cannot resolve "web-tls": EAI_AGAIN`, all requests 403 `https_required` until the next 60 s refresh.

### M3 — MEDIUM — Update integrity
- **Where:** `scripts/applyUpdate.js:340-351` (GitHub source archive of a tag, checksum only if `UPDATE_EXPECTED_SHA256` is set by hand), `:373-400` (`npm ci`, falling back to unlocked `npm install`, from the public registry at update time).
- **Good:** Admin-only (`server/controllers/updateCheckController.js:8-16`), target version comes from the server's own check, not the client; `.env` and secrets are not touched.
- **Gap:** no signature; anyone who can push a tag to the repo ships code to the shop; dependencies are resolved live.

### M4 — MEDIUM — The automatic pre-migration backup is weaker than it looks
- Database only (no uploads, no `.env`, no certs); not verified after writing; stored on the same Docker volume as everything else; finishes `partial` with a critical "Backup failed (No USB drive detected)" notification on a default install (seen in test); encryption is off by default although `migrate.js:11` says it is encrypted. A crash-loop takes a new one each loop.

### M5 — MEDIUM — No lock around the migration runner
- `server/db/migrate.js` — two runners at once: one finished, the other died with `duplicate key … pg_class_relname_nsp_index`. Database ended consistent (68). Harmless with one API container; a crash if someone runs `npm run migrate` while the API boots.

### M6 — MEDIUM — Upgrade from v1.10.0 or older changes how tills reach the server (not tested)
- v1.10.0: web on `WEB_PORT` plain HTTP, API published to the LAN. Now: Caddy on 80/443, HTTP redirects to HTTPS, API bound to `127.0.0.1`. Every till needs `https://SERVER_IP` and a one-time certificate trust (`docs/HTTPS_SETUP.md`); firewall needs 443. Migration `056` can abort if a customer has a negative `credit_balance`; `051` signs out sessions older than 12 h (code review).

### Low
- `docker/Caddyfile:9` — the port-80 redirect drops a non-default `WEB_TLS_PORT` (test: `http://127.0.0.1:18080` → `https://127.0.0.1/`).
- `README.md` §2, B.3, B.6, D.7 still describe the pre-HTTPS layout (Next.js on :80, API on the LAN) — wrong instructions for whoever does the upgrade.
- The UI sends `X-App-Version`; the server ignores it — no compatibility check in either direction.

---

## D. Upgrade compatibility matrix

| Pair | Result | Basis |
| --- | --- | --- |
| Old app (v1.10.2) → new app, full rebuild | **Works** | Tested twice |
| Old database (58) → new migrations (68), clean data | **Works**, per-file atomic | Tested twice |
| Old database → new migrations, dirty data | **Aborts**, store down, resumable after repair | Tested (3 cases) |
| Old frontend + new backend | Runs at API level; new features invisible | Tested by API only |
| New frontend + new backend | **Works** at API/HTTP level | Tested; browser not tested |
| **Old backend + new database** | **Runs and silently corrupts inventory book values** | Tested |
| New frontend + old backend | Not tested (new pages call endpoints that do not exist) | Inferred |
| Old configuration (`.env`, ports, cert, volumes) → new | **Reused unchanged** from v1.10.2 | Tested |
| Old configuration from ≤ v1.10.0 → new | Needs manual network/till changes | Code review only |
| Existing store → new setup logic | **Wizard does not appear**, no second admin | Tested |

### D2. Every difference found after the upgrade (v1.10.2 → main)
`_migrations` +10 · `chart_of_accounts` +5 accounts (1006, 2004, 2005, 5017, 5018) · `permissions` +5 · `journal_entries` +1 / `journal_lines` +2 (H4) · `journal_entry_sequence` 33 → 34 · `product_categories` +7 duplicates (M1) · `backup_jobs` +1 · `document_sequences` +1 (BKP) · `notifications` +1 (backup "failed") · `activity_log` +3 · `user_sessions` 2 rows marked offline. No pre-existing row changed in any other table; no column dropped; 0 unbalanced journal entries; all 8 uploaded files and the TLS cert/key identical.

---

## E. Required fixes before release (in order)

1. **Find out which version the customer runs** (Settings → About, or `docker compose exec express-api node -p "require('./package.json').version"` and `SELECT count(*), max(filename) FROM _migrations`). If it is ≤ v1.10.0, run this same simulation from that tag first.
2. **Do not use the in-app updater for this release.** Deliver by full rebuild.
3. **Add a start-up guard**: the API refuses to start when the database has migrations the build does not know (closes C1's worst outcome).
4. **Bump the version** (root, web, `http.ts`, image tags) and tag the previous images before building.
5. **Run a read-only preflight on the customer's database** and fix what it finds before updating:
   ```sql
   SELECT count(*) FROM product_variants WHERE COALESCE(stock_qty,0) < 0 OR COALESCE(quarantine_qty,0) < 0;
   SELECT count(*) FROM product_variants WHERE stock_qty IS NULL OR quarantine_qty IS NULL;
   SELECT count(*) FROM purchase_order_items WHERE quantity_received > quantity;
   SELECT count(*) FROM customers WHERE credit_limit = 0 AND credit_balance < 0;  -- only if coming from <= v1.10.0
   ```
6. **Take a backup that leaves the server** (database dump + `api_uploads` + `.env`) and confirm it restores on another machine.
7. **Tell the owner/accountant about the inventory valuation entry** (H4) and agree the date.
8. Fix the category seed (M1) and the 60-second HTTPS refusal (M2).
9. Fix in-app restore (H3) and write the rollback steps that were proven here into `docs/RELEASE.md`.
10. Update `README.md` Part B/D to the HTTPS layout.

---

## F. Recommended zero-data-loss upgrade architecture

1. **Versioned images, not file swaps.** CI builds `bytecrapos-api:<version>` and `bytecrapos-web:<version>` and pushes them to a registry (or attaches `docker save` archives to the release, with SHA-256 and a signature). The server pulls; nothing compiles in the shop.
2. **One release manifest** per version: image digests, `schemaLevel` (last migration), `minUpgradableFrom`, required env keys. The updater refuses anything that does not match.
3. **A small host-side updater** (a Compose service with the Docker socket, or a scheduled script) does the work, because a container cannot replace itself: preflight → backup → pull → stop app → migrate → start → health check → commit or roll back.
4. **Preflight** (read-only): disk space, `.env` keys, data checks from section E, current version in the allowed range. Fails before anything changes.
5. **Verified backup**: dump + uploads to a second location, then `pg_restore --list` and a restore into a scratch database; record its checksum.
6. **Migrations as a separate, locked step**: `pg_advisory_lock` around the runner; run in a one-off container of the new image before the new API starts; the API only checks `schemaLevel`.
7. **Schema guard both ways**: API refuses a database that is newer or older than it supports; the UI and API exchange versions and show "reload" on mismatch.
8. **Automatic rollback**: if migrate or the health check fails, restore the verified backup into an emptied database and start the previous image tags, which are kept for at least one release.
9. **Expand/contract migrations** so the previous version can still run for one release where possible.
10. **CI upgrade test**: the harness used here (seed old release → snapshot → upgrade → diff → trade → rollback) run on every release tag, from each supported starting version.

---

## G. Release acceptance checklist

| Requirement | Result |
| --- | --- |
| Existing database volume reused, no new empty database | PASS (v1.10.2 path) |
| All pre-existing business rows unchanged | PASS |
| Invoice, payment, balance, stock, drawer, bank totals unchanged | PASS |
| No historical journal row modified | PASS |
| No new financial entries created by the upgrade | **FAIL** (one correction entry, H4) |
| Referential integrity / balanced journals after upgrade | PASS |
| Uploaded files and TLS certificate preserved | PASS |
| Setup wizard does not reappear; no second admin/store | PASS |
| Accounts, passwords, roles work | PASS |
| Existing `.env` reused, no new required variable | PASS (from v1.10.2) |
| Migrations atomic per file and resumable | PASS |
| Migrations tolerate dirty legacy data | **FAIL** (H2) |
| Seeds do not alter customer data | **FAIL** (duplicate categories, M1) |
| Two tills trade after upgrade (API level) | PASS |
| Upgraded UI works in real browsers | NOT TESTED |
| Thermal printing / Hardware Agent | NOT TESTED |
| One-click in-app update of the whole product | **FAIL** (C1, C2, H1) |
| No unsafe mixed-version state possible | **FAIL** (C1) |
| Pre-upgrade backup taken automatically | PASS (database only, unverified) |
| Backup restorable from the app after upgrade | **FAIL** (H3) |
| Manual rollback (old images + backup) | PASS |
| Concurrent migration runners prevented | **FAIL** (M5) |
| Release artifact integrity verified | **FAIL** (M3) |
| Upgrade from ≤ v1.10.0 | NOT TESTED |
| Power loss / disk full during upgrade | NOT TESTED |
| Containers restart after Windows reboot | NOT TESTED (restart policy present in Compose) |

---

## H. Go / No-Go

- **NO-GO** for delivering this release through the in-app updater, or for letting the customer update on their own.
- **CONDITIONAL GO** for a developer-run full update, **only if the customer is on v1.10.1 or v1.10.2**, and only after the minimum set below:
  1. Customer version confirmed.
  2. Preflight queries return 0 on the customer's database (or the data is corrected).
  3. Off-server backup of database, uploads and `.env`, restore-tested.
  4. Current images tagged (`docker tag bytecrapos-api:1.1.0 bytecrapos-api:pre-upgrade`, same for web) before `up -d --build`.
  5. Owner informed of the inventory valuation entry.
  6. Update done outside trading hours, with the rollback steps from section B#10 at hand.
- **NO-GO / not certified** if the customer is on v1.10.0 or older, until the same simulation is run from that tag.

## Test artefacts

Harness and outputs are in the session scratch folder (temporary): `seed.mjs`, `seed2.mjs`, `snapshot.mjs`, `diff.mjs`, `rowdiff.mjs`, snapshots before/after/rollback, the old dump. Test stacks `upgtest` and `upgtest2` are stopped; remove them with `docker compose -p upgtest down -v` and `docker compose -p upgtest2 down -v` (these touch only the test volumes).
