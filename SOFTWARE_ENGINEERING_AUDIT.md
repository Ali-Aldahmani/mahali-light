# Software Engineering Audit — Bytecra POS

| | |
|---|---|
| Date | 2026-11-22 |
| Revision audited | `main` at `fbc3add` (package version 1.11.0, 69 migrations) |
| Scope | Whole repository: `server/`, `shared/`, `web/`, `server/db/`, `scripts/`, `tests/`, `docker/`, compose, CI, `hardware-agent/`, `backend-fastapi/`, documentation |
| Mode | Read-only. The only file written is this report. No application, configuration, database, or deployment change was made. |

---

## 0. Method, evidence and coverage

### 0.1 How the audit was done

1. **Inventory.** I built the inventory from `git ls-files`: 1,194 tracked files. The main areas are 378 frontend component files, 90 app-route files, 62 controllers, 54 routers, 54 services, 69 SQL migrations and 109 root test files.
2. **Subsystem review.** Five reviewers each read one subsystem in parallel:
   - money and stock transaction paths;
   - backend architecture and cross-cutting concerns;
   - database and migrations;
   - frontend;
   - infrastructure, tests, docs and sidecars.

   Each reviewer was told to cite file and line and to look for mitigations before reporting.
3. **Re-checking.** I re-read the code behind every High or Critical finding and most Medium findings before including them. Findings I could not re-check are labelled **Needs Verification**.
4. **Safe tooling.** I ran only safe, non-destructive tools:

| Check | Command | Result |
|---|---|---|
| Frontend type-check (project settings) | `npx tsc --noEmit --incremental false` in `web/` | **0 errors** |
| Frontend type-check with `--strict` | same, plus `--strict` | **1,226 errors**: 455 TS7006 implicit any, 316 TS2339, 202 TS7031, 126 TS2322, … |
| Backend tests, no database | `vitest run` with the DB probe pointed at a closed port | **291 passed, 563 skipped** (39 files ran, 69 DB-backed files skipped) |
| Frontend tests | `npm --prefix web test` | **272 passed** (38 files) |
| Backend `require` graph | custom script over 232 files in `server/` and `shared/` | **0 cycles**. Highest fan-in: `db/postgres.js` (109), `shared/errorCodes.js` (101) |
| Layering counts | grep | SQL in **42 of 62** controllers. ~464 SQL statements in controllers vs ~838 in services. **No** service reads Express `req`/`res`. |
| Lint configuration | `git ls-files \| grep -i eslint\|prettier\|editorconfig` | **None**. `web/next.config.mjs` sets `eslint.ignoreDuringBuilds: true` |

Not run:
- The PostgreSQL-backed suites (69 files). They create and drop databases on whatever server is reachable, so they were deliberately skipped.
- `npm audit` / `npm outdated`, which need the network.
- Docker builds, and anything against a database.

No coverage percentage is reported, because none was measured (see F-TST-03).

> **Note on one test.** `tests/contracts/slice01.readonly.test.js` loads the real `.env` and queries that database whatever the skip settings say (F-TST-01). During my run nothing was listening on 127.0.0.1:5432, so the test took its "unreachable" branch and touched no database.

### 0.2 Coverage record

| Area | Coverage |
|---|---|
| Money and stock services and controllers (invoice, return, cash, stock, batch, journal, bank, bill, supplier payment, PO, customer, expense, fee, COGS) | Read in full |
| `server/db/` | All 69 migrations, `migrate.js`, `postgres.js`, `seed*.js` read in full |
| `server/index.js`, middleware, socket, jobs, backup, utils, `shared/`, `scripts/applyUpdate.js` | Read in full or in large part |
| Other controllers (~40) | Characterised by grep and counts. Not read line by line. IDOR checks inside `usersController`, `rolesController`, `customersController` and `productsController` were **not** verified line by line. |
| `reportService.js` (2,765 lines), `analyticsService.js` (1,312) | Sampled: interpolation sites, loops, limits |
| `warrantyService.js`, `attendanceService.js`, `leaveService.js`, `payrollService.js`, `notificationService.js`, `forecastService.js` | **Not reviewed in depth** (grep only) |
| Frontend | All layouts, the API layer, auth/pos/socket stores, POS, Cashier, returns wizard, invoice detail, customer detail and products page read in full. About 55 of 70 pages and most of `components/mobile`, `charts`, `analytics`, `reports`, `finance` and `purchases` were **not** read. |
| Tests | Setup files, the concurrency tests and the heads of the main integration suites were read. The rest was assessed by grep. |
| Docs | README, `docker/README.md`, `docs/HTTPS_SETUP.md` and `docs/RELEASE.md` read. `docs/SETUP_GUIDE.md`, `SHOP_MULTI_PC.md` and `docs/archive/**` skimmed. `API-doc.md` (44,623 lines): header and targeted greps only. |
| Deliberately not opened | `.env`, `setup-code.txt`, `tmp/clickthrough-test-users.txt` (may contain credentials) |
| Not verified at runtime | Device trust of the self-signed certificate, Windows printing, the current behaviour of in-app restore, and every "Likely" impact below |

---

## A. Executive summary

Bytecra POS is a **serious, deliberately engineered system that is weaker at its edges than at its core.**

### Where it is strong

The core of the money and stock logic is better than most commercial POS code:
- every money and stock path that must be atomic runs in one PostgreSQL transaction;
- oversell, double payment and double refund are blocked by row locks **and** database constraints;
- checkout is idempotent end to end (client `checkoutId`, payment keys, server advisory lock, unique indexes);
- the ledger is forced to balance by a deferred constraint trigger;
- money is `NUMERIC` everywhere, timestamps are `timestamptz`, and document numbers are unique;
- integration tests run against a real, freshly migrated PostgreSQL in CI.

Authentication, authorization, socket scoping and backup encryption are also thoughtfully done.

### Where it is weak

The weaknesses are concentrated in four places:

1. **Updating and recovering an installed shop (Critical/High).**
   - The in-app updater writes new code into the container's writable layer. Any container recreate silently runs old code against a newer schema, and nothing at boot detects it.
   - Downloads are not signed. After a successful swap there is no way back.
   - Several released migrations abort on legacy data that earlier `NOT VALID` constraints let survive, and an aborted migration puts the server into a crash loop.
   - The backups sit on the same Docker volume set as the database they protect.
   - Restore has never been tested against a real `pg_restore`.
2. **Operational robustness.**
   - There is no graceful shutdown, and no statement, lock or idle-transaction timeout.
   - A pool of 10 connections can be drained by a single global search.
   - Fatal errors are logged and the process keeps running.
   - Lock ordering between flows is inconsistent, which gives deadlock risk, and most flows have no retry.
3. **Layering and size.**
   - 42 of 62 controllers contain SQL, and several are complete workflows (stock adjustments, counts, supplier returns, treasury transfers).
   - Functions of 200–630 lines carry the most important business rules.
   - Rules are duplicated: money rounding exists in 3 server variants and 2 client variants, VAT is computed in 9 places, and supplier returns are posted two different ways with different payable amounts.
4. **Frontend and developer tooling.**
   - The frontend is a client-side SPA inside the App Router. TypeScript is non-strict and ESLint is absent, so 87 `exhaustive-deps` suppressions are not enforced; one of them hides a real stale-closure bug in the admin POS.
   - Two POS implementations have drifted apart.
   - Customer data is cached into `localStorage` and never cleared.
   - The cart survives sign-out.
   - The README contradicts the actual Docker/HTTPS topology. Root-level audit files, an Electron-era release guide and a 1.6 MB hand-maintained API document confuse onboarding.

### Verdict

**Preserve the architecture and refactor incrementally.** Nothing here calls for a redesign, microservices, an ORM or a new state library. The P0 list in section G is short and concrete. Most of it guards existing installations against update and recovery failures; none of it involves rewriting business logic.

---

## B. Engineering scorecard (0–10)

| Category | Score | Evidence |
|---|---:|---|
| Repository organization | **5** | Clear top-level split (`server`, `web`, `shared`, `server/db`, `tests`, `docker`) and conventional `routes`/`controllers`/`services`. Pulled down by 8 report files and a 1.6 MB API doc at the root, tracked build artefacts (`web/tsconfig.tsbuildinfo`), Electron/NSIS/PM2 leftovers, an unwired FastAPI tree (~900 lines) and tests named after audit rounds (`reviewSales`, `auditPhase2`). |
| Software architecture | **6** | A modular monolith suits a single-shop LAN POS. No circular dependencies. `shared/` policy modules are used by both server and tests. Transaction boundaries are mostly correct. Layering is a convention rather than a structure (F-ARC-01). |
| Backend engineering | **6** | Excellent locking, idempotency and authorization on core paths. Weak on shutdown, timeouts, deadlock ordering, error classification, and controllers that hold whole workflows. |
| Frontend engineering | **5** | A good HTTP layer, checkout recovery, socket lifecycle and stale-response guards. Against that: non-strict TS (1,226 strict errors), no linter, 1,178 `: any`, two divergent POS screens, 1,000–1,467-line page components, and session-state leakage. |
| Database engineering | **7** | NUMERIC money, timestamptz, UUIDs, unique document numbers, a balancing trigger, an append-only activity log, CHECKs on stock and balances, clean-before-constrain migrations, and a pre-migration backup. Pulled down by `NOT VALID` constraints that are never validated, no newer-schema guard, no runner lock, CASCADE on ledgers and no DB timeouts. |
| Code quality | **5** | Readable code with unusually good comments explaining *why*. Pulled down by 17+ functions over 150 lines (largest ~630), duplicated rounding/VAT/emit payloads and three styles of zod error handling. |
| Modularity | **5** | Services are reusable without HTTP (good). Many rules live only in controllers or are copy-pasted between services (supplier returns, same-day reversal, treasury emits). |
| Maintainability | **5** | A new engineer can follow a flow, because comments are rich and naming is consistent. Large files, type looseness and documentation drift raise the cost of every change. |
| Testability | **6** | Real-DB integration tests with very little mocking, and a real two-connection race test. CI forces the DB suites to run. Pulled down by: coverage measuring 3 files, no restore or upgrade test with data, a test that reads the real `.env`, 69 copy-pasted DB bootstraps, and no end-to-end checkout test in a browser. |
| Dependency management | **6** | Every root runtime dependency is used. Lockfiles exist for both packages. Pulled down by `multer` 1.x (deprecated, with known vulnerabilities patched in 2.x), undeclared `drivelist` and `unzipper`, a vitest major-version split, CI using `npm install`, and no Python lock. |
| Performance | **7 (not measured)** | No measured bottleneck. Batch loaders and CTEs avoid N+1 in product queries. Theoretical risks: global search fans out 8 parallel queries against a 10-connection pool; 4 queries per authenticated request; full catalogue and customer download on every dashboard mount. |
| Reliability | **4** | Health-gated start ordering, `restart: unless-stopped`, a pre-migration backup and DB-wait on boot are good. Against that: no graceful shutdown, fatal errors swallowed, no DB timeouts, an updater with no rollback that diverges on container recreate, migrations that can crash-loop on legacy data, backups co-located with the DB, and an untested restore. |
| Security | **7** | Hashed session tokens, rotation, absolute session lifetime, login lockout with dummy bcrypt, route-permission contract test, socket audience enforcement, HTTPS-only from the LAN, Postgres not published, no shell-built commands, AES-256-GCM backup encryption. Pulled down by unsigned updates, the deprecated multer, backups unencrypted by default, an ML sidecar exposed to the LAN with every secret, and customer PII left in browser storage. |
| Documentation | **3** | `docker/README.md` and `docs/HTTPS_SETUP.md` are good. The README describes ports and URLs that the compose file no longer uses. `docs/RELEASE.md` describes an Electron/NSIS process. `API-doc.md` is a stale 1.8.0.1 snapshot. Many env vars are undocumented or documented but unread. References to non-existent files. |
| Production readiness | **4** | The day-to-day selling path is solid. The update, upgrade and recover lifecycle of an *existing customer installation* is not yet safe enough to call the product production-ready for unattended shops (section J-10). |

Scores for Performance and parts of Reliability are based on code reading, not measurement.

---

## C. Findings

**Legend**

- **Severity:** Critical / High / Medium / Low.
- **Confidence:**
  - **Confirmed**: the code was read and the behaviour is unambiguous.
  - **Likely**: the mechanism is confirmed but the impact was not reproduced.
  - **Needs Verification**: not fully confirmed.
- **Effort:** S < 1 day, M 1–3 days, L 1–2 weeks, XL longer.
- Line numbers refer to the audited revision.

### C.1 Update, upgrade and recovery lifecycle

#### F-UPD-01 — In-app update installs into the container's writable layer; a container recreate reverts code but not schema
- **Category:** Deployment / data integrity · **Severity:** Critical · **Confidence:** Confirmed (mechanism). An earlier internal audit reports reproducing the consequence.
- **Where:**
  - `scripts/applyUpdate.js:274-315` swaps `server`, `package.json`, `shared`, `package-lock.json` and `node_modules` under `/app`.
  - `scripts/applyUpdate.js:431-437` restarts with `process.kill(1,'SIGTERM')`.
  - `Dockerfile:61-65` bakes the code into the image.
  - `docker-compose.yml:70-73` declares only uploads, backups and TLS as volumes.
  - `server/db/migrate.js:67-73` looks only for *pending* files.
- **Description:** After an in-app update, the running container holds the new code in its writable layer while the image still holds the old code. Recreating the container brings back the image's code; the README itself tells operators to run `docker compose up -d` after changing the IP (`README.md` ~742). That old code then starts against a database already migrated forward, and nothing refuses to boot. The `nextjs` image is never updated by this path, so the UI and API versions also diverge (`README.md:682-684`).
- **Root cause:** a source-swap updater designed for a native/PM2 install was carried into an image-based deployment.
- **Impact:** old business logic writes to a newer schema. Columns, triggers or constraints it does not know about can produce wrong postings or failed sales. The earlier audit (`UPGRADE_SAFETY_AUDIT_2026-11-17.md`) reports stock and batch drift reproduced this way.
- **Recommended solution:**
  1. Immediately, add a boot guard in `runMigrations`: if `_migrations` contains filenames this build does not ship, refuse to start with a clear message, with an explicit override env var for deliberate rollbacks.
  2. Make "Install update" notify-only until updates ship as versioned images (`image: bytecrapos-api:${VERSION}`, updated with `docker compose pull && up -d`).
- **Risk of change:** guard Low. Changing the delivery model Medium (release process).
- **Effort:** guard S. Image-based updates L.
- **Regression tests:**
  - Migrate a DB, remove the last migration file, and assert boot fails with the guard message.
  - Assert the override env var allows boot.

#### F-UPD-02 — Update downloads are not authenticated, and dependency install can fall back to an unlocked `npm install`
- **Category:** Supply chain / security · **Severity:** High · **Confidence:** Confirmed.
- **Where:**
  - `scripts/applyUpdate.js:340-351` downloads the tag tarball.
  - The only integrity check is the optional static `UPDATE_EXPECTED_SHA256` (`:105`, `:168`).
  - `server/services/updateInstallState.js:92-112` (`verifyReleaseDir`) only checks that `package.json` and `server/index.js` exist.
  - `scripts/applyUpdate.js:378-397` falls back to `npm install --omit=dev` when `npm ci` fails.
- **Description:** Anyone who controls the repository, the tag, or the `UPDATE_REPO`/`UPDATE_CHECK_URL` configuration can execute code on the machine that holds the financial database. The `npm install` fallback installs dependency versions that were never tested, live from the registry, with lifecycle scripts.
- **Root cause:** TLS to GitHub is treated as sufficient authenticity.
- **Impact:** remote code execution through a compromised release channel, and non-reproducible production installs.
- **Recommended solution:**
  - Publish a signed manifest (ed25519/minisign) per release and bake the public key into the image; verify it before extraction.
  - Remove the `npm install` fallback: fail the update, or ship `node_modules` in the artifact. This becomes moot if F-UPD-01 moves to images.
- **Risk:** Medium (release process change). **Effort:** M.
- **Regression tests:** a tampered tarball is rejected; a mismatched lockfile fails the update instead of installing unlocked.

#### F-UPD-03 — No rollback after a successful swap; a failing new version crash-loops
- **Category:** Reliability · **Severity:** High · **Confidence:** Confirmed.
- **Where:**
  - `scripts/applyUpdate.js:311-314` deletes the rollback copies immediately after the swap.
  - `server/index.js:471-475` runs `bootstrap().catch(...)` → `process.exit(1)`.
  - `restart: unless-stopped` in compose.
- **Description:** If the new version fails at boot (a migration error, a missing native module), the container restarts forever on new code, and the old code is already gone. The database itself is protected by the pre-migration backup and one-transaction-per-migration.
- **Recommended solution:** keep the `.update-rollback-*` directories until the new process reports healthy (`finalizeIfNeeded` at boot, not only on `GET /status`). Add a boot-failure counter that restores them.
- **Risk:** Medium. **Effort:** M.
- **Regression tests:** in the existing `applyUpdate.e2e.test.js` style, make the new `server/index.js` throw and assert that the old tree is restored.

#### F-UPD-04 — Update runs against live tills with no maintenance window, and the install lock can stick
- **Category:** Reliability · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `server/services/updateCheckService.js:197-239` spawns the runner immediately.
  - `scripts/applyUpdate.js:280-297` swaps files under the live process.
  - `server/services/updateInstallState.js:59-71`: the lock has no staleness check.
  - `updateCheckService.js:243-268`: finalize runs only on `GET /status`.
- **Description:** There is no broadcast, no maintenance mode and no open-drawer check. The 26 lazy `require`s can load new files into the old process mid-swap. If the runner dies, status stays `downloading` and every later install is refused.
- **Recommended solution:** enter maintenance mode and broadcast before the swap; finalize at boot; treat a lock whose PID is dead as stale.
- **Risk:** Low. **Effort:** S–M.
- **Regression tests:** a stale lock with a dead PID is cleared; `install` while maintenance is active is refused.

#### F-MIG-01 — Released migrations abort on legacy data that earlier `NOT VALID` constraints let survive
- **Category:** Upgrade safety · **Severity:** High · **Confidence:** Likely (the earlier audit reproduced 059/061/065; the others follow from the SQL).
- **Root cause:** `047_financial_constraints.sql:37` and `057_more_database_rules.sql:29` add 23 CHECKs as `NOT VALID` and never validate them. PostgreSQL still enforces a `NOT VALID` check on any UPDATE of an existing row, and later migrations add fully validated constraints that assume clean data.
- **Where it bites:**

| Migration | What fails |
|---|---|
| `056_credit_limit_null_unlimited.sql:10` | The UPDATE fails for any customer with a negative `credit_balance`. |
| `059_inventory_cost_batches.sql:86-95` | Opening batches violate `qty_on_hand >= 0` / `unit_cost >= 0` (`:25-27`). |
| `061_weighted_average_and_receipt_layers.sql:62-72` | The UPDATE touches **every** variant, so any variant with negative stock, cost or price fails its 047/057 check. |
| `061:74-76` | The NULL quantity in the divisor yields a NULL `cost_price` (a NOT NULL column). |
| `062_expense_input_vat.sql:11` | A validated CHECK fails on an old negative expense. |
| `063_payroll.sql:19-23` | A validated CHECK fails on a negative salary. |
| `065_supplier_delivery_history.sql:75-80` | A validated CHECK fails where `quantity_received > quantity`. |

- **Impact:**
  - A failed migration exits the process (`server/index.js:471-475`) and the shop's server crash-loops.
  - Each loop re-runs the pre-migration backup (`migrate.js:71-73`), consuming disk.
  - Only shops with legacy dirty data are affected, which are exactly the long-running customers.
- **Recommended solution:**
  - Ship a read-only **pre-upgrade preflight** that checks exactly these predicates, using and extending `scripts/reconcile.js`. Make the updater refuse to proceed when it fails.
  - For installs not yet past these files, add a new cleaning migration that sorts before them only if your numbering allows; otherwise guard with COALESCE/GREATEST.
  - Do not edit already-applied files.
- **Risk:** Medium (data repair decisions need the business owner). **Effort:** M.
- **Regression tests:** migration tests using `stopBefore` (the pattern in `pricingRestrictionsMigration.test.js`). Seed each dirty-row shape at the prior schema, then migrate forward and assert either success or a clean preflight refusal.

#### F-MIG-02 — No lock around the migration runner
- **Category:** Database / concurrency · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `server/db/migrate.js:49-105`.
- **Description:** Multi-instance mode is supported (`064_presence_cluster.sql`, `SOCKET_CLUSTER=postgres`), and `npm run migrate` can overlap a boot. Each file is transactional, so a race causes a crash rather than corruption, but both runners take a backup.
- **Recommended solution:** `pg_advisory_lock` on the dedicated client around the backup and the loop, then re-read `_migrations`.
- **Risk:** Low. **Effort:** S.
- **Regression tests:** two concurrent `runMigrations` calls both succeed and each file is applied once.

#### F-MIG-03 — Permissions introduced by migrations 060 and 063 are never granted on upgraded installs
- **Category:** Authorization / upgrade · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `server/db/migrations/060_payment_processing_fees.sql:83-85` and `063_payroll.sql:135-140` insert permission keys with no `role_permissions` rows.
  - `server/db/seed.js:140-200` grants a key only if this boot *created* it (`RETURNING (xmax = 0)`) or the role has no grants at all.
- **Description:** On a fresh install Admin receives `payroll.*` and `finance.manage_payment_fees`. On an upgraded install nobody does, Admin included, until someone edits roles by hand. Other migrations (042, 048, 054, 055, 058, 069) correctly grant their keys.
- **Recommended solution:** a new migration that grants these keys to Admin (and to other roles per policy).
- **Risk:** Low. **Effort:** S.
- **Regression tests:** migrate to 059, seed, migrate to head, and assert Admin holds the payroll and fee keys.

#### F-MIG-04 — `seedProducts.js` inserts duplicate root categories on every boot and overwrites user edits
- **Category:** Data integrity · **Severity:** High · **Confidence:** Confirmed.
- **Where:**
  - `server/db/seedProducts.js:139-156`: `INSERT … ON CONFLICT DO NOTHING`, but `product_categories` has no unique constraint (`002_products.sql:3-14`), so nothing ever conflicts. The following UPDATE resets `description`, `requires_serial` and `sort_order`.
  - The seed runs on every start (`server/index.js:169`).
  - `ensureAttributes` also overwrites `unit` and re-inserts deleted defaults.
- **Impact:** category lists grow by seven duplicates per restart, and shop owners' category settings, including `requires_serial` (which affects warranty and serial capture), are silently reverted.
- **Recommended solution:** seed reference data once (only when the table is empty, or in a migration). De-duplicate by re-pointing `products.category_id` and `category_attributes`, then add a unique index on `(lower(name), parent_id)`.
- **Risk:** Medium (the de-duplication touches product rows). **Effort:** M.
- **Regression tests:** boot twice and assert the category count is unchanged; edit `requires_serial`, reboot, and assert the edit persists.

#### F-BAK-01 — Backups share the database's volume lifecycle; USB backup cannot work
- **Category:** Recovery · **Severity:** High · **Confidence:** Confirmed (configuration). Consequence Likely.
- **Where:**
  - `docker-compose.yml:163-168`: `postgres_data`, `api_uploads` and `api_backups` are all named volumes on the same Docker disk.
  - `docker/README.md:161`: `-v` deletes them all.
  - `server/backup/destinations/usbDestination.js:4-10` needs `drivelist`, which is not declared in `package.json`.
  - NAS needs a host mount that compose does not define.
- **Impact:** `docker compose down -v`, a Docker Desktop reset or a lost WSL2 disk destroys the database and every in-app backup together. The default install has no off-host copy.
- **Recommended solution:** bind-mount `api_backups` to a host folder (ideally a second disk), document a NAS mount, and make "off-host destination configured" a setup checklist item and a dashboard warning. Either remove the USB destination or declare its dependency.
- **Risk:** Low. **Effort:** S–M.
- **Regression tests:** backup to a bind-mounted path, then delete the volumes, then restore from that path (manual drill plus a scripted CI job if feasible).

#### F-BAK-02 — Restore has no safety net and has never been tested against real `pg_restore`
- **Category:** Recovery · **Severity:** High · **Confidence:** Confirmed (code). The current runtime result Needs Verification.
- **Where:**
  - `server/backup/backupService.js:506-647`: no pre-restore snapshot; uploads extracted over the live directory (`:597`); maintenance mode is an in-memory HTTP flag only (`maintenanceMode.js:4-53`), so jobs and socket sweeps keep querying.
  - `server/backup/strategies/dbBackup.js:84-92` uses `-c --if-exists --single-transaction --exit-on-error`.
  - `tests/unit/dbRestore.test.js` and `tests/integration/backupEncryption.test.js` stub `pg_dump`/`pg_restore`.
  - The earlier audit records a real restore failing with `cannot drop constraint users_pkey`.
  - `extractZip` depends on `unzipper`, which is undeclared and resolves only transitively through `exceljs`.
- **Impact:** the one operation a shop needs after a disaster is unproven. A failed restore can leave a partially restored uploads tree.
- **Recommended solution:**
  - Add a CI job that seeds a DB, runs a real `pg_dump` through the app's backup path, restores into a fresh DB and compares row counts and balances.
  - Take a `pre-restore` backup inside the lock.
  - Extract uploads to a sibling directory and rename it into place.
  - Pause schedulers while maintenance is active.
  - Declare `unzipper`.
- **Risk:** Low–Medium. **Effort:** M.
- **Regression tests:** the real dump-and-restore round trip described above, plus "restore over a DB that has newer rows".

#### F-BAK-03 — Backup encryption off by default; the backup secret's placeholder is accepted
- **Category:** Security · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `server/db/migrations/017_backup.sql:63` (`encryption_enabled` default false).
  - `server/index.js:147-160` checks only that `MAHALI_BACKUP_SECRET` is present; unlike the JWT check at `:118-145`, it has no placeholder or length check.
  - The Telegram bot token is stored in plaintext (`036_telegram_stock_alerts.sql:8`).
- **Recommended solution:** reject placeholder or short secrets; default encryption on for new installs; encrypt the bot token with the existing helper.
- **Risk:** Low. Old plaintext archives still restore. **Effort:** S.
- **Regression tests:** boot rejects the `.env.example` placeholder; a new install's backup settings have encryption on.

#### F-BAK-04 — Off-site copies are fragile and never pruned; retention can delete the last good set
- **Category:** Recovery · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `server/backup/destinations/nasDestination.js:39-45`: 30 s copy timeout while the job's `finally` deletes the temp dir (`backupService.js:444-446`).
  - `server/backup/retention/retentionManager.js:31-66`: local destination only, age-based only.
  - `backupService.js:400-406`: retention runs even when the local save failed.
- **Recommended solution:** a size-scaled timeout; copy to `*.partial` and rename; retention per destination with a minimum-copies floor; skip retention after a failed save.
- **Risk:** Low. **Effort:** S–M.
- **Regression tests:** retention with N failed saves keeps the last K good archives.

#### F-BAK-05 — Backup and restore resolve the uploads folder differently from the app
- **Category:** Correctness · **Severity:** Medium (native installs only) · **Confidence:** Confirmed.
- **Where:** the app uses `server/utils/paths.js:5-10` (`UPLOADS_DIR` or `<repo>/uploads`); backup uses `server/backup/strategies/uploadsBackup.js:8-11` (`MAHALI_UPLOADS_DIR` or `cwd/uploads`).
- **Description:** Docker sets both variables, so Docker installs are fine. A native install that sets only one, or starts from another working directory, gets a "completed" backup of an empty folder.
- **Solution:** have `uploadsDir()` call `getUploadsRoot()`.
- **Risk:** None. **Effort:** S.
- **Tests:** with only `UPLOADS_DIR` set, the uploads backup contains the file.

### C.2 Transactions, concurrency and money integrity

#### F-TX-01 — Inconsistent lock ordering across money and stock flows; deadlock retry only on four invoice paths
- **Category:** Concurrency · **Severity:** Medium (High on a busy multi-till day) · **Confidence:** Confirmed by reading; not reproduced.
- **Where:**
  - `server/services/journalService.js:218-229`: `nextEntryNumber` upserts one row per year, so it acts as a global mutex held until commit.
  - Sale confirm locks the drawer and then the journal (`invoiceService.js:733` → `:792`). Return approve locks the journal and then customer/drawer (`returnService.js:1162` → `:1238`/`:1270`). That is an ABBA cycle. `supplierPaymentService.js:313`→`:324` repeats it.
  - Variants are locked unsorted in return approve, PO receive (`purchaseOrderService.js:251-307`) and supplier return create (`supplierReturnsController.js:315-366`). Sales lock them sorted (`stockService.js:517`).
  - The two treasury transfers lock in opposite orders (`cashDrawerController.js:257-268` vs `bankAccountsController.js:295-324`).
  - `retryOnDeadlock` appears only at `invoiceService.js:868, 1205, 1359, 1768`.
  - The comment at `stockService.js:513-516` claims every multi-variant mover sorts its locks; it is not true.
- **Impact:** PostgreSQL aborts one transaction. Nothing is corrupted (everything rolls back), but a manager's return approval or PO receipt fails with a generic 500, because 40P01 is unmapped in `errorLogService.js`.
- **Recommended solution:**
  - Document one global lock order: document → variants (sorted) → customer → drawer → bank → journal.
  - Call `lockVariants` up front in the four flows above and post journals last.
  - Add `retryOnDeadlock` (these callbacks have no pre-commit side effects).
  - Map 40P01 to a retryable 409/503.
- **Risk:** Low–Medium. **Effort:** M.
- **Regression tests:** live two-connection races (extend `concurrency.live.test.js`):
  - a cash sale vs a cash refund return approval;
  - a cash→bank vs bank→cash transfer;
  - two PO receipts sharing variants in opposite order.

#### F-TX-02 — Two supplier-return flows post different payable amounts for the same event
- **Category:** Accounting / duplicated rule · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `server/controllers/supplierReturnsController.js:375-386` posts payables at PO unit cost, with the variance to COGS.
  - `server/services/returnService.js:1184-1190` posts at weighted-average book value with no variance line.
  - VAT reversal is implemented twice (`supplierReturnsController.js:21-29`, `returnService.js:1172-1183`).
- **Impact:** what the shop owes a supplier depends on which screen was used.
- **Recommended solution:** one `supplierReturnService.returnGoods()` called by both, after an accounting decision on which valuation is correct.
- **Risk:** Medium (changes ledger amounts for one flow). **Effort:** M.
- **Regression tests:** the same goods returned through both flows produce identical journal lines and PO balance.

#### F-TX-03 — Low-stock events never fire for sales
- **Category:** Lost side effect · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `invoiceService.js:660-668` passes `io: null` and discards `reorderResult`. `stockService.js:456` `emitDeferred` has **no callers**.
- **Impact:** the reorder alert row is created, but the live `reorder_alert_created` event and the low-stock notification are skipped for the most common cause of low stock.
- **Solution:** collect `reorderResult` into the post-commit emits and call `emitDeferred`.
- **Risk:** Low. **Effort:** S.
- **Tests:** a sale that crosses the reorder point emits the event after commit.

#### F-TX-04 — A failing reorder check inside the sale transaction is "caught" but poisons the transaction
- **Category:** Error handling · **Severity:** Medium · **Confidence:** Likely.
- **Where:** `stockService.js:394-400` wraps the check in `try/catch` on the caller's client. The comment says it uses the pool, but it passes `params.client`. `reorderService.js:109-116` does a plain INSERT against the unique index `uq_reorder_pending_variant`.
- **Impact:** a 23505 race with the sweep job leaves the transaction aborted, and the sale then fails later with an unrelated 25P02 and a 500.
- **Solution:** wrap the check in a SAVEPOINT or move it after commit; use `ON CONFLICT DO NOTHING`.
- **Risk:** Low. **Effort:** S.
- **Tests:** pre-insert a pending alert, sell past the threshold, and assert the sale succeeds.

#### F-TX-05 — Idempotency key optional on some stock- and money-moving routes
- **Category:** Idempotency · **Severity:** Medium · **Confidence:** Confirmed for supplier returns; the payroll and finance routes Need Verification.
- **Where:**
  - `server/utils/operations.js:59`: no key means the work runs unprotected.
  - Optional keys at `supplierReturnsController.js:272` (moves stock and posts journals), `returnRequestsController.js:366`, `purchaseOrdersController.js:357`, `financeController.js:185`, `payrollController.js:68,76,83`.
  - Pre-checks run before the replay guard (`stockAdjustmentsController.js:194`).
  - The `operations` table is never pruned (`040_operations.sql`).
- **Solution:** `{ required: true }` on these routes; move pre-checks inside `runOnce`; add a cleanup job.
- **Risk:** Low. **Effort:** S.
- **Tests:** two identical supplier-return POSTs with one key produce one movement.

#### F-TX-06 — Audit entries written outside the business transaction
- **Category:** Atomicity / audit integrity · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - After commit (can be lost silently): `invoicesController.js:564, 660`; `invoicePaymentsController.js:229`; `invoiceService.js:1770`; `stockAdjustmentsController.js:523`; `stockCountsController.js:312, 518, 711`; `purchaseOrdersController.js:407, 537, 685, 753`; `supplierReturnsController.js:396, 515`.
  - Inside an open transaction but on the pool (survives rollback and takes a second connection): `bankService.js:375, 431, 466`; `journalService.js:1065`; `reorderService.js:119`.
- **Solution:** pass `client` wherever a transaction is open.
- **Risk:** Low. **Effort:** S.
- **Tests:** force a rollback after a bank movement and assert there is no activity row.

#### F-TX-07 — Rounding and VAT logic duplicated; PO tax re-derived from current settings
- **Category:** Money arithmetic / single source of truth · **Severity:** Medium · **Confidence:** Confirmed mechanism; frequency not measured.
- **Where:**
  - The epsilon `money()` is copy-pasted in 12 services (24 definitions server-wide via `grep -E "^(const|function) money\b"`).
  - Plain `Math.round(n*100)/100` is used in `stockService.js:226, 482`, `batchService.js:21`, `supplierReturnsController.js:16`, `treasuryController.js:150`.
  - A third form is in `inputVat.js:3`.
  - VAT is computed in nine places.
  - The settings row is chosen inconsistently (`ORDER BY updated_at DESC` vs `ORDER BY id`).
  - `purchaseOrderService.js:139-168` (`recalculatePOTotals`) re-reads the *current* VAT rate on already-received POs.
- **Impact:** half-cent cases post a spurious 0.01 to COGS on PO receive (book value uses the plain variant, payable uses the epsilon variant). A VAT-rate change silently alters historical PO totals away from the journal posted at receipt.
- **Solution:** one `server/utils/money.js` (and the same rules mirrored in `web/lib/money.ts`); one VAT module; store `tax_rate` on the PO at confirm.
- **Risk:** Low–Medium (cent-level differences; run `scripts/reconcile.js` before and after). **Effort:** M.
- **Tests:** half-cent table tests shared by server and client; changing the VAT rate does not alter a received PO's totals.

#### F-TX-08 — `withTransaction` can mask the original error and return a broken client to the pool
- **Category:** Error handling · **Severity:** Low · **Confidence:** Confirmed.
- **Where:** `server/db/postgres.js:80-82` and `server/db/migrate.js:97` run an unguarded `await client.query('ROLLBACK')` inside the catch; `release()` is called without the error.
- **Solution:** `.catch(() => {})` on ROLLBACK and `client.release(err)` when it fails.
- **Risk:** Very low. **Effort:** S.
- **Tests:** a unit test with a client whose ROLLBACK rejects asserts the original error propagates.

#### F-TX-09 — Document numbers can have gaps; year taken from server-local time
- **Category:** Compliance · **Severity:** Low (Medium if gapless tax-invoice numbering is legally required; **Needs Verification** with the shop's accountant) · **Confidence:** Confirmed.
- **Where:**
  - Numbers are allocated at draft creation (`invoicesController.js:521`).
  - Invoices are hard-deleted (`invoiceService.js:1349`).
  - The year comes from `new Date().getFullYear()` (`docNumbers.js:24`, `returnService.js:1482`).
- **Solution:** if gapless numbering is required, allocate at confirm and replace hard delete with void.
- **Risk:** Medium (the UI shows numbers on drafts). **Effort:** M.

#### F-TX-10 — Invoice hard delete plus CASCADE on ledger-adjacent tables
- **Category:** Data preservation · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `006_invoices.sql:36,56,81` (items, payments and history cascade).
  - `invoiceService.js:1349` (`DELETE FROM invoices`).
  - CASCADE on `010_treasury.sql:20,36,72`, `013_finance.sql:53` (journal lines), `012_bills_expenses.sql:40` and `009_returns.sql:91`.
- **Description:** The delete path reverses the sale first and snapshots it to `activity_log`, but journal entries keep a dangling `reference_id`. No application code deletes treasury or journal parents, so those cascades are latent.
- **Solution:** change ledger foreign keys to `RESTRICT`; review the invoice delete feature with the accountant (void instead).
- **Risk:** Medium (tests or cleanup scripts may rely on cascade). **Effort:** S–M.
- **Tests:** deleting a journal entry with lines is refused.

### C.3 Backend architecture and runtime

#### F-ARC-01 — Layering is a convention: 42 of 62 controllers contain SQL, and four are complete workflows
- **Category:** Architecture · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `stockAdjustmentsController.create` (`:176-413`), `stockCountsController.approve` (`:559-724`), `supplierReturnsController.create` (`:264-429`) and `bankAccountsController.transfer` (`:277-429`) contain transactions, locking, journal posting and stock moves.
  - No service exists for stock adjustments or counts.
  - Controllers with the most SQL calls: `stockCountsController` (38), `purchaseOrdersController` (34), `invoicesController` (31), `usersController` (29).
- **Root cause:** features were added handler-first; there is no rule for where write paths live.
- **Impact:** these rules cannot be reused by jobs, scripts or tests without HTTP. Transaction boundaries are split across two layers, and they are the source of F-TX-01 and F-TX-02.
- **Solution:** no big-bang refactor. Adopt the rule "every new or changed write path lives in a service that takes `client`". Move the four workflows first, each behind its existing integration tests. Read-only list endpoints can keep their SQL.
- **Risk:** Medium per move. **Effort:** L in total, spread across releases.
- **Tests:** existing integration suites (`stockCountRebase`, `inventoryValuation`, `purchaseVat`, `idempotency`) must pass unchanged.

#### F-ARC-02 — God functions carry the core business rules
- **Category:** Code quality · **Severity:** Medium · **Confidence:** Confirmed (line ranges from reading).

| Function | Lines |
|---|---|
| `returnService.approveAndExecute` | `842-1473` (~630) |
| `invoiceService.applyEditRequest` | `1436-1825` (~390) |
| `invoiceService.confirmInvoiceChecked` | `606-984` (~380) |
| `stockService.applyStockMovement` | `99-426` (~330) |
| `purchaseOrderService.receiveItems` | `200-484` (~285) |
| `socket/index.js` `attachSocket` | `48-327` (~280) |
| `server/index.js` `bootstrap` | `162-439` (~280) |
| `backupService.runBackupLocked` | `222-447` (~225) |
| `billService.payBillPayment` | `465-681` (~215) |
| `returnService.buildReplacementInvoice` | `1475-1686` (~210) |
| `returnService.createReturnRequest` | `629-837` (~210) |
| `cashService.closeDrawer` | `513-709` (~195) |
| `supplierPaymentService.addPayment` | `34-230` (~195) |
| `invoiceService.cancelInvoiceInTx` | `992-1185` (~195) |
| `errorLogService.classifyError` | `181-345` (~165) |

- **Impact:** each change to returns or invoice editing means reasoning about ~400–600 lines of interleaved stock, COGS, treasury, journal and notification code.
- **Solution:** extract cohesive steps (`postReturnRefund`, `reverseLineStock`, `buildJournalForReturn`) as plain functions taking `client`. Do it only when a feature touches the function, behind integration tests.
- **Risk:** Medium. **Effort:** L.

#### F-ARC-03 — Duplicated business rules across services
- **Category:** DRY / single source of truth · **Severity:** Medium · **Confidence:** Confirmed.
- **Examples:**
  - Same-day reversal rule: `customerService.js:223-231`, `supplierPaymentService.js:257-265`, `expenseService.js:379-382`.
  - PO paid-status: JS at `supplierPaymentService.js:25-30` vs SQL CASE at `purchaseOrderService.js:160-163`.
  - `stock_updated` payload built by hand 7 times (`invoiceService.js:686, 1055, 1827`; `returnService.js:996, 1026, 1071, 1610`).
  - Treasury emit payloads in 6 places.
  - Warranty-void SQL in 3 places.
  - `msUntilNext` copied in 4 job files.
  - `billService.js:31-40` uses server-local dates while everything else uses `todayStoreDate`.
- **Solution:** extract these as small helpers in the owning service. This is cheap and low-risk.
- **Effort:** M.

#### F-OPS-01 — No graceful shutdown
- **Category:** Reliability · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `server/index.js:467-468`: `process.on('SIGTERM', () => process.exit(0))`. There is no `server.close`, `io.close`, scheduler stop or `pool.end`; `stopBackupScheduler` is never called.
- **Impact:** every `docker stop` and self-update cuts in-flight requests and running backups. PostgreSQL rolls back open transactions, and idempotency keys make client retries safe, so the effect is availability, not integrity.
- **Solution:** on SIGTERM, enter maintenance, call `server.close()` with a 10–15 s deadline, stop schedulers, call `pool.end()`, then exit.
- **Risk:** Low. **Effort:** S.
- **Tests:** a request in flight during SIGTERM completes.

#### F-OPS-02 — `uncaughtException` / `unhandledRejection` are logged and the process continues
- **Category:** Reliability · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `server/middleware/errors.js:78-87`.
- **Impact:** the process can keep running in an undefined state (for example, listening failed but the process is alive). Docker does not restart an unhealthy container.
- **Solution:** log, then exit non-zero on `uncaughtException`, and let the restart policy recover.
- **Risk:** Low. **Effort:** S.

#### F-OPS-03 — No statement, lock or idle-in-transaction timeouts; small pool; expensive auth
- **Category:** Resilience / performance · **Severity:** Medium · **Confidence:** Confirmed (configuration). Impact Likely.
- **Where:**
  - `server/db/postgres.js:8-21` (max 10, no timeouts).
  - `server/services/searchService.js:24-116` runs up to 8 queries in `Promise.all`.
  - `server/middleware/auth.js:49-108, 174-192`: 4 queries plus a fire-and-forget UPDATE per request.
  - `server/middleware/errors.js:36` awaits a DB insert before replying.
  - `cashService.js:479-511` runs bcrypt while holding the singleton drawer lock.
- **Impact:** one hung transaction, runaway report or two concurrent global searches can block every till. Every sale touches the drawer row `FOR UPDATE`.
- **Solution:**
  - Add `-c lock_timeout=5s -c idle_in_transaction_session_timeout=60s -c statement_timeout=30s` to the pool options, with a separate pool or `SET LOCAL` for reports, backup and migrations.
  - Run search queries sequentially or as one `UNION ALL`.
  - Make error logging fire-and-forget.
  - Verify the approver before `BEGIN`.
- **Risk:** Medium (timeouts need tuning for long reports). **Effort:** S–M.
- **Tests:** a long `pg_sleep` in a request fails with a mapped timeout error, not a hang.

#### F-OPS-04 — Unknown errors are reported as "database failure" (500), including CORS rejections
- **Category:** Error contract / observability · **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - `server/services/errorLogService.js:335-344`: the fallback is `DB_QUERY_FAILED`/500, ignoring `err.status`.
  - CORS errors (`index.js:277-287`) are plain `Error`s with `status: 403`.
  - Limiters are mounted *after* CORS and JSON parsing (`index.js:311-314`).
  - Escalation notifies Admins after 3 hits.
- **Impact:** a till opened through a hostname other than `SERVER_IP` sees every POST fail as a "database error". Unauthenticated requests can write `error_logs` rows and trigger false database alerts.
- **Solution:** honour `err.status` and use `INTERNAL_ERROR` for non-pg errors; throw `AppError(403)` from the CORS callback; mount the limiter first; do not persist pre-auth 4xx errors.
- **Risk:** Low. **Effort:** S.
- **Tests:** a disallowed Origin yields 403 with no `error_logs` row.

#### F-OPS-05 — Background jobs: no overlap guard on scheduled reports; every instance runs every job
- **Category:** Background jobs · **Severity:** Low (single instance) / Medium (cluster) · **Confidence:** Likely.
- **Where:** `scheduledReportService.js:310-320` (60 s `setInterval`, `last_sent_at` written after generation); jobs gated only by an env flag (`index.js:407`); daily jobs drift to boot time (`notificationCron.js:231`, `warrantyExpiry.js:42`, `financialPeriods.js:23`).
- **Solution:** a `running` flag and `pg_try_advisory_lock` per job, as the backup job already does.
- **Effort:** S.

#### F-OPS-06 — Two validation-error shapes and unvalidated query strings
- **Category:** API consistency · **Severity:** Low · **Confidence:** Confirmed.
- **Where:**
  - 15 controllers have their own `zodFail` helper, 19 use `instanceof ZodError`, and the rest rely on `classifyError`. Examples: `cashDrawerController.js:49-56, 97-104, 134-141, 344-351`; `billPaymentsController.js:9-15`.
  - `validateBody` middleware (`server/utils/validate.js:6`) is used by one router only.
  - `parsePagination` (`server/utils/response.js:11-16`) accepts `page=Infinity`, which leads to a 500.
  - Maintenance and rate-limit responses use a different envelope (`maintenanceMode.js:44-51`, `rateLimiter.js:5-13`; `RATE_LIMIT_EXCEEDED` is not in `ERROR_CODES`).
- **Solution:** delete the local converters and let `classifyError` handle zod errors; clamp pagination; add the missing code.
- **Effort:** S.

### C.4 Database schema

#### F-DB-01 — `NOT VALID` constraints never validated; a safety index can be silently missing
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - No `VALIDATE CONSTRAINT` statement exists in any migration, although 047 and 057 state that intent.
  - `044_warranty_claim_guards.sql:13-26` skips `uq_warranty_claims_one_open` with only a NOTICE when duplicates exist.
- **Solution:** add reconcile checks for each predicate, then validate per constraint in a later release once data is clean.
- **Effort:** S–M.

#### F-DB-02 — Invariants enforced only in application code
- **Severity:** Medium · **Confidence:** Confirmed (absence checked across all 69 migrations).
- **Not enforced in the database:**
  - One open `cash_drawer_sessions` row per drawer (no partial unique index; compare `050` for user sessions).
  - `amount_paid <= total` on invoices and POs.
  - `direction IN ('in','out')` on cash and bank transactions.
  - Journal immutability after posting, and posting into closed periods.
  - Status CHECKs on payment, return, warranty and drawer status.
- **Solution:** a partial unique index for open drawer sessions; `NOT VALID` CHECKs for the rest, with reconcile checks first (same caveat as F-MIG-01).
- **Effort:** M.

#### F-DB-03 — Redundant indexes and FK columns without indexes
- **Severity:** Low · **Confidence:** Confirmed.
- **Redundant:**
  - Duplicates of UNIQUE constraints: `idx_users_username` (`001:96`), `idx_invoices_number` (`006:101`), `idx_po_number` (`004:113`) and others.
  - Same column indexed twice: `idx_invoices_created_at` (`006:106`) and `idx_invoices_date_desc` (`019:43`).
- **Unindexed FKs:** `stock_count_items.stock_count_id`, `supplier_return_items.supplier_return_id`, `purchase_order_items.variant_id`, `return_orders.replacement_invoice_id` (probed per row by `v_sales_demand_lines`, `066:47`).
- **Impact:** write overhead only; negligible at single-shop scale.
- **Solution:** one tidy-up migration later.
- **Effort:** S.

#### F-DB-04 — `v_sales_demand_lines` reads a setting no code sets
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:** `066_forecast_demand.sql:36-37` reads `app.store_timezone` and always falls back to `'Asia/Dubai'`.
- **Impact:** wrong store day if `STORE_TIMEZONE` differs.
- **Solution:** use the session time zone, which the pool already sets.
- **Effort:** S.

#### F-DB-05 — Seeds: default credentials outside production; nullable money columns
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:**
  - `server/db/seed.js:201,216-223` creates `admin/admin123` when `NODE_ENV !== 'production'` and logs it. Docker sets production, so this affects bare-metal only.
  - `postgres.js:12` falls back to password `postgres`.
  - Money columns are `DEFAULT 0` but nullable (`006:18-26`, `002:66-67`). This nullability is what makes the `061` divisor bug (F-MIG-01) possible.
- **Solution:** refuse the default admin unless explicitly requested; backfill and then `SET NOT NULL`.
- **Effort:** S.

### C.5 Frontend

#### F-FE-01 — Any failure of the public-settings fetch sends a till to the setup wizard
- **Severity:** High · **Confidence:** Confirmed.
- **Where:** `web/components/guards/SetupGateClient.tsx:21-28` (`.catch(() => setCompleted(false))`) and `:39-46` (`router.replace('/setup')`). The effect never retries.
- **Impact:** a server restart or LAN blip during page load shows a cashier the "create admin" wizard until they reload.
- **Solution:** add a third "unreachable" state with a retry; treat "not completed" only as an explicit server answer.
- **Risk:** Low. **Effort:** S.
- **Tests:** a fetch rejection renders a retry screen and does not redirect.

#### F-FE-02 — Stale closure in the admin POS replaces search results on every stock event
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `web/app/(dashboard)/pos/page.tsx:235-245`: `[]` deps plus an `eslint-disable` capture the first-render `fetchProducts` (empty search, no category).
- **Impact:** while a cashier searches, a sale on another till replaces the grid with the unfiltered list.
- **Solution:** the ref pattern already used in `CashierTerminal.tsx:218-234`.
- **Effort:** S.
- **Tests:** simulate `stock_updated` with an active search and assert the filter is preserved.

#### F-FE-03 — Admin POS barcode scan adds the first fuzzy result when no exact match exists
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `web/app/(dashboard)/pos/page.tsx:269-276` (`|| matches?.[0]`), contradicting the stated rule in `web/lib/cashier/barcode.ts:1-3`, which Cashier Mode follows.
- **Impact:** an unknown barcode can silently add the wrong product to a sale.
- **Solution:** reuse `findExactCodeMatch`.
- **Effort:** S.
- **Tests:** an unknown barcode adds nothing and shows a "not found" message.

#### F-FE-04 — Two POS implementations with diverging safety features
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `web/app/(dashboard)/pos/page.tsx` (1,028 lines) vs `web/components/cashier/CashierTerminal.tsx` (949 lines).
- **What the admin POS lacks:** sale backup, the drawer-closed override, the conflict reload, the pricing-violation preview and the scan queue. F-FE-02 and F-FE-03 exist only in the admin POS.
- **Solution:** extract a shared `useSale()` hook (checkout, recovery, backup, stock guard), or retire the admin POS grid in favour of Cashier Mode.
- **Risk:** Medium. **Effort:** M–L.

#### F-FE-05 — Full product and customer lists written to `localStorage` on every dashboard mount, never read, never cleared
- **Severity:** High (privacy and wasted load on shared tills) · **Confidence:** Confirmed.
- **Where:**
  - `web/app/(dashboard)/layout.tsx:140-142`; `web/services/localCacheService.ts:40-96`; `web/services/stockCacheService.ts:42-83`.
  - The readers (`searchProductsLocal`, `searchCustomersLocal`, `getCachedStock`) have zero importers (re-checked by grep).
  - Two concurrent `fullSync` runs each call `cache.clear()`.
- **Impact:** customer names, phones and credit balances persist on a shared till after sign-out. Every login downloads the whole catalogue for nothing.
- **Solution:** delete the two cache services and clear the `mahali.cache.*` keys on boot.
- **Risk:** Low (no readers). **Effort:** S.
- **Tests:** after login, no `mahali.cache.*` key exists.

#### F-FE-06 — Cart and other stores survive sign-out
- **Severity:** Medium (High for credit sales) · **Confidence:** Confirmed.
- **Where:** `web/store/authStore.ts:52` (`logoutLocal` clears auth only); `web/store/posStore.ts:524`; `web/hooks/useSaleBackup.ts:49-52`.
- **Impact:** after an idle sign-out, the next cashier inherits the previous cart, credit customer, payments, `draftInvoiceId` and `checkoutId`.
- **Solution:** a single `resetSessionStores()` called from `logoutLocal`. Decide whether an open sale is first held as a server draft (a product decision).
- **Effort:** S–M.
- **Tests:** after logout and login as another user, the cart is empty and no customer is selected.

#### F-FE-07 — Payments and change are computed from the client total; the server total is discarded
- **Severity:** Medium · **Confidence:** Likely.
- **Where:** `web/lib/pos/checkout.ts:56-75, 153-163`; the server re-prices lines (`server/services/invoiceService.js:290-301`).
- **Description:** The client maths mirrors the server exactly (`posStore.ts:218-246` vs `invoiceService.js:93-127`), so divergence needs a price or VAT change after the item was added. Nothing refreshes cart prices.
- **Solution:** after `saveDraft`, compare the server total with the client total and stop with "prices changed, review" when they differ.
- **Effort:** S.
- **Tests:** change a price between add-to-cart and checkout and assert the checkout stops.

#### F-FE-08 — Hardware-agent printing is unreachable from the UI; browser auto-print runs outside a user gesture
- **Severity:** Medium · **Confidence:** Confirmed (no caller of `setHardwareAgentToken`, re-checked); popup blocking Likely.
- **Where:** `web/services/hardwareAgentClient.ts:13, 27-28`; `web/services/printService.ts:99-121`; auto-print from a socket event at `pos/page.tsx:251-259`.
- **Description:** `README.md:643` describes a pairing field that does not exist.
- **Trust model:** the browser sends the user's API JWT to the local agent over plain HTTP. A short-lived, print-scoped token would be safer.
- **Solution:** build the pairing UI with the token in `localStorage` (per PC), or remove the agent and its docs.
- **Effort:** S–M.

#### F-FE-09 — Socket reconnect resync is partial; one branch is dead
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `web/store/socketStore.ts:149-176`. `wasConnected` is always false because `disconnect` resets it, so `stockBus.emit({ reconnected: true })` never runs. Invoice, treasury and return badges stay stale after a network drop.
- **Solution:** emit one `reconnected` signal to all buses, or re-run the layout's initial refresh.
- **Effort:** S.

#### F-FE-10 — Client money rounding duplicated with two behaviours; the return wizard's review shows a different difference from the one submitted
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:**
  - The epsilon `round2` is used in `web/store/posStore.ts:166-174`, `web/lib/cashier/pricing.ts:20-23` and `web/components/pos/CartItem.tsx:37`.
  - Plain rounding is used in `returns/new/page.tsx:1457`, `VatIncludedField.tsx:7`, `CartBatchPicker.tsx:23`, `purchase-orders/new/page.tsx:60` and 7 inline sites.
  - The return Review step recomputes the replacement value excluding VAT (`returns/new/page.tsx:1438-1443`), while the Plan step and the submitted payload use the VAT-inclusive total (`:230-244`, `:323`).
- **Mitigation:** the server recomputes return values and caps quantities (`server/services/returnService.js:574-596`), so the money posted is correct. The defect is what the manager *reviews*.
- **Solution:** one `web/lib/money.ts`; pass `replacementTotal` into `ReviewStep`.
- **Effort:** S.

#### F-FE-11 — TypeScript non-strict, no linter, heavy `any`
- **Severity:** Medium · **Confidence:** Confirmed (measured).
- **Where:**
  - `web/tsconfig.json` has `"strict": false`; `--strict` produces 1,226 errors.
  - 1,178 `: any`, 66 `as any` and 198 `any[]` in non-node_modules sources.
  - 87 `react-hooks/exhaustive-deps` suppressions across 50 files, which are inert because ESLint is not installed.
  - `web/next.config.mjs` sets `eslint.ignoreDuringBuilds: true`.
  - There is no backend linter either.
- **Impact:** the class of bug in F-FE-02 is invisible to tooling.
- **Solution:**
  1. Add `eslint-config-next` with `react-hooks` and triage the 87 suppressions first.
  2. Enable `noImplicitAny` directory by directory, starting with `services/`, `lib/` and `store/`.
  3. Add a small ESLint config for `server/` (`no-floating-promises` requires TS; use `eslint-plugin-promise`).
- **Risk:** Low. **Effort:** M (one-off triage).

#### F-FE-12 — Client-rendered SPA inside the App Router; client-only auth gating
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:**
  - 76 of 86 `app/**/*.tsx` files are `'use client'`; there is no server-side data fetching.
  - `app/layout.tsx:6` has `force-dynamic`.
  - `components/guards/AuthGuard.tsx:19-25` gates on the client only.
  - There is no `middleware.ts` and no per-segment `error.tsx`.
- **Assessment:** for a LAN POS whose data is behind an authenticated API, this is an **acceptable** choice, not a defect. Do not migrate to server components for its own sake. Two cheap improvements are worth making: remove `force-dynamic`, and add `error.tsx` to the `(dashboard)` and `(cashier)` groups.
- **Effort:** S.

#### F-FE-13 — Very large page components and repeated UI primitives
- **Severity:** Low–Medium (maintainability) · **Confidence:** Confirmed.
- **Large pages:** `returns/new/page.tsx` (1,467 lines, 9 components plus refund and VAT maths), `customers/[id]/page.tsx` (1,208), `products/page.tsx` (1,094), `suppliers/[id]` (1,010), `products/[id]` (992), `products/new` (938), `invoices/[id]` (916).
- **Repeated primitives:**
  - 14 hand-rolled overlays, several without a focus trap;
  - 9 `window.confirm`/`prompt` calls, two of them on money actions (`customers/[id]/page.tsx:663` void payment; `payroll/page.tsx:125` void payroll);
  - 41 raw `<table>` vs 28 shared `Table`;
  - 5 date components;
  - a `toParams` helper redefined in 26 service files.
- **Solution:** split pages into route-local `_components/` when touched; replace the money-action `window.confirm` calls with `ConfirmDialog` (which supports a reason field); create one `services/query.ts`.
- **Effort:** M, incremental.

#### F-FE-14 — Minor frontend items
All Low severity and Confirmed unless noted.
- **Retry toast:** the timeout "Retry" toast re-sends a request whose result is discarded (`web/services/http.ts:82-85`).
- **Raw `fetch` downloads:** four authenticated downloads bypass the axios interceptors (`invoiceService.ts:161`, `analyticsService.ts:112`, `backupService.ts:71`, `reportService.ts:183`).
- **Offline claims:** the offline banner promises "POS mode active", but the offline queue has no callers (`OfflineBanner.tsx:32`; `posStore.ts:541-572`).
- **PC identifier:** `pcIdentifier` is a random 2-digit value that cannot be set (`posStore.ts:193-203`). By my estimate, two of five tills have about a 10% chance of colliding, and a collision makes both auto-print the same receipt.
- **Live-refresh skeletons:** detail pages replace the whole page with a skeleton on live refresh, unmounting open dialogs (`invoices/[id]/page.tsx:93-129`; `returns/requests/[id]/page.tsx:55-77`).
- **Hardcoded version:** `APP_VERSION` is hardcoded in `web/services/http.ts:10`.
- **Tracked build file:** `web/tsconfig.tsbuildinfo` (333 KB) is tracked in git.

### C.6 Infrastructure, security and sidecars

#### F-SEC-01 — `multer` 1.x on upload endpoints
- **Category:** Dependency security · **Severity:** High · **Confidence:** Confirmed (resolved version `1.4.5-lts.2` in `package-lock.json:5158-5160`; the lockfile carries the upstream deprecation notice).
- **Where:** used in `server/utils/upload.js`, `server/routes/settings.js` and `server/routes/bugReports.js`.
- **Impact:** a known denial-of-service vulnerability class that upstream patched in 2.x.
- **Solution:** upgrade to multer 2.x; its API is largely compatible.
- **Risk:** Low–Medium. **Effort:** S.
- **Tests:** upload, oversize rejection and wrong-type rejection on all three routes.

#### F-SEC-02 — ML sidecar published to the LAN, running as root, with every secret
- **Severity:** Medium (only with `--profile ml`) · **Confidence:** Confirmed.
- **Where:**
  - `docker-compose.yml:158-159` publishes port 8000 without a `127.0.0.1:` prefix.
  - `:150-151` passes `env_file: .env`, which includes the JWT and backup secrets.
  - It uses the same DB role as the API.
  - `backend-fastapi/Dockerfile` has no `USER` line.
  - Its auth checks `logout_at` but not `absolute_expires_at` (`app/core/security.py:101-109` vs `server/middleware/auth.js:99-100`).
- **Solution:** bind to loopback, pass only the variables it needs, run as non-root, and use a SELECT-only role.
- **Effort:** S.

#### F-SEC-03 — Smaller hardening items
All Low severity and Confirmed.
- **JWT:** `jwt.verify` does not pin `algorithms` (`server/middleware/auth.js:46`).
- **Request IDs:** client-supplied request IDs are not length-capped (`requestId.js:11-12`).
- **SVG logos:** stored unsanitised and served without auth (`routes/settings.js:21-26`, `routes/files.js:16-19`). This is mitigated by the CSP `script-src 'none'`.
- **Uploaded PDFs:** the type is trusted from the client and there is no magic-byte check (`utils/upload.js:165-168`).
- **Backup tool paths:** Admin can set `pg_dump_path`/`pg_restore_path` to any executable (`backupController.js:263-264`). It is spawned without a shell, so there is no injection.
- **Release tag:** not format-validated before it is used in a path and in `rmSync` (`updateCheckService.js:157-158, 205-208`).
- **CORS:** allows `Origin: null` with credentials (`corsOrigins.js:15`). Auth is a Bearer header, so there is no CSRF.

No SQL injection was found: every interpolation sampled is whitelisted or constant. No shell-built command was found anywhere.

#### F-INF-01 — Image tags out of step with the release; no rollback image
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `docker-compose.yml:36,94` tag `1.1.0`, while `package.json` says `1.11.0`. Every build overwrites the only image. `README.md:906-909` claims the tags are synchronised.
- **Solution:** use `image: bytecrapos-api:${APP_VERSION}` and set the version in the release step.
- **Effort:** S.

#### F-INF-02 — Certificate generation needs the internet at first start; leaf lifetime likely rejected by Apple devices
- **Severity:** Medium · **Confidence:** Confirmed (script). Device behaviour Needs Verification.
- **Where:** `docker/caddy-entrypoint.sh:5` runs `apk add openssl` at container start under `set -e`; `:22-24` creates a 3,650-day leaf with no `basicConstraints`.
- **Impact:** an offline first start restart-loops `web-tls`. iOS/macOS reject TLS leaves valid for more than 825 days.
- **Solution:** a local CA (10 years) plus an 800-day leaf, using an image that already contains openssl, or Caddy's `tls internal`.
- **Effort:** S–M.
- **Tests:** a manual check on a real iPhone and an Android phone.

#### F-INF-03 — CI gaps
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `.github/workflows/build.yml:41-42` and `release.yml:51-52`.
- **Gaps:**
  - CI uses `npm install`, while the Dockerfiles use `npm ci`.
  - There is no `docker build` job, no lint and no `npm audit`.
  - `build.yml` runs on pull requests only.
  - A `v*` tag is released without checking it matches `package.json`.
  - Actions are pinned by major version, not SHA.
- **Solution:** switch to `npm ci`; add a `docker compose build` job; add a tag-equals-version check; add an `npm audit --omit=dev --audit-level=high` step (non-blocking at first).
- **Effort:** S.

#### F-INF-04 — No container log rotation; no Caddy healthcheck
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:** there is no `logging:` key anywhere in `docker-compose.yml`, and `web-tls` (`:119-138`) has no healthcheck.
- **Impact:** on an always-on shop PC, json-file logs grow without bound.
- **Solution:** set `logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }` and add a Caddy healthcheck.
- **Effort:** S.

#### F-INF-05 — `DATABASE_URL` in `.env.example` breaks reconcile and the ML sidecar
- **Severity:** Medium · **Confidence:** Confirmed (code). Runtime effect Likely.
- **Where:** `.env.example:41-42` says it is "not used". In fact `scripts/reconcile.js:329` prefers it, and so does `backend-fastapi/app/core/config.py:29-33`. Inside Docker it points at `localhost`.
- **Solution:** remove the line from `.env.example`.
- **Effort:** S.

### C.7 Tests and quality assurance

#### F-TST-01 — A test loads the real `.env` and queries that database
- **Severity:** High · **Confidence:** Confirmed.
- **Where:** `tests/contracts/slice01.readonly.test.js:10-11` calls `dotenv.config({ path: '.env' })` and then imports `server/db/postgres.js`. It is not gated by `skipIf`.
- **Impact:**
  - On a developer or shop PC with a reachable `.env` database, `npm test` runs production service code against real data.
  - It contradicts `tests/globalSetup.js:56-57`.
  - It passes vacuously when the DB is unreachable (`:14-19`), which is always the case in CI, so it asserts nothing there.
- **Solution:** convert it to the isolated create-database pattern used by the other suites.
- **Effort:** S.

#### F-TST-02 — DB test bootstrap auto-probes port 5432 with `postgres/postgres`, and is copy-pasted into 69 files
- **Severity:** Medium · **Confidence:** Confirmed.
- **Where:** `tests/globalSetup.js:58-64`, plus `new Pool({ database: 'postgres' })` repeated in 69 files.
- **Impact:**
  - On a native install whose superuser password is `postgres`, tests create and drop around 69 temporary databases on the shop's PostgreSQL cluster.
  - The developer's real `.env` leaks non-PG secrets into test processes via `migrate.js:1` and `seed.js:1`.
  - A local `npm test` silently skips the money suites.
- **Solution:**
  - Require an explicit `INVOICE_TEST_PG_PORT`.
  - Create one `tests/helpers/testDb.js`.
  - Guard `dotenv` with `NODE_ENV !== 'test'`.
  - Print a loud summary line when suites are skipped.
- **Effort:** M.

#### F-TST-03 — Coverage configured for three files; no measured coverage
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:** `vitest.config.js:20-24` includes only `invoiceService.js`, `stockService.js` and `authController.js`. No threshold is set and CI does not run coverage. No coverage figure is reported in this audit.
- **Solution:** include `server/**` and report the number in CI without gating it at first.
- **Effort:** S.

#### F-TST-04 — Critical gaps: restore, upgrade with data, browser checkout, and most race scenarios
- **Severity:** High (restore and upgrade) / Medium (the rest) · **Confidence:** Confirmed.
- **Untested:**
  - a real `pg_dump`→`pg_restore` round trip (F-BAK-02);
  - upgrading a populated previous-release DB (only two partial `stopBefore` tests exist, and `README.md:208,897` claims migration tests);
  - the container-recreate updater regression;
  - live races for drawer close vs sale, two returns on one invoice, and concurrent PO receipts;
  - frontend tests for the admin POS, the returns wizard, `CashDrawerTab`, customer payment void and `SetupGateClient` failure;
  - any browser end-to-end test.
- **Note:** `tests/contracts/concurrency.locks.test.js` asserts by regex that source files contain `FOR UPDATE`. That proves nothing about behaviour; it is worth replacing with live races.
- **Covered well:**
  - payroll, trial balance and balance sheet (`financialIntegrity.test.js`);
  - cash drawer close (`phase5Payments.test.js:218`);
  - transfers and idempotency (`idempotency.test.js`);
  - supplier returns and stock counts;
  - DB constraints;
  - a real last-unit race (`concurrency.live.test.js`).
- **Effort:** L in total.

#### F-TST-05 — Test files named after audit rounds
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:** `auditPhase2`, `auditQuickFixes`, `auditRound2Phase1`, `inventoryPhase4`, `phase5Payments`, and `review{Access,Decisions,Features,Finance,Inventory,Sales,Trust}` (68 tests).
- **Solution:** rename or split by domain when next touched. The inner `describe` names are already domain-based.
- **Effort:** S each.

### C.8 Repository, documentation and dependencies

#### F-DOC-01 — README contradicts the deployed topology
- **Severity:** High (an installer following it opens the wrong ports and gives tills the wrong URL) · **Confidence:** Confirmed.
- **Where:**

| README location | What it says | What is true |
|---|---|---|
| `README.md:98` | Tills use Next.js on port 80; browsers also use 3000 | Only Caddy is published |
| `:341, :555` | Open firewall port 3000 | `docker/README.md:93` says the opposite |
| `:343, :564, :599, :616` | Use plain `http://SERVER_IP` | Port 80 only redirects and the API refuses plain HTTP |
| `:869` | `TRUSTED_PROXIES` defaults to `nextjs` | The default is `web-tls` |
| `:867` | `JWT_EXPIRES_IN` is a setting | No longer read |
| `:230` | camelCase route paths | Mounts are kebab-case |
| `:243` | Audit files were removed | Several remain at the root |

- **Solution:** rewrite the affected sections from `docker/README.md` and `docs/HTTPS_SETUP.md`, which are accurate.
- **Effort:** S–M.

#### F-DOC-02 — Obsolete documents presented as current
- **Severity:** Medium · **Confidence:** Confirmed.
- **Obsolete documents:**
  - `docs/RELEASE.md:24-53` (NSIS/Electron, `npm run build:electron`, which does not exist).
  - `docs/SETUP_GUIDE.md`, `docs/SHOP_MULTI_PC.md` and `docs/SERVER_AUTOSTART_GUIDE.md` (PM2 plus the Electron installer).
  - `docker/README.md:43` ("Docker does not terminate TLS"), `:116` and `:173-191` (Electron).
  - `docs/LOCAL_DEV.md:11`.
  - `PROJECT_REPORT.md` ("Edara POS").
- **References to files that do not exist:**
  - `CODEBASE_AUDIT.md` (CI workflows, a FastAPI test, `posStore.test.ts`);
  - `POS_WARRANTY_AUDIT.md`;
  - `docs/fastapi-migration/…` (moved to the archive).
- **Solution:** move the obsolete documents to `docs/archive/`, rewrite `RELEASE.md` for the Docker release including rollback steps, and fix the dead references.
- **Effort:** M.

#### F-DOC-03 — Environment variables: documented but unread, and read but undocumented
- **Severity:** Medium · **Confidence:** Confirmed (grep of `process.env.`).
- **Documented but never read by Express:** `UPLOADS_PATH`, `BACKUPS_PATH`, `MAHALI_SERVER_IP`, `VITE_*`, `FASTAPI_HOST`, `LOG_LEVEL`.
- **Read but undocumented:** `PGPOOL_*`, `DRAFT_INVOICE_MAX_AGE_HOURS`, `MIGRATE_WITHOUT_BACKUP`, `MAHALI_SERVER_MODE`, `MAHALI_PG_BIN_DIR`, `SETUP_CODE_FILE`, ten `UPDATE_*` variables, `HARDWARE_AGENT_*`, `EXPRESS_URL`, `NEXT_PUBLIC_SOCKET_URL`, and others.
- **Inconsistent default:** `server/index.js:427` defaults `PORT` to 3002, while `.env.example`, compose and the hardware agent assume 3000.
- **Solution:** one table in `.env.example` generated or checked by a script in CI.
- **Effort:** S–M.

#### F-DOC-04 — `API-doc.md` is a stale, hand-maintained 1.6 MB snapshot
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:** header line 3 says "Implementation snapshot … 1.8.0.1". It states that idempotency applies to invoice payments only, and that the default port is 3002. No generator exists. `README.md:239,927` calls it the complete reference.
- **Solution:** mark it as historical, and generate a route and permission list from `server/routes` plus `shared/authzPolicy.js` (the route-permission contract test already walks these).
- **Effort:** M.

#### F-REPO-01 — Root clutter, tracked artefacts and leftovers
- **Severity:** Low · **Confidence:** Confirmed unless marked otherwise.
- **Tracked but should not be:** `web/tsconfig.tsbuildinfo` (it is the permanent "modified" entry in `git status`).
- **Confirmed unused:** `assets/installer.nsh`, `assets/icon.ico`, `assets/icon.png` and `assets/README.md` (Electron/NSIS); the untracked empty directory `docker/Caddyfile;C`.
- **Likely unused:** `ecosystem.config.js` and the five `pm2:*` scripts; `notes.txt`; `server/config/storeSettings.js` (a file-based settings module that runs alongside `app_settings`); `tests/migration/slice01Dataset.js`.
- **Root reports:** eight report files (~200 KB) at the root. `UPGRADE_SAFETY_AUDIT_2026-11-17.md` is **untracked**, so its open findings are not in version control.
- **On disk, untracked, outside the repository's control:** `docker/postgres/backups/pre-rebuild-2026-11-17.dump` (37 MB real database dump) and `tmp/clickthrough-test-users.txt`. Both are ignored by git, but they are sensitive files in a working tree.
- **Solution:** a `docs/audits/` folder for the reports (and commit the 2026-11-17 one); `.gitignore` the tsbuildinfo; remove the Electron and PM2 leftovers once you confirm no shop runs natively; move the dump out of the repository tree.
- **Effort:** S.

#### F-REPO-02 — FastAPI sidecar: ~900 lines unmounted, SQL copied from Express
- **Severity:** Low · **Confidence:** Confirmed.
- **Where:**
  - `backend-fastapi/app/main.py:18-37` mounts only `/health`; `tests/test_health.py` asserts the v2 routes return 404.
  - `app/modules/forecast/service.py:1` says it was "SQL copied from server/services/forecastService.js".
  - Nothing in `server/` or `web/` calls it.
  - It has no Python lockfile.
- **Recommendation:** archive the unmounted code next to its design docs, or delete it, and keep the sidecar only when there is a real ML use. It is a YAGNI cost today (a CI job, a compose service, a second auth implementation that has already drifted).
- **Effort:** S.

#### F-DEP-01 — Dependency hygiene
- **Severity:** Low (multer is in F-SEC-01) · **Confidence:** Confirmed.
- **Undeclared:** `drivelist` and `unzipper` are required by the backend but not declared (`unzipper` resolves only through `exceljs`).
- **Version splits:**
  - vitest `^3` at the root vs `^2` in `web/`;
  - zod is in both packages, with request schemas defined separately on each side;
  - there is no npm workspace and no `engines` field.
- **Deprecated chain:** `bcrypt 5.1.1` pulls in the deprecated `node-pre-gyp` chain.
- **Clean:** every root and web runtime dependency has a real importer.
- **Solution:** declare `unzipper`; drop USB or declare `drivelist`; align the vitest majors; add `engines: { node: ">=22" }`. Consider `bcrypt` 6 or `@node-rs/bcrypt` only when convenient.
- **Effort:** S.

### C.9 Dead code summary

| Classification | Items |
|---|---|
| **Confirmed unused** | **Backend:** `stockService.emitDeferred` (should be used, see F-TX-03); `authController.upsertPcRegistry`; `stopBackupScheduler`. **Frontend:** `web/services/localCacheService.ts` readers; `stockCacheService` readers; `setHardwareAgentToken`, `hardwareAgentHealth`; `posStore` offline-queue actions, `setPcIdentifier`, `updateUnitPrice`; `offlineStore.setQueuedCount`; `socketStore.onPdfReady`, `onHolidayEvent`; `lib/config.ts` `API_BASE`/`SOCKET_URL`/`FILES_BASE`/`SERVER_HOST`; about 45 service functions (listed in the frontend review, e.g. `variantService.findByBarcode`, `purchaseOrderService.deletePurchaseOrder`, `bankAccountService.updateBankAccount`). **Other:** `assets/*`; `docker/Caddyfile;C`; unmounted FastAPI v2 modules. |
| **Likely unused** | Backup settings stored but never consumed: `nas_username`, `nas_password`, `usb_auto_detect`, `retention_monthly_months` (`backupController.js:249-256`); retention key `'db-nightly'` (never produced); the PM2 ecosystem; `server/config/storeSettings.js` defaults; Electron branches in `printController.js`, `serverMode.js`, `corsOrigins.js` and 40 `window.electron` references in 13 web files. |
| **Requires manual verification** | Whether any shop still runs natively under PM2 or uses an Electron shell. If not, the Electron/PM2 branches above are dead. Exported helpers used only by their own module's tests (`readSaleBackup`, `canRetrySafely`, …) are not dead, but need not be exported. |

Nothing was deleted.

---

## D. Architecture assessment

**Recommendation: preserve and refactor incrementally. Do not redesign.**

### What the architecture actually is

It is a **modular monolith**:

- **API:** one Express process serving `routes → controllers → services → node-postgres`, with `shared/` policy modules (`authzPolicy`, `permissions`, `errorCodes`, `warrantyClaimPolicy`, `attendancePolicy`) used by both server and tests.
- **Frontend:** a separate Next.js client that talks to the API only through one axios instance and one socket.
- **Database:** PostgreSQL is the single source of truth and enforces a meaningful set of invariants itself.

Real-time updates go through a typed event registry with declared audiences (`server/socket/events.js:107-127`).

### Why preserve it

1. **The fit is right.** A single-shop LAN POS with a handful of tills is a textbook case for one process and one database. The hard requirements (atomic multi-table money and stock updates, row locking, idempotency) are easiest with one database transaction, and the code uses that well. Splitting into services would turn every sale into a distributed transaction.
2. **The core design decisions are good:**
   - one stock engine (`applyStockMovement`) with sorted locking for sales;
   - services that take a `client` so callers compose transactions;
   - post-commit socket emits;
   - server-side pricing and VAT;
   - the ledger posted inside the business transaction;
   - DB-level balancing.

   These are the expensive things to get right, and they are right.
3. **No structural rot.** There are no circular dependencies, services never touch HTTP objects, and the dependency direction is clean (highest fan-in is `db/postgres.js`, `errorCodes`, `activityLog`, `response`).

### What to refactor, and in what order

- **Move write workflows out of controllers into services** (F-ARC-01). Start with the four that hold transactions: stock adjustments, stock counts, supplier returns and treasury transfers. This is also the fix for F-TX-02.
- **Define one lock order and one money/VAT module** (F-TX-01, F-TX-07) before adding more flows.
- **Split the god functions only when a feature touches them**, behind the existing real-DB integration suites.
- **Frontend:** consolidate the two POS screens behind a `useSale()` hook, and tighten the type and lint tooling. The client-SPA-in-App-Router choice is acceptable; do not convert to server components for its own sake.

### What would *not* help here

Microservices, CQRS, event sourcing, DDD aggregates, a Clean Architecture port/adapter layer, replacing raw SQL with an ORM, or adding Redux or React Query. None of these solves a problem demonstrated in this code. Raw parameterised SQL is used safely and is the clearest way to express the locking this domain needs.

---

## E. Repository structure recommendation

The structure of the **code** is appropriate and should stay. The changes below are about removing noise and placing a few misplaced files. Each is low-risk.

### Current (abridged)

```
/                      README.md, API-doc.md (1.6 MB), 7 audit/report .md files, notes.txt,
                       ecosystem.config.js, Dockerfile, docker-compose.yml, vitest.config.js
assets/                Electron icons + installer.nsh
backend-fastapi/       optional sidecar, most code unmounted
docker/                Caddyfile, entrypoints, README  (+ stray "Caddyfile;C")
docs/                  current + obsolete guides mixed; archive/; web-migration/
hardware-agent/
scripts/
server/  backup/ config/ controllers/ db/ jobs/ middleware/ routes/ services/ socket/ templates/ utils/
shared/
tests/   contracts/ integration/ migration/ unit/
web/     app/ components/ hooks/ lib/ services/ store/ types/ public/  (+ tracked tsconfig.tsbuildinfo)
```

### Proposed (only meaningful differences)

```
/                      README.md, CHANGELOG.md, Dockerfile, docker-compose.yml, configs
docs/
  audits/              ← all *_AUDIT*.md, REVIEW_*.md, PROJECT_REPORT.md, AUDIT_*.md (incl. 2026-11-17, now tracked)
  archive/             ← SETUP_GUIDE.md, SHOP_MULTI_PC.md, SERVER_AUTOSTART_GUIDE.md, old RELEASE.md,
                         API-doc.md (as "1.8 snapshot"), fastapi-slice01-experiment/
  RELEASE.md           ← rewritten for Docker releases + rollback
server/
  services/            ← + supplierReturnService.js, stockAdjustmentService.js, stockCountService.js,
                         treasuryTransferService.js (logic moved from controllers, F-ARC-01)
  utils/money.js       ← single rounding module (F-TX-07); vat.js likewise
tests/
  helpers/testDb.js    ← shared DB bootstrap (F-TST-02)
  integration/         ← files renamed by domain as touched (F-TST-05)
web/
  lib/money.ts         ← single client rounding module (F-FE-10)
  services/query.ts    ← one toParams helper (F-FE-13)
(removed)              assets/, notes.txt, docker/Caddyfile;C, web/tsconfig.tsbuildinfo (untracked),
                       ecosystem.config.js + pm2 scripts (after confirming no native installs),
                       web/services/localCacheService.ts, stockCacheService.ts (F-FE-05)
```

### What each change involves

| Change | Justification | Affected imports and dependencies | Breaking risk | Complexity |
|---|---|---|---|---|
| Reports → `docs/audits/` | Root becomes onboarding-only; open findings put under version control | Links in README and other reports | None | Trivial |
| Obsolete guides and `API-doc.md` → `docs/archive/` | They contradict the deployed system | README links | None | Trivial |
| New services extracted from 4 controllers | Reuse, testability, consistent lock order | The controllers themselves; no external import changes; routes unchanged | Medium (money and stock) | M each, behind integration tests |
| `server/utils/money.js`, `web/lib/money.ts` | Single source of truth for rounding | 12+ services and 11+ web files | Cent-level differences possible; reconcile before and after | M |
| `tests/helpers/testDb.js` | Removes 69 copies; makes the safety fix one-line | 69 test files | None at runtime | M (mechanical) |
| Remove `assets/`, PM2, `notes.txt`, tsbuildinfo | Dead leftovers | `package.json` scripts (pm2) | None if no native installs | Trivial |
| Remove web cache services | Write-only, privacy leak | `app/(dashboard)/layout.tsx:140-142` | None (no readers) | S |

**Unchanged:** the `server/` layer folders, `shared/`, `server/db/migrations/` (never renumber or edit applied files), and the `web/` top-level layout and route groups.

---

## F. Technical debt register

### Urgent (correctness, data and recovery)

| ID | Debt | Severity | Impact | Effort |
|---|---|---|---|---|
| F-UPD-01 | Updater writes into the container layer; no newer-schema guard | Critical | Old code on a new schema after any recreate | S (guard) / L (image updates) |
| F-MIG-01 | Migrations abort on legacy dirty rows | High | Crash-loop on upgrade for long-running shops | M |
| F-BAK-01 | Backups co-located with the DB volume | High | Total data loss on a volume or Docker reset | S–M |
| F-BAK-02 | Restore untested against real `pg_restore`; no pre-restore snapshot | High | Recovery may fail when needed | M |
| F-UPD-02 | Unsigned updates; unlocked `npm install` fallback | High | RCE via the release channel; untested deps in production | M |
| F-UPD-03 | No rollback after swap | High | Crash-loop on a bad release | M |
| F-MIG-04 | Category seed duplicates and overwrites every boot | High | Catalogue pollution; reverted serial-tracking setting | M |
| F-SEC-01 | multer 1.x | High | DoS class on uploads | S |
| F-TST-01 | Test reads the real `.env` database | High | Tests can run against shop data | S |
| F-FE-01 | Setup-gate failure sends tills to the setup wizard | High | Cashier-facing outage on any blip | S |
| F-FE-05 | Customer PII cached in `localStorage`, never cleared | High | Privacy on shared tills | S |
| F-DOC-01 | README topology wrong | High | Wrong installs | S–M |

### Important (robustness and consistency)

| ID | Debt | Severity | Effort |
|---|---|---|---|
| F-TX-01 | Lock-order inconsistency; no deadlock retry | Medium | M |
| F-OPS-03 | No DB timeouts; search pool fan-out; bcrypt under lock | Medium | S–M |
| F-OPS-01/02 | No graceful shutdown; fatal errors swallowed | Medium | S |
| F-OPS-04 | Unknown errors reported as DB failure; limiter after CORS | Medium | S |
| F-TX-02 | Two supplier-return postings | Medium | M |
| F-TX-03/04 | Lost low-stock events; reorder check poisons the sale tx | Medium | S |
| F-TX-05/06 | Optional idempotency keys; audit rows outside the tx | Medium | S |
| F-TX-07 / F-FE-10 | Rounding and VAT duplication (server and client) | Medium | M |
| F-MIG-02/03 | Runner lock; ungranted permissions on upgrade | Medium | S |
| F-DB-01/02 | NOT VALID never validated; invariants app-only | Medium | M |
| F-FE-02/03/04/06/07/09 | POS stale closure, barcode fallback, two POS screens, session leakage, client total, reconnect | Medium | S–L |
| F-BAK-03/04/05 | Encryption default; NAS and retention; uploads path | Medium | S–M |
| F-INF-01/02/03/05 | Image tags; certificate; CI; `DATABASE_URL` | Medium | S–M |
| F-TST-02/04 | Test bootstrap; critical test gaps | Medium–High | M–L |
| F-SEC-02 | ML sidecar exposure | Medium | S |

### Optional (maintainability)

| ID | Debt | Effort |
|---|---|---|
| F-ARC-01/02/03 | Controllers holding workflows; god functions; duplicated rules | L (incremental) |
| F-FE-11 | Strict TS and ESLint | M |
| F-FE-12/13/14 | App Router polish, large pages, UI primitives, minor items | M |
| F-DB-03/04/05, F-TX-08/09/10 | Index tidy-up, timezone setting, seeds, rollback masking, numbering, CASCADE | S–M |
| F-OPS-05/06 | Jobs, validation shapes | S |
| F-DOC-02/03/04, F-REPO-01/02, F-DEP-01, F-TST-03/05 | Docs, clutter, sidecar, dependencies, coverage config, test names | S–M |

---

## G. Prioritized engineering roadmap

### P0 — Critical correctness and data-integrity risks (do before the next customer update)

1. **Boot guard** against a database newer than the code (F-UPD-01). Until updates are image-based, **disable "Install update"** in the UI, keeping "check for updates" as notify-only.
2. **Pre-upgrade preflight:** a read-only check of the dirty-row predicates that break 056/059/061/062/063/065, run by the updater and documented for manual upgrades (F-MIG-01).
3. **Backups off the Docker volume:** bind-mount `api_backups` to a host path and add an off-host destination to setup (F-BAK-01).
4. **A real restore round-trip test in CI** plus a pre-restore snapshot (F-BAK-02).
5. **Stop the category seed** from duplicating and overwriting (F-MIG-04), and grant the 060/063 permissions to Admin (F-MIG-03).
6. **Fix `slice01.readonly.test.js`** and remove the auto-probe default (F-TST-01, F-TST-02).

### P1 — High-impact engineering issues

7. Add DB timeouts and sequential search; verify the approver before locking (F-OPS-03).
8. Global lock order, `lockVariants` in the four flows, deadlock retry and 40P01 mapping (F-TX-01).
9. Graceful shutdown and exit on `uncaughtException` (F-OPS-01, F-OPS-02).
10. Signed update manifest and no `npm install` fallback, or image-based updates (F-UPD-02, F-UPD-03, F-UPD-04).
11. Upgrade multer to 2.x (F-SEC-01). Bind the ML sidecar to loopback and reduce its env (F-SEC-02).
12. Frontend:
    - setup-gate retry (F-FE-01);
    - delete the cache services (F-FE-05);
    - reset stores on logout (F-FE-06);
    - fix the POS stale closure and the barcode fallback (F-FE-02, F-FE-03).
13. Correct error classification and put the limiter before CORS (F-OPS-04). Low-stock emit and reorder savepoint (F-TX-03, F-TX-04).
14. Rewrite the README deployment sections and `docs/RELEASE.md` (F-DOC-01, F-DOC-02).

### P2 — Maintainability and structural improvements

15. One `money`/`vat` module, server and client (F-TX-07, F-FE-10). Store `tax_rate` on POs.
16. Unify supplier-return posting in one service (F-TX-02). Extract the stock adjustment, stock count and treasury transfer services (F-ARC-01).
17. ESLint with `react-hooks` (triage the 87 suppressions), then `noImplicitAny` by directory (F-FE-11). A minimal backend ESLint.
18. Shared test DB helper; real live-race tests for drawer, returns and PO receive; browser checkout end-to-end (F-TST-02, F-TST-04).
19. CI: `npm ci`, `docker compose build`, tag-equals-version check, audit step, versioned image tags (F-INF-01, F-INF-03).
20. Required idempotency keys and audit rows inside transactions (F-TX-05, F-TX-06). Migration runner lock (F-MIG-02).
21. Reconcile checks, then `VALIDATE CONSTRAINT`; partial unique index on open drawer sessions (F-DB-01, F-DB-02).
22. A `useSale()` hook shared by both POS screens, or retire the admin grid (F-FE-04).

### P3 — Optional refinements

23. Split god functions as they are touched (F-ARC-02). Remove duplicated helpers (F-ARC-03).
24. Repository tidy-up per section E; archive the FastAPI sidecar code (F-REPO-01, F-REPO-02).
25. Index tidy-up, RESTRICT on ledger FKs, NOT NULL on money columns (F-DB-03, F-TX-10, F-DB-05).
26. Env-var documentation check in CI; a generated route reference in place of `API-doc.md` (F-DOC-03, F-DOC-04).
27. Frontend primitives consolidation: `ConfirmDialog` instead of `window.confirm` on money actions, one `toParams`, page splits (F-FE-13).

---

## H. Quick wins

Each is safe, small (≤ 1 day) and independent.

| # | Change | Finding |
|---|---|---|
| 1 | Throw at boot if `_migrations` has unknown filenames (with an override env var) | F-UPD-01 |
| 2 | Migration granting `payroll.*` and `finance.manage_payment_fees` to Admin | F-MIG-03 |
| 3 | `pg_advisory_lock` around `runMigrations` | F-MIG-02 |
| 4 | Guard ROLLBACK in `withTransaction` and `migrate.js`; `release(err)` | F-TX-08 |
| 5 | Call `emitDeferred` for sale reorder results; savepoint and `ON CONFLICT DO NOTHING` for the reorder insert | F-TX-03, F-TX-04 |
| 6 | Pass `client` to the `logActivity` calls listed in F-TX-06 | F-TX-06 |
| 7 | `{ required: true }` on the supplier-return idempotency key | F-TX-05 |
| 8 | `classifyError` honours `err.status`; CORS throws `AppError(403)`; limiter mounted first | F-OPS-04 |
| 9 | Exit on `uncaughtException`; minimal graceful shutdown | F-OPS-01, F-OPS-02 |
| 10 | `lock_timeout` and `idle_in_transaction_session_timeout` in the pool options | F-OPS-03 |
| 11 | Reject a placeholder `MAHALI_BACKUP_SECRET` | F-BAK-03 |
| 12 | `uploadsDir()` → `getUploadsRoot()` | F-BAK-05 |
| 13 | Upgrade multer to 2.x | F-SEC-01 |
| 14 | `127.0.0.1:` prefix on the ML port | F-SEC-02 |
| 15 | Remove `DATABASE_URL` from `.env.example` | F-INF-05 |
| 16 | Add log rotation to compose services | F-INF-04 |
| 17 | `SetupGateClient` retry state | F-FE-01 |
| 18 | Delete the write-only cache services | F-FE-05 |
| 19 | Admin POS exact-barcode match and the ref pattern for the stock listener | F-FE-02, F-FE-03 |
| 20 | Fix the dead `wasConnected` branch | F-FE-09 |
| 21 | Convert `slice01.readonly.test.js` to an isolated DB | F-TST-01 |
| 22 | `.gitignore` `web/tsconfig.tsbuildinfo`; delete `docker/Caddyfile;C`; commit the 2026-11-17 audit into `docs/audits/` | F-REPO-01 |
| 23 | Declare `unzipper` in `package.json` | F-DEP-01 |

---

## I. Long-term architecture recommendations

1. **Ship updates as versioned images.**
   - Pin `image: bytecrapos-api:${VERSION}` / `bytecrapos-web:${VERSION}` and update with `pull` + `up -d`.
   - Keep the previous tag for rollback.
   - Run the preflight and pre-migration backup as a one-shot `migrate` service that the API depends on.

   This removes the whole class of F-UPD findings and keeps UI and API versions in lockstep.
2. **Formalise "write paths live in services."** Services take `client` and never `req`/`res` (already true). Controllers parse and validate input, call one service, and shape the response. Write it into a short `CONTRIBUTING.md` and enforce it in review.
3. **One money model end to end.** Integer fils (or NUMERIC strings parsed by a decimal helper) in both server and client, with one rounding rule and one VAT module. Share the pure functions through `shared/` so the client and server totals cannot diverge.
4. **Share validation schemas.** Zod is already in both packages. Move request schemas for money endpoints into `shared/` so the client form validation and the server parse are the same code.
5. **Treat the database as the last line of defence.**
   - Keep adding invariants as constraints (open drawer uniqueness, paid ≤ total, journal immutability), each preceded by a reconcile check and a `NOT VALID` → `VALIDATE` path.
   - Make `scripts/reconcile.js` a scheduled job whose result shows on the dashboard.
6. **Operational baseline for unattended shops.**
   - Structured JSON logs with request IDs (already propagated).
   - Container log rotation.
   - A health endpoint that reports backup age and the last successful off-host copy.
   - A documented, rehearsed restore.
7. **Test pyramid adjustments.**
   - Keep the real-DB integration style; it is the project's strongest QA asset.
   - Add: migration-from-previous-release tests with dirty data, live race tests for each money flow, one browser end-to-end checkout, and a restore round trip.
   - Measure coverage across `server/**` rather than three files.
8. **Keep it simple.** One process, one database, raw SQL, Zustand. Revisit only with evidence, such as a measured bottleneck or a real multi-store requirement.

---

## J. Final engineering verdict

1. **Is the repository professionally organized?**
   *Mostly.* The code layout is conventional and clear. The root, docs and leftovers are not: there are eight report files, an obsolete release guide, Electron, PM2 and FastAPI remnants, and tracked build artefacts. Two hours of tidy-up would fix most of it.

2. **Is the architecture suitable for this POS system?**
   *Yes.* A modular monolith with PostgreSQL as the source of truth, row locking and in-transaction ledger posting is the right shape for a multi-till, single-shop LAN POS.

3. **Is business logic properly separated?**
   *Partially.* Services never depend on HTTP, and the core sale, return and payment logic is in services. However, 42 of 62 controllers contain SQL, and four controllers hold complete money or stock workflows. Several rules are duplicated, and one duplicate (supplier returns) already produces different accounting.

4. **Is the code maintainable?**
   *Moderately.* It is readable and unusually well commented about *why*. Maintainability is limited by 200–630-line functions, non-strict TypeScript with no linter, duplicated rounding and VAT, and documentation that disagrees with the code.

5. **Is the system unnecessarily complicated?**
   *Not in its core.* Over-engineering is limited to peripheral items: the unmounted FastAPI sidecar, write-only browser caches, an offline queue nobody uses, and file-based settings beside the settings table. Under-engineering is the bigger issue, in update, rollback and recovery.

6. **Are there dangerous architectural weaknesses?**
   *Yes, in lifecycle, not in transaction design:*
   - the updater that diverges on container recreate, with no newer-schema guard;
   - unsigned updates;
   - migrations that crash-loop on legacy data;
   - backups on the same volume set as the database;
   - an unproven restore.

7. **Can another developer realistically maintain this codebase?**
   *Yes, with onboarding help.* The comments, consistent naming, error-code catalogue, route-permission contract test and real-DB tests make it learnable. The misleading README and the large functions are the main obstacles.

8. **Which five improvements deliver the greatest engineering value?**
   1. Image-based updates, with a boot guard now (F-UPD-01/02/03).
   2. Pre-upgrade preflight for dirty legacy data (F-MIG-01).
   3. Off-volume backups plus a tested restore round trip (F-BAK-01/02).
   4. DB timeouts, a consistent lock order and deadlock retry (F-OPS-03, F-TX-01).
   5. ESLint `react-hooks` and stricter TS on the frontend, with the two POS screens consolidated (F-FE-11, F-FE-04).

9. **Which parts should remain unchanged?**
   - The transaction design: services take `client`, emits happen after commit, the sorted `lockVariants`, and the single stock engine.
   - The idempotency machinery: `runOnce`, `checkoutId`, payment keys.
   - The DB constraints and the balancing trigger.
   - The session and auth model and the route-permission contract test.
   - The socket audience registry.
   - Backup encryption (AES-256-GCM with AAD).
   - The pre-migration backup and the one-transaction-per-migration runner.
   - The frontend HTTP layer and checkout recovery.
   - The real-PostgreSQL integration test style.
   - Raw parameterised SQL.

10. **What must be resolved before calling the system production-ready?**
    For *new* single-shop installs, the selling path is already production-grade. For *maintaining existing customer installations over years*, these P0 items must be done first:
    - the boot guard, and the in-app installer disabled or made image-based (F-UPD-01);
    - the upgrade preflight (F-MIG-01);
    - backups off the database's volume, with an off-host destination (F-BAK-01);
    - a restore that has been executed successfully in CI and rehearsed once per shop (F-BAK-02);
    - the category seed fix and the permission grants (F-MIG-04, F-MIG-03);
    - DB timeouts and graceful shutdown (F-OPS-03, F-OPS-01);
    - multer 2.x (F-SEC-01);
    - a README that matches the deployment (F-DOC-01).

---

*End of report. Verified facts are labelled **Confirmed**. Inferred impacts are labelled **Likely**. Items not fully checked are labelled **Needs Verification**. No application code, configuration, database or deployment was modified during this audit.*
