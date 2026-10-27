# Authentication & Authorization Security Audit

**System:** Bytecra POS / Mahali Light  
**Audit date:** 2026-10-26  
**Scope:** Frontend (Next.js), Express API and Socket.IO, and PostgreSQL authentication/authorization state  
**Method:** Read-only source trace, configuration review, schema/migration review, and safe existing tests. No application code, configuration, production data, or database was modified.

## Executive summary

The application has a credible server-side authorization foundation: API requests are authenticated against both a signed JWT and a live PostgreSQL session row; JWTs are stored in the database only as SHA-256 hashes; effective permissions are reloaded from PostgreSQL on every request; user/role administration has hierarchy and anti-self-escalation checks; force logout closes every open database session and disconnects its sockets; and first-run setup uses a high-entropy, time-limited code whose hash is stored transactionally.

No verified Critical issue was found. One High issue and eight Medium/Low issues were verified from the implementation. The highest-risk issue is that the documented/default production topology exposes login credentials and bearer tokens over plaintext HTTP on the LAN. The most important authorization defect is that Socket.IO event audiences are based on broad role names or global broadcasts rather than effective granular permissions, so a user-level deny does not prevent delivery of some protected realtime data.

Other material findings are: refresh tokens are actually renewable access tokens with no absolute session lifetime; an unattended but connected terminal never reaches the claimed 30-minute logout; account lockout is race-prone and can be weaponized to deny login to a known account; the minimum password policy is only six characters; and the database does not enforce one open session per user/device under concurrent logins.

Static and mocked tests passed, but the PostgreSQL-backed route, setup, and session-lifecycle suites were skipped because the explicit local test database port was not configured. Consequently, database-integrated behavior is clearly marked as not dynamically tested even where source-level evidence is conclusive.

## Findings table

| ID | Severity | Status | Feature | Result |
|---|---|---|---|---|
| AUTH-01 | High | FAIL | Login/session transport | Default production topology permits plaintext passwords and bearer tokens over the LAN. |
| AUTH-02 | Medium | FAIL | JWT refresh/lifetime | `/auth/refresh` renews an access token without an absolute session lifetime or separate refresh credential. |
| AUTH-03 | Medium | FAIL | Inactivity/session invalidation | Connected unattended terminals remain authenticated; the 30-minute sweep measures connection loss, not user inactivity. |
| AUTH-04 | Medium | FAIL | Granular authorization / Socket.IO | Realtime events bypass effective user permission overrides through role-wide/global broadcasts. |
| AUTH-05 | Medium | FAIL | Brute-force protection | Username lockout is non-atomic and enables targeted account lockout denial of service. |
| AUTH-06 | Medium | FAIL | Password security | Six-character passwords are accepted and setup uses a fixed lower bcrypt cost. |
| AUTH-07 | Medium | FAIL | Concurrent session isolation | Concurrent same-user/same-device logins can create multiple open sessions. |
| AUTH-08 | Low | FAIL | Login privacy | Inactive usernames are distinguishable from nonexistent/wrong-password accounts. |
| AUTH-09 | Low | FAIL | Logout failure handling | A failed logout clears the browser token while the server bearer session can remain usable. |
| AUTH-10 | Low | PASS | JWT validation and DB session binding | API authentication verifies signature/expiry and requires a live hashed-token session. |
| AUTH-11 | Low | PASS | Force logout and RBAC administration | Force logout, permission reload, hierarchy, and anti-self-escalation controls are implemented server-side. |
| AUTH-12 | Low | PASS | First-run setup/admin creation | Setup code secrecy, expiry, one-time completion, transaction locking, and production seed behavior are sound. |
| AUTH-13 | Low | NOT TESTED | Full PostgreSQL integration | Existing live-PostgreSQL authz/setup/presence suites could not run without the opt-in test DB port. |

Severity on PASS entries represents residual risk/assurance priority, not a vulnerability.

## Detailed findings

### AUTH-01 — Plaintext credential and bearer-token transport is enabled by default

- **Severity:** High
- **Status:** FAIL
- **Feature and vulnerability description:** The production Docker configuration publishes Express directly on the LAN and defaults both the web UI and Express to HTTP. Login passwords, JWT Authorization headers, setup codes, and Socket.IO handshake tokens can therefore cross the local network without transport encryption. The optional Caddy service protects the web page on port 443, but Express remains published on port 3000; browser sockets are deliberately directed to that Express port. A hostile LAN client, compromised access point, or traffic-capture position can steal reusable credentials/tokens.
- **File path, line number, and function/configuration:**
  - `docker-compose.yml:61-65` — `SERVER_USE_HTTPS` defaults to `false` and `${API_PORT:-3000}` is host-published.
  - `.env.example:48,55` — plaintext Express is the example default and API port 3000 is exposed.
  - `web/lib/config.ts:30-42` — `resolveOrigin()` defaults Electron/API traffic to `http`.
  - `web/lib/config.ts:55-63` — `getSocketUrl()` connects browsers directly to the published Express port.
  - `server/index.js:175-207` — server explicitly falls back to HTTP and only warns in production.
- **Evidence:** Code/configuration trace. The deployment guide also instructs operators to open firewall port 3000 and documents plain HTTP desktop access. No secret or token was captured during this audit.
- **Safe reproduction:** On an isolated test LAN using dummy credentials, deploy with the provided defaults, open `http://TEST_SERVER/`, and inspect the browser network request to `POST /api/auth/login` or the Socket.IO connection. Confirm the scheme is `http`/`ws`, without recording the request body or Authorization value.
- **Root cause:** TLS is optional and fail-open; the API is directly host-published for sockets instead of being reachable only through the TLS reverse proxy.
- **Recommended fix:** Make TLS mandatory in production and fail startup if a certificate cannot be loaded. Route both HTTP API and WebSocket traffic through one HTTPS origin, remove the host-published plaintext API port (or firewall it to localhost/container networks), redirect HTTP to HTTPS, and document certificate trust/bootstrap for all tills.

### AUTH-02 — Refresh permits indefinite sliding sessions and is not a distinct refresh-token flow

- **Severity:** Medium
- **Status:** FAIL
- **Feature and vulnerability description:** `/auth/refresh` accepts the current access JWT, issues another full-lifetime JWT, and replaces the stored hash. There is no absolute session expiry, refresh-token family, reuse detection, or maximum renewal age in PostgreSQL. Anyone possessing a token can renew it before expiry indefinitely. Separately, the frontend exports `refresh()` but has no caller, so normal clients hard-expire instead of using the advertised refresh feature.
- **File path, line number, and function:**
  - `server/middleware/auth.js:20-29` — `signToken()`/`verifyToken()`; default lifetime is eight hours.
  - `server/routes/auth.js:9` — refresh is protected only by the current access token.
  - `server/controllers/authController.js:245-257` — `refresh()` rotates the session hash and returns a new access token.
  - `server/db/migrations/001_init.sql:53-64` and `server/db/migrations/020_token_hash.sql:14-30` — sessions have no absolute expiry or refresh-family fields.
  - `web/services/authService.ts:63-66` — frontend `refresh()` exists; repository search found no call site.
- **Evidence:** Verified by source trace and repository-wide search for `/auth/refresh`/`refresh()` usage. No live token was generated.
- **Safe reproduction:** In an isolated test database, log in with a dummy account, call `/api/auth/refresh` shortly before expiry, and decode only the non-secret JWT timestamps locally. Repeat to observe a fresh full lifetime and unchanged lack of absolute expiry. Verify the old token is rejected after hash rotation.
- **Root cause:** Access-token renewal and refresh-session management are conflated; the session table records revocation state but no absolute lifetime.
- **Recommended fix:** Use short-lived access tokens plus one-time, hashed refresh tokens with rotation/reuse detection; bind them to a session family with `created_at`, `absolute_expires_at`, and `revoked_at`. Enforce both idle and absolute lifetimes in PostgreSQL queries. Add a single-flight frontend refresh path and test concurrent refresh races.

### AUTH-03 — “Inactivity” logout tracks connectivity, not human activity

- **Severity:** Medium
- **Status:** FAIL
- **Feature and vulnerability description:** The frontend correctly reports whether real input occurred, and idle presence uses `last_activity_at`. However, every heartbeat updates `last_seen_at`, and the 30-minute logout sweep uses `COALESCE(last_seen_at, last_activity_at)`. An unlocked, unattended till with a live socket therefore remains authenticated until JWT expiry (or refresh extends it), despite being marked idle after five minutes. This is material for shared POS terminals.
- **File path, line number, and function:**
  - `web/store/socketStore.ts:14-28,567-573` — activity tracking and 30-second heartbeat.
  - `server/socket/index.js:116-150` — heartbeat always refreshes `last_seen_at` but only conditionally updates `last_activity_at`.
  - `server/socket/index.js:215-265` — timeout sweeper uses `last_seen_at`, not human activity.
  - `server/db/migrations/049_session_last_seen.sql:1-13` — schema explicitly separates the timestamps.
- **Evidence:** Direct data-flow trace from user input to heartbeat payload to PostgreSQL timeout predicate. Existing test `an unattended screen goes idle while staying connected` was present but skipped because the live test database was unavailable; it tests presence state, not logout.
- **Safe reproduction:** In an isolated environment, sign in with a dummy account, leave the page connected without input for more than 30 minutes, then call a harmless authenticated GET such as `/api/auth/me`. The session remains valid while `status` becomes `idle`.
- **Root cause:** The timeout is implemented as a disconnected-client cleanup mechanism but is described and surfaced as inactivity logout.
- **Recommended fix:** Decide and document separate idle and disconnect policies. For shared terminals, revoke based on `last_activity_at`; do not let passive heartbeats extend authentication. Retain `last_seen_at` only for presence/connectivity and add configurable idle plus absolute limits.

### AUTH-04 — Socket.IO authorization does not honor granular effective permissions

- **Severity:** Medium
- **Status:** FAIL
- **Feature and vulnerability description:** Every authenticated socket joins a role-name room, regardless of user-level permission denies, and many events are sent to `role:Manager`/`role:Admin` or globally to all authenticated sockets. Consequently, denying a Manager `cash.view`, `bank.view`, `stock.view`, or another permission does not reliably stop realtime delivery. Custom roles granted equivalent permissions can also miss events. Global `stock_updated`, drawer, invoice-PDF, and warranty events disclose identifiers, quantities, balances, and workflow metadata to users lacking the corresponding REST permission.
- **File path, line number, and function:**
  - `server/socket/index.js:37-66,74-93` — handshake authentication and unconditional `socket.join(role:...)`.
  - `server/services/presenceService.js:101-109` — permission changes reconnect sockets but they rejoin the same role room.
  - `server/services/stockService.js:292-306,343-355` — `stock_updated` is globally broadcast with product, quantity, actor, and reference data.
  - `server/services/cashService.js:423-431` — `drawer_opened` is global and includes opening balance; balance updates use role rooms.
  - `server/services/invoiceService.js:783-788,841-869` — role/global invoice and PDF/print metadata events.
- **Evidence:** Verified source-level audience mismatch. The PO discussion subscription is a positive counterexample: `server/socket/index.js:152-180` reloads effective permissions before joining the resource room. Existing socket tests passed for that specific PO flow but do not cover general event audiences.
- **Safe reproduction:** In an isolated database, give a Manager a user-level deny for `cash.view`, connect its socket, then have an authorized account open the cash drawer. Observe that the denied Manager socket still receives the role/global cash event. Use dummy balances only.
- **Root cause:** Realtime authorization is modeled by hard-coded role names/global broadcasts rather than the effective permission set used by REST middleware.
- **Recommended fix:** Join permission-scoped rooms derived from current effective permissions (for example `permission:cash.view`) or filter every event per socket. Never use `io.emit` for protected domain data. Recompute rooms after role/override changes and add deny-override/custom-role integration tests for every sensitive event family.

### AUTH-05 — Account lockout is race-prone and enables targeted denial of service

- **Severity:** Medium
- **Status:** FAIL
- **Feature and vulnerability description:** Lockout checks count prior failures and record the current failure in a separate query. Concurrent guesses can all observe fewer than five failures and proceed, exceeding the intended threshold. Conversely, any unauthenticated client that knows a username can create five failures and block even the correct password for the rolling window. Locked attempts are also recorded, allowing an attacker to keep a known account locked with periodic batches. The IP limiter reduces volume but does not prevent a targeted five-attempt lockout.
- **File path, line number, and function:**
  - `server/controllers/authController.js:28-45` — `recordAttempt()` and `isLockedOut()` are separate operations.
  - `server/controllers/authController.js:72-103` — `login()` performs check-then-record and reports 423 before password verification.
  - `server/middleware/rateLimiter.js:25-36` — 20 attempts per 15 minutes per IP.
  - `server/db/migrations/021_login_attempts_index.sql:21-22` — index exists, but no atomic lockout state/constraint exists.
- **Evidence:** Source-level race analysis. The mocked login suite passed the serial five-failure behavior; it does not exercise concurrency. Live PostgreSQL tests were unavailable.
- **Safe reproduction:** Against an isolated dummy account, issue six parallel wrong-password requests from one test client before any completes; inspect sanitized statuses and the isolated `login_attempts` count. Separately, submit five serial failures and verify a correct password receives 423. Do not perform this against production accounts.
- **Root cause:** Audit events are used as mutable lockout state without a row lock, atomic counter, successful-login reset, or administrative recovery path.
- **Recommended fix:** Maintain lockout state atomically per normalized username/account (failed count, window start, `locked_until`) under row locking or a single `UPDATE ... RETURNING`. Add exponential backoff, reset on successful authentication, an audited admin unlock path, and alerts. Keep the IP limiter as defense in depth.

### AUTH-06 — Password policy permits weak credentials and setup hashing is inconsistent

- **Severity:** Medium
- **Status:** FAIL
- **Feature and vulnerability description:** User creation, password reset, and initial Admin setup accept six-character passwords with no blocklist, breach check, or strength requirement. The setup UI displays a strength meter but the API enforces only length, so it can be bypassed. Normal account creation defaults to bcrypt cost 12, while first-run Admin setup hard-codes cost 10 and ignores `BCRYPT_ROUNDS`.
- **File path, line number, and function:**
  - `server/controllers/usersController.js:21-39` — create/update schemas accept six characters.
  - `server/controllers/usersController.js:143-144,249-252` — user password hashing uses configurable default cost 12.
  - `server/controllers/setupController.js:68-74` — setup Admin schema accepts six characters.
  - `server/services/setupService.js:90-108` — Admin password uses fixed bcrypt cost 10.
  - `web/app/(auth)/setup/page.tsx:87-96` — strength is calculated only for display.
- **Evidence:** Source and schema trace; bcrypt usage itself is correct and plaintext passwords are not stored.
- **Safe reproduction:** In an isolated first-run database, submit an otherwise valid setup payload with a six-character dummy password. The API schema accepts it and creates a bcrypt hash. Do not use a real password.
- **Root cause:** Legacy minimum-length validation and duplicated hashing configuration between user creation and setup.
- **Recommended fix:** Enforce a server-side minimum of at least 12 characters (prefer longer passphrases), reject common/compromised passwords, allow password-manager-friendly length, and centralize hashing/cost validation. Require a password change for any development bootstrap account and consider MFA for administrative actions.

### AUTH-07 — Same-device session replacement has a database race

- **Severity:** Medium
- **Status:** FAIL
- **Feature and vulnerability description:** Login attempts to keep only one open session per `(user_id, pc_identifier)` by updating old rows and then inserting. Two concurrent transactions can both see no open row and both insert, because PostgreSQL uses default READ COMMITTED isolation and there is no partial unique constraint. Both JWTs then remain valid, defeating deterministic same-device replacement and complicating force-logout/presence semantics.
- **File path, line number, and function:**
  - `server/controllers/authController.js:109-138` — `login()` update-then-insert transaction.
  - `server/db/postgres.js:52-64` — `withTransaction()` uses default transaction isolation and no advisory/row lock.
  - `server/db/migrations/001_init.sql:53-64,96-98` — no uniqueness constraint for open user/device sessions.
- **Evidence:** Verified transaction/schema race by source inspection. No production or local database was exercised.
- **Safe reproduction:** In an isolated database, send two synchronized successful login requests for the same dummy user and `pcIdentifier`, then query only the count of rows where `logout_at IS NULL`. Under the race, the count can be two.
- **Root cause:** Application-level uniqueness is not backed by a database constraint or serialization lock.
- **Recommended fix:** Add a partial unique index on `(user_id, pc_identifier) WHERE logout_at IS NULL` and handle conflict deterministically, or acquire an advisory lock keyed to user/device before replacement. Add a concurrent-login integration test.

### AUTH-08 — Login response reveals inactive account existence

- **Severity:** Low
- **Status:** FAIL
- **Feature and vulnerability description:** A nonexistent username and wrong password return generic 401 invalid-credentials, but an inactive account returns a distinct 403 `AUTH_ACCOUNT_INACTIVE` before password comparison. This lets unauthenticated callers enumerate valid inactive usernames and their state.
- **File path, line number, and function:** `server/controllers/authController.js:84-103` — `login()` user lookup, inactive check, and password check; `web/hooks/useLoginForm.ts:57-67` displays distinct messages.
- **Evidence:** Existing test `authController.login > returns 403 when the account is inactive` passed, while nonexistent/wrong-password cases passed with 401.
- **Safe reproduction:** In a local test fixture, compare sanitized response code/status for an inactive dummy username and a random nonexistent username using the same dummy password.
- **Root cause:** Account-state feedback is returned before credential verification.
- **Recommended fix:** Return the same external status/code/message and comparable work factor for nonexistent, inactive, and wrong-password attempts. Record the true reason only in protected audit logs.

### AUTH-09 — Failed logout leaves a valid server session after local credentials are erased

- **Severity:** Low
- **Status:** FAIL
- **Feature and vulnerability description:** The frontend retries logout twice, then always deletes its local token. If both requests fail before reaching the API, the corresponding PostgreSQL session is still open and the bearer token remains usable by any party that previously copied it. For a connected socket the server may continue receiving heartbeats; for a disconnected client cleanup can take 30 minutes. The warning to the user is accurate but does not revoke the credential.
- **File path, line number, and function:**
  - `web/services/authService.ts:34-60` — `logout()` retries then unconditionally calls `logoutLocal()`.
  - `web/hooks/useSignOut.ts:8-19` — UI always disconnects/navigates after the attempt.
  - `server/controllers/authController.js:188-239` — server revocation occurs only if the authenticated request arrives.
  - `server/socket/index.js:215-265` — disconnected-session cleanup window.
- **Evidence:** Frontend tests passed both the confirmed logout case and the two-failure path that clears local state while warning that the server session remains open.
- **Safe reproduction:** In an isolated environment, log in with a dummy account, block the logout request in the browser network tools, and click sign out. Restore networking and use a separately retained test token to call `/api/auth/me`; it remains valid until server-side timeout/expiry. Destroy the test session afterward.
- **Root cause:** Bearer-token logout cannot be guaranteed while offline, and no deferred revocation marker or short access-token lifetime limits the exposure.
- **Recommended fix:** Prefer short-lived access tokens plus server-managed refresh sessions, queue a session-ID revocation for retry, and provide an authenticated “log out all devices” recovery path. Clearly distinguish local sign-out from confirmed server revocation.

### AUTH-10 — JWT signature/expiry and PostgreSQL session validation are correctly chained

- **Severity:** Low
- **Status:** PASS
- **Feature and vulnerability description:** API authentication rejects missing, invalid, and expired bearer tokens; then looks up the SHA-256 token hash in PostgreSQL, rejects closed/missing sessions, reloads the current user/role/permissions, and rejects inactive accounts. Logout or force logout therefore invalidates subsequent API requests even if JWT `exp` has not elapsed.
- **File path, line number, and function:** `server/middleware/auth.js:6-29,32-74,77-140` — `hashToken()`, `signToken()`, `verifyToken()`, `loadUserContext()`, and `requireAuth()`; `server/db/migrations/020_token_hash.sql:14-30` — plaintext token removal and unique hash index; `server/index.js:100-140` — JWT secret startup guard.
- **Evidence:** Source trace confirms the full chain. Startup rejects missing/short secrets and rejects known placeholder prefixes in production. Authentication controller tests passed and responses did not expose `password_hash`.
- **Safe reproduction:** In an isolated test app, call a protected GET with no token, a tampered token, an expired token, a valid token with no session row, and a valid token whose session has `logout_at` set. Expect 401 for each; expect 403 for a valid session tied to an inactive user.
- **Root cause:** Not applicable (validated control).
- **Recommended fix:** Preserve this design. Add explicit allowed algorithms plus issuer/audience validation, direct middleware tests, and absolute session-expiry fields as defense in depth.

### AUTH-11 — Force logout and core RBAC administration are server-enforced

- **Severity:** Low
- **Status:** PASS
- **Feature and vulnerability description:** Protected routers use `requireAuth()` and permission middleware; effective role plus user overrides are loaded on each request. User/role mutations enforce role hierarchy, prohibit self role/permission changes, reserve system role names, and restrict delegation. Force logout closes all open sessions atomically in PostgreSQL and disconnects per-session sockets server-side, so an uncooperative client cannot preserve future access.
- **File path, line number, and function:**
  - `server/middleware/permissions.js:3-41` — permission enforcement.
  - `shared/authzPolicy.js:43-200` — Admin identity, hierarchy, delegation, and self-modification rules.
  - `server/routes/users.js:8-17` and `server/routes/roles.js:8-17` — route wiring.
  - `server/controllers/usersController.js:194-303,305-407,481-561` — update/deactivate/force logout/user permission controls.
  - `server/services/presenceService.js:69-109` — session revocation and socket disconnection.
- **Evidence:** 32 privilege-escalation/ownership/permission unit and contract assertions passed; the earlier selected suite added passing authorization-policy and middleware assertions. Repository scan found every authenticated business router except search and updates using permission middleware; search filters each query by effective permission and updates performs an Admin controller check. Finding AUTH-04 remains an exception for outbound realtime events.
- **Safe reproduction:** With isolated Admin, Manager, and Cashier fixtures, attempt user creation as Cashier, Admin force logout as Manager, peer role modification, self permission modification, and unauthorized product creation. Expect 403 and no data mutation.
- **Root cause:** Not applicable (validated control).
- **Recommended fix:** Preserve server-side enforcement. Expand route-level real-HTTP tests across every router and add automated inventory checks so a newly added route cannot omit an authorization policy.

### AUTH-12 — First-run setup and production Admin seeding are protected

- **Severity:** Low
- **Status:** PASS
- **Feature and vulnerability description:** Production seeding does not create a default Admin. While setup is incomplete, a random 16-character code (about 80 bits) is printed/written only on the server; only its SHA-256 hash is stored, comparisons are timing-safe, guessing endpoints are rate-limited, and completion clears the token. Setup locks the app-settings row with `FOR UPDATE`, rechecks completion/Admin presence inside the transaction, and therefore prevents duplicate concurrent setup. The setup status endpoint does not return the code.
- **File path, line number, and function:**
  - `server/db/seed.js:175-198` — production skips `admin/admin123`.
  - `server/services/setupTokenService.js:18-37,50-87,90-105,107-150` — code generation, storage, expiry, validation, and clearing.
  - `server/controllers/setupController.js:10-45,90-156` — safe status, complete, and verify-code endpoints.
  - `server/services/setupService.js:27-56,88-117,133-141` — transaction lock, Admin creation guard, completion, and token clearing.
  - `server/index.js:287-290` — setup guessing rate limits.
- **Evidence:** Six setup security contract tests passed. PostgreSQL-backed setup-code and trust-boundary tests were discovered but skipped because the opt-in test database was unavailable.
- **Safe reproduction:** On a disposable fresh database, confirm `/api/setup/status` omits the code, invalid/missing codes receive 403, a valid code completes setup once, replay receives 409, and parallel completion attempts create only one Admin.
- **Root cause:** Not applicable (validated control).
- **Recommended fix:** Preserve these controls. Apply the stronger password policy from AUTH-06, use the configured bcrypt cost, and restrict filesystem/log access to the setup code.

### AUTH-13 — Full live-PostgreSQL authorization validation was unavailable

- **Severity:** Low
- **Status:** NOT TESTED
- **Feature and vulnerability description:** The repository contains strong real-HTTP/PostgreSQL suites for route RBAC, setup-code lifecycle, trust boundaries, presence, logout, force logout, and session replacement. They are gated on `INVOICE_TEST_PG_PORT`; without that explicit isolated test service, Vitest skipped them. This is a coverage limitation, not evidence of a vulnerability.
- **File path, line number, and function:** `tests/integration/routeAuthorization.test.js:22-24`, `tests/integration/presenceLifecycle.test.js`, `tests/integration/setupCode.test.js`, and `tests/integration/trustBoundary.test.js` — opt-in live database suites.
- **Evidence:** Selected root run: 5 test files passed, 4 skipped; 62 tests passed, 29 skipped. Skipped cases were the live PostgreSQL suites. No attempt was made to connect to or create a production database.
- **Safe reproduction:** Provision an isolated disposable PostgreSQL instance, set only the documented test-specific environment variables, run the four suites, and verify teardown drops only their randomized test databases.
- **Root cause:** The audit environment did not provide the explicitly selected local test database port.
- **Recommended fix:** Run these suites in CI against an ephemeral PostgreSQL service and make their skipped status visible/failing in the security pipeline.

## Feature-by-feature trace

| Feature | Frontend | Express / Socket.IO | PostgreSQL | Audit outcome |
|---|---|---|---|---|
| Login/logout | `useLoginForm`, `authService`, `useSignOut`, session-storage auth store | `authController.login/logout`, login limiter, session middleware | `users`, `login_attempts`, `user_sessions` | Core flow works; transport, lockout, and failed-logout gaps remain. |
| JWT expiry/validation/refresh | Axios attaches bearer token; 401 interceptor clears only the matching current session; refresh export is unused | JWT signature/expiry check plus live session lookup; refresh rotates token hash | Only token hash stored; no absolute expiry/refresh family | Validation passes; refresh/lifetime design fails. |
| Force logout/invalidation | Socket handles `force_logout`; stale-request race avoids clearing a newer session | Hierarchy check, DB revocation, per-session socket disconnect | `logout_at`, `logout_type`, `status` updated | PASS for completed server-side revocation; offline manual logout caveat. |
| RBAC/granular permissions | Sidebar/gates improve UX but are not trusted | Permission middleware and authz policy protect REST; socket audiences diverge | Role permissions plus grant/deny overrides | REST/admin controls pass; realtime enforcement fails. |
| API bypass/escalation | Direct navigation is possible but API remains authority | Nearly all business routes are permission-wired; search filters by permission; update controller checks Admin | Effective permissions loaded per request | No verified REST privilege escalation; live route matrix not fully run. |
| Session isolation/concurrency | Per-tab `sessionStorage`; per-browser device identifier | Same-device replacement and force logout | Multiple device sessions allowed; no unique open user/device constraint | Intended multi-device isolation works serially; concurrent race fails. |
| Brute force/passwords | Generic wrong-password UI; inactive state is distinct; setup strength is display-only | IP rate limit, username lockout, bcrypt verification | Attempts indexed; bcrypt hashes stored | Layered protection exists but lockout and password policy fail. |
| Initial setup/Admin | Operator enters server-only code | Setup limiter, validation, transactionally locked completion | Hash/issue time stored; token cleared after completion | PASS except weak Admin password rule/cost. |

## Test coverage and results

Commands were limited to repository tests and read-only inspection.

| Test selection | Result | Security areas |
|---|---|---|
| Root auth/authz/setup/presence/trust/proxy selection | **62 passed, 29 skipped** across 9 files | Login outcomes, error sanitization, role hierarchy, permission contracts, setup controller behavior, trusted proxy/IP limiter behavior. The 29 skipped tests require live PostgreSQL. |
| Additional privilege/ownership/socket selection | **32 passed** across 6 files | Privilege escalation policy, attendance/leave ownership, approval permissions, PO discussion room permission enforcement. |
| Frontend auth/error/presence selection | **12 passed** across 3 files | Confirmed/unconfirmed logout behavior, stale-token 401 race, presence UI permissions and update ordering. |
| Total dynamically executed | **106 passed, 29 skipped** | No failing existing test in the selected security scope. |

Not covered dynamically in this audit: actual TLS packet protection, JWT expiry with a real clock/session row, concurrent refresh, concurrent login race, idle timeout beyond 30 minutes, and the full real-HTTP/PostgreSQL route matrix. Safe reproduction steps above are intended for a disposable test environment.

## Prioritized remediation plan

1. **P0 — Enforce encrypted transport:** terminate TLS for UI, API, and Socket.IO on one origin; stop exposing plaintext Express to the LAN; fail closed in production.
2. **P0 — Correct realtime authorization:** replace global/role-name audiences with effective permission-scoped delivery and test user-level denies/custom roles.
3. **P1 — Redesign session lifetime/refresh:** short access tokens, rotating hashed refresh families, reuse detection, absolute expiry, and single-flight client refresh.
4. **P1 — Enforce real idle logout:** revoke based on human `last_activity_at`, keep connectivity separate, and make idle/absolute limits configurable.
5. **P1 — Make brute-force state atomic:** add `locked_until`/atomic counters, successful-login reset, recovery workflow, monitoring, and concurrency tests.
6. **P1 — Strengthen passwords:** server-enforced long-password policy, common/breached-password rejection, centralized bcrypt cost, and stronger Admin bootstrap rules.
7. **P2 — Enforce session uniqueness in PostgreSQL:** partial unique index or advisory lock for open `(user_id, pc_identifier)` sessions.
8. **P2 — Normalize authentication errors:** hide inactive-account state from unauthenticated callers.
9. **P2 — Improve offline logout guarantees:** deferred revocation/retry and a clear “log out all devices” recovery control.
10. **P2 — Make live security tests mandatory in CI:** ephemeral PostgreSQL, no silent skips, plus tests for all findings above.

## Overall conclusion

Bytecra POS’s REST authorization and first-run setup design are substantially stronger than a UI-only RBAC implementation: authorization is enforced in Express against current PostgreSQL state, and server-side revocation is real. The system should not, however, be considered secure for a hostile or shared LAN until TLS is mandatory and Socket.IO audiences enforce effective permissions. Session lifetime, idle logout, brute-force state, password policy, and concurrency guarantees should be addressed next.
