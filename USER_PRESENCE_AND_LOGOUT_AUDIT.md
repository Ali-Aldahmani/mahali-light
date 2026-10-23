# User Presence and Logout Audit

Audit date: 2026-10-23 (Asia/Dubai)  
Project: D:/Projects/mahali-light  
Reviewed HEAD: 4b2190368559e3a8e3426adb4048e2dd71b757cf, **plus the existing working-tree changes**.  
Scope: authentication, presence, online-user identity, session lifetime, logout, realtime delivery, deployment wiring, and related authorization/performance.

## 1. Executive Summary

**Verdict: not production-ready for reliable, secure multi-terminal presence and logout.** There is a real server-side session system and a live Socket.IO event path, but those mechanisms do not consistently agree with the database or either online-user UI.

The most consequential defects are:

- Established sockets outlive session revocation and JWT expiration; authorization is checked only during connection establishment.
- Browser terminals identify themselves using the **server hostname**, so two PCs accessing the same server have the same PC identifier. A second login for the same account replaces the first PC's session.
- The header's online-user list never reconciles missed events after reconnect. Stale entries can remain indefinitely.
- Multiple connections and sessions are not aggregated consistently; one tab disconnecting can mark a still-connected session offline.
- The header shows account usernames, discarding the available authoritative employee names.
- The Users page has a different definition of online and no presence-event subscription.
- A failed logout still clears browser authentication and navigates away, without confirmation that server revocation happened.

**Executed checks:** 25 isolated source-level checks: **11 PASS, 14 FAIL**. These are direct executions of repository functions with fake SQL, sockets, timers, and browser state. They are not LAN, real PostgreSQL, real browser, or production integration tests. A FAIL denotes a failed expected behavior, including successful reproduction of a defect. PASS is limited to the explicitly tested mocked boundary.

**Read-only constraints:** No application code, existing files, database records/schema, dependencies, Docker configuration, or services were changed. No real account was authenticated, logged out, disabled, or otherwise touched. No HTTP request, actual socket connection, database connection, Docker command, build, migration, or load test was run. The only file created by this audit is this report. Existing modified and untracked files were left untouched. Secrets and live session records were not read.

### Explicit answers

| Question | Answer supported by this audit |
|---|---|
| Is online status genuinely live? | **Partially.** Login/connection/disconnection generate server events, and heartbeats update session rows. The resulting flag is not a reliable current connection/authentication lease. See F01, F05, F07, F08, F11. |
| Does the UI update without refresh? | **Header: an event-driven path exists**, but delivery/recovery is unreliable. **Users page: no live presence subscription or periodic presence refresh.** Physical PC-B to PC-C delivery and latency: NOT TESTED. |
| Is the correct username shown? | Initial/event usernames come from authoritative user records and stable user IDs. However, the header does **not show real employee names**, and names/roles can become stale after edits. See F09. |
| Does logout invalidate the backend session? | Successful logout writes logout_at and offline status for the current session; REST subsequently checks logout_at. Verified at mocked controller/middleware boundaries (T20, T03). Existing sockets are not forcibly invalidated. |
| Can old credentials still access APIs? | A revoked or expired JWT is rejected by the tested Express middleware. An unrevoked token after failed logout, browser closure, or password change can remain usable until revocation/expiry. An already connected socket retains access to its existing broadcasts/heartbeat handler after revocation or expiry. Optional FastAPI has equivalent REST checks in source, but was not executed. |
| Does closing the browser eventually mark the user offline? | With healthy server/database, socket disconnect should set offline; missed disconnect has a 30-minute inactivity cleanup fallback. Users-page state and a manager that missed events may remain stale. Real closure/crash: NOT TESTED. |
| Does disconnecting Ethernet eventually mark the user offline? | Expected transport timeout then disconnect update with healthy server/database; local Engine.IO defaults suggest roughly 20–45 seconds, not a measured SLA. Cleanup fallback and UI caveats apply. Physical unplug: NOT TESTED. |
| Does Docker restart leave stale online users? | **It can.** Immediate process exit does not clear persisted flags; startup does not reconcile them with live sockets. Fresh snapshots can contain stale rows until sweep, and existing viewers can retain missed events indefinitely. Actual restart: NOT TESTED. |
| Are multiple sessions handled correctly? | **No.** Shared browser PC IDs, per-session disconnect without connection counting, mismatched snapshot/event aggregation, and same-second token collisions break important cases. |
| Can a user remain falsely online forever? | **Yes, with qualifications.** A mounted viewer that misses an offline event has no reconciliation/expiry. An expired-but-connected socket can keep an open session's activity fresh indefinitely. A completely abandoned session with no activity is normally revoked by a healthy sweeper after 30 minutes, so not every stale database row persists forever. |
| Is the implementation secure and production-ready? | **No for this audited scope.** Successful REST revocation is a useful control, but socket revocation, device isolation, presence recovery, and deployment transport need correction and isolated end-to-end validation. |

### Evidence and confidence conventions

High confidence means the behavior is directly supported by source and/or a focused isolated reproduction. Medium confidence is used for deployment- or concurrency-dependent outcomes not exercised with real infrastructure. Source line links refer to the working tree reviewed, not necessarily the deployed image. Database migrations establish intended schema; their live application was not verified.

All planned real-environment tests below are explicitly **NOT TESTED**. No unexecuted scenario is labeled PASS.

## 2. Discovered Architecture

| Component | Discovery and evidence |
|---|---|
| Frontend | Next.js declared ^15.1.0, React ^18.3.1, Zustand ^4.5.5, Axios, socket.io-client ^4.8.0: [web/package.json](D:/Projects/mahali-light/web/package.json:1). |
| Core backend | Node.js/Express ^4.19.2; custom authentication, bcrypt, jsonwebtoken ^9.0.2, pg ^8.13.0, Socket.IO ^4.8.0: [package.json](D:/Projects/mahali-light/package.json:36). No NextAuth/Auth.js session implementation was found in the traced path. |
| Database | PostgreSQL 16 in Compose, persistent named volume, no published PostgreSQL port: [docker-compose.yml](D:/Projects/mahali-light/docker-compose.yml:9). pg pool defaults to maximum 10 connections: [postgres.js](D:/Projects/mahali-light/server/db/postgres.js:8). |
| Optional backend | FastAPI in Docker profile ml, SQLAlchemy/psycopg; JWT plus shared PostgreSQL session lookup: [pyproject.toml](D:/Projects/mahali-light/backend-fastapi/pyproject.toml:7), [security.py](D:/Projects/mahali-light/backend-fastapi/app/core/security.py:88), [Compose](D:/Projects/mahali-light/docker-compose.yml:138). |
| API proxy | Browser REST calls use same-origin /api, Next rewrites to Express: [config.ts](D:/Projects/mahali-light/web/lib/config.ts:18), [next.config.mjs](D:/Projects/mahali-light/web/next.config.mjs:20). |
| Authentication | Login compares bcrypt password, checks user active and lockout, loads DB user/permissions, signs JWT: [authController.js](D:/Projects/mahali-light/server/controllers/authController.js:71). Default JWT lifetime 8 hours: [auth.js](D:/Projects/mahali-light/server/middleware/auth.js:17). |
| Session model | UUID session rows with user_id, pc_identifier, login/logout/activity times, status; hashed bearer token replaces plaintext token: [001_init.sql](D:/Projects/mahali-light/server/db/migrations/001_init.sql:53), [020_token_hash.sql](D:/Projects/mahali-light/server/db/migrations/020_token_hash.sql:14). |
| Token storage | Zustand persists token/user/permissions in sessionStorage; removes the legacy localStorage auth key. This is script-readable storage, not an HttpOnly cookie: [authStore.ts](D:/Projects/mahali-light/web/store/authStore.ts:5), [authStore.ts](D:/Projects/mahali-light/web/store/authStore.ts:41). Axios attaches Bearer: [http.ts](D:/Projects/mahali-light/web/services/http.ts:16). |
| Refresh | Authenticated POST /auth/refresh rotates the same session's JWT hash. There is no separate refresh-token record, cookie, family, or revocation chain in this path: [routes/auth.js](D:/Projects/mahali-light/server/routes/auth.js:7), [authController.js](D:/Projects/mahali-light/server/controllers/authController.js:252). No automatic caller of authService.refresh was found in the reviewed frontend. |
| Realtime | JWT in Socket.IO handshake auth payload, websocket-only client transport, direct API host/port, per-user/session/role rooms: [socketStore.ts](D:/Projects/mahali-light/web/store/socketStore.ts:94), [socket/index.js](D:/Projects/mahali-light/server/socket/index.js:28). No SSE or presence polling fallback found. |
| Heartbeat | Client emits every 30 seconds while connected. Server writes last_activity_at and online status: [socketStore.ts](D:/Projects/mahali-light/web/store/socketStore.ts:531), [socket/index.js](D:/Projects/mahali-light/server/socket/index.js:74). |
| Cleanup | Two 60-second sweepers: idle after 5 minutes, hard logout after 30 minutes without activity. Nightly retention defaults to 30 days for sessions: [socket/index.js](D:/Projects/mahali-light/server/socket/index.js:100), [dbCleanup.js](D:/Projects/mahali-light/server/jobs/dbCleanup.js:64). |
| Presence UI | Header fetches one initial /presence snapshot and consumes socket events. Team Users page fetches /users separately: [PresenceWidget.tsx](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:18), [UsersPage.tsx](D:/Projects/mahali-light/web/components/team/UsersPage.tsx:42). |
| Deployment | Next, Express, PostgreSQL, Caddy HTTPS gateway; optional FastAPI. Default exposed web/API ports 80/3000: [Compose](D:/Projects/mahali-light/docker-compose.yml:61), [Compose](D:/Projects/mahali-light/docker-compose.yml:100). Running configuration, image freshness, env overrides, firewall and certificates: NOT TESTED. |

### Login → presence → logout trace

1. authService.login submits username/password plus PC_IDENTIFIER; on success it persists returned token/user in sessionStorage ([authService.ts](D:/Projects/mahali-light/web/services/authService.ts:21)).
2. Express validates credentials and active account. It creates a JWT, transactionally closes prior open sessions for the same user/PC identifier, inserts an online session with token hash, updates PC registry, logs activity, optionally checks attendance in, and broadcasts user_online ([authController.js](D:/Projects/mahali-light/server/controllers/authController.js:105)).
3. Dashboard layout connects Socket.IO when token exists and disconnects on token change/unmount ([layout.tsx](D:/Projects/mahali-light/web/app/(dashboard)/layout.tsx:134), [layout.tsx](D:/Projects/mahali-light/web/app/(dashboard)/layout.tsx:225)).
4. Socket handshake verifies JWT and an unclosed session, derives username/role/PC from DB, joins rooms, broadcasts user_online. It does not set database status online at connection time ([socket/index.js](D:/Projects/mahali-light/server/socket/index.js:29)).
5. Authorized header viewers fetch /presence once; socket events mutate an in-memory Zustand list. Heartbeats update the database but do not publish authoritative snapshots or activity timestamps.
6. Header sign-out calls POST /auth/logout. Middleware verifies JWT/session/user, controller sets logout_at and offline for req.sessionId, optionally checks attendance out if no other unclosed employee session, and emits user_offline. Frontend clears local auth in finally, disconnects, and navigates to login ([useSignOut.ts](D:/Projects/mahali-light/web/hooks/useSignOut.ts:9), [authController.js](D:/Projects/mahali-light/server/controllers/authController.js:188)).
7. Admin force logout closes all selected user's currently open session rows and emits force_logout to session rooms. It does not call server-side disconnectSockets ([usersController.js](D:/Projects/mahali-light/server/controllers/usersController.js:339)).

## 3. Online Status Accuracy

The current implementation has five different concepts that should not be treated as equivalent:

| Concept | Current implementation |
|---|---|
| Authenticated | Valid unexpired JWT, open session row, and active user on an Express request. The frontend only checks token/user existence until a server rejection. |
| Connected | Socket.IO connection is established; server rooms know sockets, but database presence does not count or lease them. |
| Active human | Not measured. No user-interaction timestamp participates in presence. |
| Idle | Database last_activity_at older than five minutes; automatic heartbeat and REST requests reset that same timestamp. |
| Offline | A mutable session status written by disconnect/logout; /users instead means no unclosed session, while a stale browser list can disagree with both. |

### F07 — Two incompatible online definitions; Users page is not realtime

**Severity: Medium. Confidence: High.**

**Evidence:** [usersController.js:44](D:/Projects/mahali-light/server/controllers/usersController.js:44) defines is_online as any session with logout_at IS NULL, without checking status, age, token expiry, or user active state. [presence.js:31](D:/Projects/mahali-light/server/routes/presence.js:31) excludes offline sessions but has no freshness/expiry predicate. [UsersPage.tsx:42](D:/Projects/mahali-light/web/components/team/UsersPage.tsx:42) fetches on page/search changes and local actions; [UsersPage.tsx:114](D:/Projects/mahali-light/web/components/team/UsersPage.tsx:114) displays the returned isOnline. There is no socket/presence-store subscription.

**Impact:** A disconnected cashier may disappear from the header yet remain online on the Users page. A manager can keep seeing stale badges until a manual/navigation-driven refetch. Authenticated-but-disconnected is mislabeled online.

**Recommended fix:** Define one server-side presence aggregation over currently valid, fresh connection/session leases, and subscribe both interfaces to it. Distinguish signed-in from connected.

**Verification:** Isolated end-to-end test: disconnect a valid session without logout and compare fresh /users, /presence, and both UIs; then log in/out on another PC without refreshing the manager. **NOT TESTED end-to-end; source finding.**

### F08 — Heartbeats prevent meaningful idle detection and can preserve expired presence

**Severity: Medium for idle accuracy; High when combined with F01. Confidence: High.**

**Evidence:** [socketStore.ts:531](D:/Projects/mahali-light/web/store/socketStore.ts:531) emits every 30 seconds regardless of human input; [socket/index.js:77](D:/Projects/mahali-light/server/socket/index.js:77) updates the same last_activity_at used by idle/timeout sweepers at [line 110](D:/Projects/mahali-light/server/socket/index.js:110) and [line 158](D:/Projects/mahali-light/server/socket/index.js:158). All authenticated Express requests also touch it ([auth.js:127](D:/Projects/mahali-light/server/middleware/auth.js:127)). Heartbeats send no online/active event back to viewers.

**Impact:** An unattended connected till normally remains Online rather than Idle. An expired JWT's still-connected socket can keep its session fresh indefinitely. A previously idle UI entry is not restored by heartbeat alone; its displayed lastActivityAt is not updated.

**Recommended fix:** Separate last_connection_seen, last_user_activity, and authentication expiry. Enforce server time/expiry independently of heartbeats, derive idle from explicit activity, and publish status transitions.

**Verification:** With a fake clock or isolated browser, leave the user inactive for >5 minutes while heartbeats continue, then interact; separately expire the JWT while connected. T11 confirms no heartbeat token validation; full timed behavior **NOT TESTED**.

## 4. Real-Time Cross-Device Synchronization

The happy-path event chain exists: login emits user_online, manager socket handler upserts, Zustand rerenders the header. Logout emits user_offline and removes an entry. No manual refresh is required for a delivered event. This is code evidence, not proof that the deployed network path delivers it.

### F06 — Missed events and snapshot races are never reconciled

**Severity: High. Confidence: High.**

**Evidence:** Initial fetch only at [PresenceWidget.tsx:18](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:18); reconnect only resyncs stock at [socketStore.ts:107](D:/Projects/mahali-light/web/store/socketStore.ts:107). Disconnect only changes isConnected at [line 122](D:/Projects/mahali-light/web/store/socketStore.ts:122). Explicit disconnect clears socket/timer but not presence at [line 540](D:/Projects/mahali-light/web/store/socketStore.ts:540). Events contain no revision and snapshot completion overwrites the entire list at [PresenceWidget.tsx:32](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:32).

**Impact:** If manager PC-C disconnects while cashier PC-B logs out, PC-C can reconnect and retain B forever. Its own connection status recovers while the list remains wrong. A stale initial snapshot arriving after an event can undo the event. Previous presence can survive a logout/login until a successful new snapshot.

**Recommended fix:** Fetch a versioned authoritative snapshot on every successful connect/reconnect and auth-context change; reconcile buffered events by revision; reset on sign-out and visibly mark disconnected snapshots stale. Add periodic reconciliation as a safety net.

**Verification:** **T22 FAIL** (reconnect resyncs stock but retains departed user), **T23 FAIL** (explicit disconnect retains presence). Simulated HTTP snapshot/event ordering and actual LAN delivery remain **NOT TESTED**.

### Delivery and latency

- Login broadcast is after transaction, attempt recording, optional attendance and activity logging; connection also broadcasts. These are two events, not an acknowledged presence transaction.
- Socket connection emits to other sockets but not a presence snapshot to the connecting socket.
- Reconnect broadcasts online immediately, but database status can remain offline until the next 30-second client heartbeat. **T13 FAIL** reproduces absence of an online write on connect.
- The stored lastActivityAt is dropped when an event replaces the snapshot entry: [presenceStore.ts:23](D:/Projects/mahali-light/web/store/presenceStore.ts:23). **T24 FAIL**.
- No propagation-latency measurement was performed. Browser render delay, LAN throughput, proxy upgrades, firewall behavior and production build wiring are **NOT TESTED**.
- Source-based transport failure detection is discussed in section 7; it is not measured cross-device propagation latency.

## 5. Username and Identity Accuracy

User IDs are UUIDs, usernames are unique at the intended schema level, and employee names are joined through employee_id ([001_init.sql:42](D:/Projects/mahali-light/server/db/migrations/001_init.sql:42)). Login and websocket events take identity from authenticated DB lookups rather than client-supplied display-name fields. Heartbeat ignores client payload and uses socket.data.sessionId: **T21 PASS**.

Two people with the same employee name remain distinguishable by stable user IDs and unique usernames. This does not ensure legal/real-world identity verification of the employee record; no such verification was inspected.

### F09 — Header omits real names and does not receive identity changes

**Severity: Medium. Confidence: High.**

**Evidence:** /presence returns employeeName at [presence.js:43](D:/Projects/mahali-light/server/routes/presence.js:43), but the widget's mapping omits it at [PresenceWidget.tsx:24](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:24), rendering only username at [line 98](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:98). Online events omit employee names ([authController.js:174](D:/Projects/mahali-light/server/controllers/authController.js:174), [socket/index.js:72](D:/Projects/mahali-light/server/socket/index.js:72)). User edits return HTTP data without broadcasting identity updates ([usersController.js:231](D:/Projects/mahali-light/server/controllers/usersController.js:231), [line 278](D:/Projects/mahali-light/server/controllers/usersController.js:278)).

**Impact:** The stated requirement to show real names is not met by the header. Existing viewers can show old usernames/roles after an edit, and an established socket has cached old identity. The Users page does show employee name plus @username ([UsersPage.tsx:84](D:/Projects/mahali-light/web/components/team/UsersPage.tsx:84)); the account menu also has full_name, so the issue is specifically inconsistent presence rendering/freshness.

**Recommended fix:** Return and emit a canonical identity DTO with userId, current username and employee/display name. Display real name with username as a disambiguator and update by stable ID on identity change/reconciliation.

**Verification:** Seed two isolated users with the same employee name and different IDs/usernames; rename one while connected and verify all surfaces without refresh. **NOT TESTED in a rendered browser.** T21 verifies server-side binding only; T24 demonstrates metadata loss in event merging.

## 6. Logout and Session Revocation

### Controls observed and tested

- Logout is a protected POST: [routes/auth.js:8](D:/Projects/mahali-light/server/routes/auth.js:8).
- Successful controller execution issues a revocation UPDATE for req.sessionId and emits offline: **T20 PASS with fake database**.
- Express verifies JWT expiration then hashed session lookup/logout_at on each request: [auth.js:84](D:/Projects/mahali-light/server/middleware/auth.js:84). **T01–T04 PASS** for missing, expired, revoked, disabled cases.
- Disconnect alone intentionally leaves logout_at null; a valid bearer token is still accepted despite status offline: **T05 PASS**. This verifies the separation of connection and authentication, not that logout happened.
- Refresh rotates token_hash in the same row ([authController.js:252](D:/Projects/mahali-light/server/controllers/authController.js:252)); when the new hash differs, old-token REST lookup should fail. There is no separate refresh token to revoke.
- Passwords are login credentials, not bearer sessions. Manual logout does not prevent a person who still knows the password from logging in again.
- Optional FastAPI verifies expiry, session revocation and active user ([security.py:88](D:/Projects/mahali-light/backend-fastapi/app/core/security.py:88)); code reviewed, **NOT TESTED**.
- Logout does not cancel business requests already authorized before revocation. No claim is made that in-flight transactions are rolled back.

### F01 — Revocation and expiry do not terminate established WebSocket authorization

**Severity: High. Confidence: High.**

**Evidence:** JWT/session checks occur only in [socket/index.js:29](D:/Projects/mahali-light/server/socket/index.js:29). Heartbeat performs an unconditional session UPDATE at [line 77](D:/Projects/mahali-light/server/socket/index.js:77); no logout_at, active-user or expiry condition. Manual logout changes DB and emits offline without disconnecting the session's sockets ([authController.js:188](D:/Projects/mahali-light/server/controllers/authController.js:188)). Force logout only emits a message at [usersController.js:390](D:/Projects/mahali-light/server/controllers/usersController.js:390). The normal browser cooperates by clearing auth; a custom/stale client need not.

**Impact:** A revoked/expired established socket can remain in user/session/role rooms, receive subsequent broadcasts, and send heartbeats. It can write status online on a revoked row. **This does not clear logout_at and therefore does not restore REST authorization or necessarily return the revoked row in /presence.** Expired-but-unrevoked rows can stay in /presence indefinitely because heartbeats prevent timeout.

**Recommended fix:** Server-enforced disconnect of affected session/user rooms on logout/replacement/disable/expiry, revalidation for accepted events, conditional heartbeat updates, and server-side expiry timers or bounded auth leases. Recompute role subscriptions on permission changes. Never rely on a client obeying force_logout.

**Verification:** **T10 FAIL** (unconditional heartbeat after revocation), **T11 FAIL** (no ongoing JWT validation). **T07/T08 PASS** show new handshakes reject revoked/expired credentials. Actual post-revocation delivery and timed expiry in a real Socket.IO server are **NOT TESTED**; source establishes that no disconnect/revalidation is performed.

### F10 — Logout failure creates a local sign-out without confirmed server revocation

**Severity: High. Confidence: High.**

**Evidence:** [authService.ts:33](D:/Projects/mahali-light/web/services/authService.ts:33) clears auth in finally regardless of POST outcome. [useSignOut.ts:12](D:/Projects/mahali-light/web/hooks/useSignOut.ts:12) disconnects and navigates in finally. The mobile path also catches failure then performs local cleanup ([MobileAccount.tsx:17](D:/Projects/mahali-light/web/components/mobile/screens/MobileAccount.tsx:17)). No pending revocation/retry state is recorded.

**Impact:** On failure before server UPDATE, a copied JWT can still call protected APIs until its expiry or later server revocation. Disconnect only sets offline. With no further use, the 30-minute sweeper is a fallback; a bearer holder making requests can keep activity fresh. Conversely, a failure after the UPDATE may mean logout succeeded but the response/event failed. The UI cannot distinguish the two.

**Recommended fix:** Keep immediate local lock/sign-out, but explicitly distinguish confirmed server revocation from an unconfirmed attempt. Use an idempotent revocation protocol and a safe retry/reconciliation mechanism; do not keep a usable token exposed just to retry. Apply bounded session lifetimes so an unavailable logout endpoint cannot create unbounded remote access.

**Verification:** **T19 FAIL** reproduces local-token clearing after a synthetic API failure. In isolated integration, inject failure before UPDATE, after UPDATE, and on response delivery; replay the original bearer and verify user-visible outcome. Actual credential replay: **NOT TESTED**.

### F04 — Same-second JWT generation is not unique per session

**Severity: Medium. Confidence: High.**

**Evidence:** JWT payload contains only sub/username plus library-generated timestamps ([authController.js:106](D:/Projects/mahali-light/server/controllers/authController.js:106), [auth.js:17](D:/Projects/mahali-light/server/middleware/auth.js:17)); no random jti or unique session identifier. The schema requires unique token_hash ([020_token_hash.sql:24](D:/Projects/mahali-light/server/db/migrations/020_token_hash.sql:24)). Refresh uses the same payload ([authController.js:255](D:/Projects/mahali-light/server/controllers/authController.js:255)).

**Impact:** Two logins for the same identity in the same issuance second produce identical tokens, so the second insertion conflicts with the intended unique index, even on different PCs. The transaction should roll back the preceding replacement UPDATE on conflict, rather than safely create a second session. Refresh in the same issuance second may return the exact same token, so it does not revoke the old string. No claim of a successful duplicate-row insertion is made.

**Recommended fix:** Generate a cryptographically random jti and/or sign a pre-created unique session ID; ensure each refresh creates a new credential generation.

**Verification:** **T18 FAIL**, using actual signToken/jsonwebtoken with a fixed issuance second, produced identical token strings/hashes. PostgreSQL unique-violation handling and concurrent login requests: **NOT TESTED**.

## 7. Disconnection and Reconnection

For a normal live server, disconnect attempts a DB offline update and emits offline only after the write succeeds ([socket/index.js:85](D:/Projects/mahali-light/server/socket/index.js:85)). No browser-unload logout is required for this path, and none was found in the authentication flow.

Installed Engine.IO source defaults to pingInterval 25 seconds and pingTimeout 20 seconds ([server.js:48](D:/Projects/mahali-light/node_modules/engine.io/build/server.js:48)); the application does not override them. Depending on the last ping, an undetected hard network loss is expected to take approximately 20–45 seconds before transport disconnect under healthy scheduling. A normal close can be detected sooner. These are **source-derived timing expectations**, not measured results or a guarantee for the deployed dependency version.

When no activity reaches the database, the 60-second timeout sweep selects sessions older than 30 minutes. Ideal cleanup is roughly 30–31 minutes after the last activity, but scheduling, failures, and races can extend it. The five-minute idle sweep is not offline cleanup: idle rows remain in /presence.

### F11 — Restart and database failure leave persisted presence without a freshness guarantee

**Severity: Medium. Confidence: High for source; Medium for deployment timing.**

**Evidence:** SIGTERM/SIGINT call process.exit immediately ([server/index.js:437](D:/Projects/mahali-light/server/index.js:437)); no session cleanup/draining there. attachSocket starts timers without a startup presence reconciliation ([socket/index.js:13](D:/Projects/mahali-light/server/socket/index.js:13)). /presence trusts status/logout_at without a maximum age ([presence.js:31](D:/Projects/mahali-light/server/routes/presence.js:31)). Disconnect/heartbeat/sweep failures are swallowed ([socket/index.js:80](D:/Projects/mahali-light/server/socket/index.js:80), [line 94](D:/Projects/mahali-light/server/socket/index.js:94), [line 148](D:/Projects/mahali-light/server/socket/index.js:148)).

**Impact:** API/Docker restart destroys sockets but can leave online session rows in the persistent database. Users who do not reconnect can appear online/idle until sweep. If DB is unavailable during disconnect, both the write and offline broadcast are lost; the handler does not retry. Reconnected sockets announce online before restoring database status (T13). A manager's missed events are not repaired (F06). Nightly pruning is not a realtime solution.

**Recommended fix:** Use expiring presence leases with a server-instance generation; filter stale leases on reads independent of cleanup. Reconcile on startup, refresh lease atomically at connect, provide a bounded retry/recovery path, and expose heartbeat/sweep errors and lag in metrics.

**Verification:** T13 identifies the connect/write gap; T22 identifies missing client recovery. Restart Express/Docker/PostgreSQL and inject failed disconnect writes **only in a disposable stack**; assert bounded freshness and recovery. **NOT TESTED with actual services.**

Reconnection uses unlimited attempts, initial delay 1.5 seconds ([socketStore.ts:99](D:/Projects/mahali-light/web/store/socketStore.ts:99)). Installed client defaults add jitter 0.5 and a five-second maximum delay ([manager.js:55](D:/Projects/mahali-light/web/node_modules/socket.io-client/build/cjs/manager.js:55)); therefore this audit does not claim absence of backoff/jitter. On rejected reconnect credentials the frontend clears auth if it is still the same token ([socketStore.ts:124](D:/Projects/mahali-light/web/store/socketStore.ts:124)). Authentication-expiry errors are handled, but transport failure has no presence recovery mechanism.

## 8. Multi-Device Session Handling

### F03 — Browser PC identifier identifies the server, not the terminal

**Severity: High. Confidence: High.**

**Evidence:** Browser fallback is window.location.hostname + "-web" ([config.ts:81](D:/Projects/mahali-light/web/lib/config.ts:81)); browser hostname also reports the server ([authService.ts:17](D:/Projects/mahali-light/web/services/authService.ts:17)). Login sends that identifier ([authService.ts:26](D:/Projects/mahali-light/web/services/authService.ts:26)) and replaces all open sessions for the same user/identifier ([authController.js:114](D:/Projects/mahali-light/server/controllers/authController.js:114)).

**Impact:** PC-B and PC-C browsing http://pos-server both submit pos-server-web. The same user's second login revokes the first PC's session, although the first socket may still appear alive (F01). Different users do not replace each other, because replacement is also scoped by user ID; nevertheless their PC registry metadata points to a shared identifier. The identifier is client-controlled and is unsuitable as a trusted security boundary.

**Recommended fix:** Assign a stable enrolled terminal/browser installation identifier and keep it separate from server identity, user identity, session UUID, and connection UUID. Define whether same-terminal new login replaces all tabs; do not use a client hostname string as proof of a physical PC.

**Verification:** **T17 FAIL**, two independent synthetic browser contexts resolve the same identifier. Two real-PC logins and resulting row/revocation behavior: **NOT TESTED**.

### F05 — Session, connection, and user aggregation disagree

**Severity: High. Confidence: High.**

**Evidence:** Every socket disconnect sets its session offline without counting remaining sockets ([socket/index.js:85](D:/Projects/mahali-light/server/socket/index.js:85)). Snapshot returns DISTINCT ON user_id, one representative session ([presence.js:22](D:/Projects/mahali-light/server/routes/presence.js:22)); client upsert keys by userId + pcIdentifier ([presenceStore.ts:23](D:/Projects/mahali-light/web/store/presenceStore.ts:23)). Offline removes that pair; idle updates every entry for the user ([presenceStore.ts:30](D:/Projects/mahali-light/web/store/presenceStore.ts:30)). Events omit sessionId/connectionId.

**Impact:** Duplicated tabs sharing one token can cause false offline on one tab close while another is connected. A later heartbeat silently restores the database but does not restore the removed viewer entry. Users with distinct PC identifiers can appear twice after events despite a one-row snapshot. If the snapshot only represented PC-A and A logs out while B remains connected, removing A can remove the user's only visible entry. An old connection's late offline event can remove a newer same-user/PC entry.

**Recommended fix:** Track connections per session and aggregate user presence as any valid fresh connection. Publish consistent user-level summaries with device/session details separately. Include session/generation identifiers and event revisions; remove only the matching generation and recompute user state.

**Verification:** **T12 FAIL** for shared-session disconnect, **T15 FAIL** for duplicate user entries, **T16 FAIL** for user-wide idle. Full multi-browser lifecycle and event ordering: **NOT TESTED**.

### F12 — Concurrent lifecycle operations lack conditional state transitions

**Severity: Medium. Confidence: High for missing guards; Medium for race outcome.**

**Evidence:** Timeout SELECT precedes unconditional per-ID UPDATE ([socket/index.js:106](D:/Projects/mahali-light/server/socket/index.js:106), [line 115](D:/Projects/mahali-light/server/socket/index.js:115)); idle SELECT/UPDATE has the same pattern ([line 156](D:/Projects/mahali-light/server/socket/index.js:156)). Login replaces then inserts without a unique open-session user/PC constraint or explicit per-user lock ([authController.js:108](D:/Projects/mahali-light/server/controllers/authController.js:108)); migrations define only user index, unique token_hash, and open-activity index. Refresh unconditionally overwrites token_hash by id ([authController.js:257](D:/Projects/mahali-light/server/controllers/authController.js:257)).

**Impact:** A heartbeat/request arriving after timeout selection can still be logged out by the stale selection. Idle sweep can overwrite newer activity. Concurrent logins with distinct tokens can leave multiple open sessions for the same user/PC; identical tokens hit F04 instead. Overlapping refreshes with different issued tokens can return a token already superseded by another response. A concurrent logout is not undone by refresh because logout_at is not cleared, but a refresh response may nonetheless return an unusable token. Concurrent last-session logout/attendance checks can also make decisions from intermediate state.

**Recommended fix:** Conditional UPDATE with current revocation/freshness/generation predicates and RETURNING, atomic locking/constraints for the chosen session policy, compare-and-swap refresh with old hash, and consistent transaction boundaries around last-session side effects.

**Verification:** Use controlled barriers against a disposable PostgreSQL database for heartbeat-vs-timeout, two logins, two refreshes, and simultaneous last-session logout. **NOT TESTED concurrently.** T10/T12 demonstrate related unguarded handler operations, not real database race execution.

Admin "force logout" is the existing all-device path, permission/hierarchy gated ([routes/users.js:15](D:/Projects/mahali-light/server/routes/users.js:15), [usersController.js:348](D:/Projects/mahali-light/server/controllers/usersController.js:348)). Ordinary logout targets only current session. No ordinary self-service logout-all endpoint was found in [routes/auth.js](D:/Projects/mahali-light/server/routes/auth.js:7). The UI disables force logout on self ([UsersPage.tsx:159](D:/Projects/mahali-light/web/components/team/UsersPage.tsx:159)). Admin notification alone is not server-enforced socket termination.

## 9. Security Findings

### F02 — Account edits do not invalidate credentials or refresh socket authorization

**Severity: High. Confidence: High.**

**Evidence:** PUT user update can change is_active, password, role and username, but only updates the user row ([usersController.js:231](D:/Projects/mahali-light/server/controllers/usersController.js:231), [line 258](D:/Projects/mahali-light/server/controllers/usersController.js:258)). It does not revoke sessions or alter live socket rooms. Websocket session query lacks u.is_active ([socket/index.js:38](D:/Projects/mahali-light/server/socket/index.js:38)). Role membership is captured once at [line 69](D:/Projects/mahali-light/server/socket/index.js:69). Permission updates do not notify live auth context ([usersController.js:539](D:/Projects/mahali-light/server/controllers/usersController.js:539)). DELETE soft-deactivation does revoke rows ([line 318](D:/Projects/mahali-light/server/controllers/usersController.js:318)) but emits neither offline nor server disconnect.

**Impact:** A user disabled through PUT can open a new socket with an existing unclosed token; a password reset does not revoke stolen bearer credentials. A demoted user's existing socket remains in its prior role room. Soft-deactivated users lose REST access but can retain established socket subscriptions and stale UI entries. Actual physical SQL deletion would cascade sessions in the intended schema, but a live socket still has captured data until disconnected.

**Recommended fix:** Centralize user security mutations: revoke relevant sessions and server-disconnect on disable/delete/password reset as policy requires; invalidate role/permission caches and room memberships, and broadcast authoritative identity/presence changes. Include active-user validation in socket authentication and ongoing event authorization.

**Verification:** **T09 FAIL** (disabled user accepted with open session); **T04 PASS** (REST rejects disabled account). Isolated end-to-end password change, demotion, soft-delete and hard-delete: **NOT TESTED**.

### F13 — Realtime presence bypasses REST list permissions; frontend policy also disagrees

**Severity: Medium. Confidence: High.**

**Evidence:** /presence requires user.edit ([presence.js:9](D:/Projects/mahali-light/server/routes/presence.js:9)). user_online broadcasts to every connected socket ([socket/index.js:72](D:/Projects/mahali-light/server/socket/index.js:72), [authController.js:173](D:/Projects/mahali-light/server/controllers/authController.js:173)); offline/idle are also global. Widget allows user.edit OR user.force_logout ([PresenceWidget.tsx:16](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:16)) and silently swallows snapshot errors ([line 34](D:/Projects/mahali-light/web/components/layout/PresenceWidget.tsx:34)).

**Impact:** Authenticated users lacking list permission can collect usernames, roles, device identifiers and presence transitions from socket events even if the widget is hidden. A force-logout-only operator can see the widget but gets a rejected initial snapshot and an incomplete event-only list.

**Recommended fix:** Use one explicit presence-view policy across REST, websocket subscription, payload scope, and UI. Join an authorized observer room, remove access on permission changes, and handle snapshot permission failures visibly.

**Verification:** **T14 FAIL** proves broadcast is not scoped to authorized observers. **T25 PASS** confirms the REST user.edit gate rejects a force-logout-only user; combined with widget source this establishes the mismatch. Full rendered restricted-role test: **NOT TESTED**.

### F14 — Default LAN deployment exposes reusable bearer credentials over HTTP

**Severity: High if deployed with these defaults. Confidence: High for configuration; live exposure NOT TESTED.**

**Evidence:** Compose defaults SERVER_USE_HTTPS=false and publishes API 3000, web 80 ([docker-compose.yml:61](D:/Projects/mahali-light/docker-compose.yml:61), [line 104](D:/Projects/mahali-light/docker-compose.yml:104)). Server chooses HTTP when TLS is unavailable and can fall back even when requested ([server/index.js:189](D:/Projects/mahali-light/server/index.js:189)). Browser sends bearer Authorization headers ([http.ts:18](D:/Projects/mahali-light/web/services/http.ts:18)) and keeps JWT in script-readable sessionStorage ([authStore.ts:49](D:/Projects/mahali-light/web/store/authStore.ts:49)).

**Impact:** On an HTTP LAN deployment, someone able to observe/manipulate network traffic can obtain passwords/tokens. SessionStorage limits ordinary persistence but does not protect against same-origin script access/XSS. This audit did not demonstrate an XSS exploit, inspect live TLS, or extract credentials.

**Recommended fix:** Require trusted HTTPS/WSS for terminals with a consistent proxy topology and no silent production TLS downgrade. Restrict exposed ports. Assess HttpOnly secure cookie/session transport or another carefully scoped token design, alongside frontend script-injection defenses; changing storage alone does not fix socket revocation.

**Verification:** Inspect certificates and browser requests on an isolated LAN; verify no credential is sent over HTTP/WS and that expired/revoked credentials fail both channels. **NOT TESTED on deployed systems.**

### F15 — Default HTTPS gateway and direct websocket URL are inconsistent

**Severity: Medium. Confidence: High for default wiring; deployment-specific outcome untested.**

**Evidence:** Browser socket URL copies page protocol but targets the Express port ([config.ts:47](D:/Projects/mahali-light/web/lib/config.ts:47)). Caddy on 443 only proxies to Next ([Caddyfile:6](D:/Projects/mahali-light/docker/Caddyfile:6)); Next rewrites /api and /files only ([next.config.mjs:20](D:/Projects/mahali-light/web/next.config.mjs:20)). Express defaults to plaintext HTTP ([Compose:61](D:/Projects/mahali-light/docker-compose.yml:61)); its internal REST URL is also fixed to HTTP ([Compose:102](D:/Projects/mahali-light/docker-compose.yml:102)).

**Impact:** With defaults, a user opening the HTTPS gateway attempts a secure socket to the plaintext API port, so realtime presence is expected to fail even though proxied REST works. Simply enabling API HTTPS without aligning the internal proxy URL can break REST. The client has websocket-only transport, so it cannot fall back to polling.

**Recommended fix:** Route /socket.io and /api through one deliberate HTTPS/WSS reverse-proxy origin, or explicitly align and validate all internal/external protocols and certificates. Check custom port/public env configuration in the actual production build.

**Verification:** Build and run an isolated equivalent deployment, test HTTP and HTTPS entry points, observe websocket establishment and reconnect at the real configured ports. **NOT TESTED**; no build was performed.

### Additional security controls and limits

SHA-256 token hashes avoid storing reusable plaintext JWTs in the intended migrated table. Authentication checks database user activity and current permissions on every protected Express request. Login has per-username lockout ([authController.js:35](D:/Projects/mahali-light/server/controllers/authController.js:35)) and configured HTTP rate limiting ([server/index.js:276](D:/Projects/mahali-light/server/index.js:276)). These were inspected, not brute-force tested.

No unauthenticated client-controlled presence UPDATE route was found. Forged user IDs in heartbeat payload do not change the authenticated session target (T21). A legitimate or stolen authenticated socket can still abuse its own unconditional heartbeat path (F01/F16). CORS is not a replacement for authorization; no claim is made that CORS callbacks alone restrict native websocket clients.

## 10. Performance Findings

### F16 — Heartbeat writes are unbounded per authenticated socket; recovery work is not instrumented

**Severity: Medium. Confidence: High for operation counts; capacity impact unmeasured.**

**Evidence:** Every heartbeat issues one UPDATE, with no debounce/rate cap ([socket/index.js:74](D:/Projects/mahali-light/server/socket/index.js:74)). HTTP rate limiters are Express middleware ([server/index.js:286](D:/Projects/mahali-light/server/index.js:286)); they do not impose a heartbeat-event limit. requireAuth performs session lookup, user/role lookup, role-permission lookup, user overrides lookup, and a best-effort write per request ([auth.js:100](D:/Projects/mahali-light/server/middleware/auth.js:100), [auth.js:28](D:/Projects/mahali-light/server/middleware/auth.js:28)). Pool default is 10 ([postgres.js:15](D:/Projects/mahali-light/server/db/postgres.js:15)). Sweeps run every minute, sequentially process timed-out rows, and suppress failures ([socket/index.js:103](D:/Projects/mahali-light/server/socket/index.js:103)).

**Impact:** Normal heartbeat load is modest at 50 terminals, but multiple tabs multiply it. A custom authenticated client can emit far faster than the configured 30 seconds and consume DB connections/WAL/CPU. A restart burst makes many handshakes and online broadcasts; absence of presence recovery means the system can be quiet but wrong. Slow async sweeps can overlap because setInterval does not await the previous callback.

**Recommended fix:** Rate-limit/coalesce heartbeat events per connection/session, use short-lived connection leases and batched persistence if needed, cap connections per session, avoid overlapping sweeps, and monitor active socket counts, DB latency, heartbeat failures, cleanup lag and reconnect rates. Optimize measured bottlenecks without caching permissions indefinitely.

**Verification:** Synthetic clients in a disposable stack at 5/10/20/50 terminals, including tabs and bounded abnormal heartbeat rates. Measure DB writes/sec, pool wait, p95/p99 event delay, memory over repeated connect/disconnect, and sweep lag. **NOT TESTED under load.**

### Source-derived steady-state estimates

Assumptions: one active socket per terminal, one heartbeat per 30 seconds, no extra tabs, no HTTP application activity, continuous connection. These are calculations, not benchmark results.

| Terminals/sockets | Heartbeat UPDATEs/min | Average heartbeat UPDATEs/sec | Approx. server transport pings/min at 25s | Two sweep SELECTs/min baseline |
|---:|---:|---:|---:|---:|
| 5 | 10 | 0.33 | 12 | 2 |
| 10 | 20 | 0.67 | 24 | 2 |
| 20 | 40 | 1.33 | 48 | 2 |
| 50 | 100 | 3.33 | 120 | 2 |

At 50 terminals for an eight-hour shift, periodic heartbeats alone imply approximately **48,000 UPDATEs**, plus approximately five auth SQL operations for each protected Express request and all business queries. A 50-client reconnect can generate roughly 50 × 49 = **2,450 user_online recipient deliveries** from connection broadcasts alone, before other events. Delivery count is not a throughput measurement.

The intended schema includes a unique token-hash index, user index, and partial last_activity_at index for open sessions ([020_token_hash.sql:24](D:/Projects/mahali-light/server/db/migrations/020_token_hash.sql:24), [001_init.sql:97](D:/Projects/mahali-light/server/db/migrations/001_init.sql:97), [023_missing_indexes.sql:24](D:/Projects/mahali-light/server/db/migrations/023_missing_indexes.sql:24)). Query plans, applied indexes, row counts, dead tuples and actual pool settings were not inspected.

There is no periodic presence HTTP polling load in the reviewed widget. Socket cleanup removes client listeners and heartbeat timer ([socketStore.ts:540](D:/Projects/mahali-light/web/store/socketStore.ts:540)); page subscriber cleanup is present ([layout.tsx:225](D:/Projects/mahali-light/web/app/(dashboard)/layout.tsx:225)). Server sweep interval handles are not retained/disposed; normal bootstrap attaches once, so this is a lifecycle limitation for reattachment/tests rather than evidence of an accumulating production leak. **Memory leak and reconnect-storm measurements: NOT TESTED.**

## 11. Edge-Case Test Matrix

### Executed isolated checks

Environment: local Node v24.15.0; source executed via node:vm, with explicit dependency allowlists. Existing jsonwebtoken, zod and TypeScript were loaded; no dependency was installed. TypeScript modules were transpiled in memory. SQL was intercepted by mock functions; Socket.IO servers/clients, timers and browser state were fake objects. No actual server module entrypoint was imported. Tests were piped directly to node stdin, creating no harness file.

These tests verify function behavior and issued SQL/event decisions, **not SQL execution, deployed routing, actual broadcasts, browser rendering, or concurrency**. T11 tests the absence of heartbeat revalidation rather than waiting eight hours. T18 fixes the issuance second. T19 treats loss of revocation-recovery state as the failed requirement; immediate local lock itself remains desirable.

| ID | Test boundary / expected property | Result | Observed evidence |
|---|---|---|---|
| T01 | REST rejects missing credentials | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T02 | REST rejects expired token | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T03 | REST rejects revoked session | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T04 | REST rejects disabled account | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T05 | Valid REST token remains usable while socket status is offline | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T06 | Socket rejects missing credentials | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T07 | Socket rejects revoked credentials on new handshake | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T08 | Socket rejects expired credentials on new handshake | **PASS** | Expected assertion satisfied at the mocked boundary. |
| T09 | Socket rejects disabled account with an open session | **FAIL** | Handshake accepted disabled user; SQL does not filter u.is_active |
| T10 | Already connected socket rejects heartbeats after revocation | **FAIL** | Revoked socket issued unconditional last_activity_at/status=online UPDATE; no session recheck |
| T11 | Connected heartbeat revalidates JWT lifetime | **FAIL** | verifyToken called only at handshake; heartbeat did not revalidate token |
| T12 | Closing one of two sockets sharing a session preserves presence | **FAIL** | One socket disconnect unconditionally marks shared session offline and broadcasts user_offline |
| T13 | Reconnect marks DB session online before announcing online | **FAIL** | Connection broadcasts user_online without a DB online update; waits for later heartbeat |
| T14 | Presence events restricted to authorized observers | **FAIL** | Cashier connection broadcasts presence to every other authenticated socket |
| T15 | Same user across two PCs is one online-user entry | **FAIL** | One user becomes two entries after event from second PC  2 !== 1  |
| T16 | Session-specific idle does not idle a user active elsewhere | **FAIL** | Idle event changes all PCs for user  'idle' !== 'online'  |
| T17 | Browser PC identifier distinguishes two physical terminals | **FAIL** | Both independent browser contexts resolve to pos-server-web |
| T18 | Token issuance has per-session uniqueness in same second | **FAIL** | Same sub/username/iat produces identical JWT and token_hash; conflicts with unique DB index |
| T19 | Failed server logout retains recoverable revocation state | **FAIL** | API failure clears local token; no persisted pending revocation/retry in service |
| T20 | Successful logout controller revokes only current session and broadcasts | **PASS** | Controller SQL and event verified with mock database; no real SQL executed |
| T21 | Presence store retains server ID and username over attempted heartbeat spoofing | **PASS** | Heartbeat ignores client payload and uses authenticated sessionId |
| T22 | Manager reconnect reconciles missed offline events | **FAIL** | Reconnect resyncs stock only; departed user remains in presence store without a new snapshot  1 !== 0  |
| T23 | Explicit client disconnect clears stale presence between logins | **FAIL** | Disconnect clears socket/timer but leaves prior presence data  1 !== 0  |
| T24 | New presence event preserves authoritative snapshot metadata | **FAIL** | upsert replaces entire entry and drops lastActivityAt |
| T25 | Permission gate rejects presence access for force-logout-only role | **PASS** | Confirms REST policy; widget permits same role, so UI/API policy mismatch is a separate defect |

### Real-environment and concurrency scenarios

Every test in this table is **NOT TESTED** as a complete scenario. Relevant source predictions and isolated failures are provided separately to avoid labeling inferred behavior as a passing test.

| Scenario | Status | Source-based expected behavior / risk | Related finding or isolated check | Safe verification procedure |
|---|---|---|---|---|
| PC-B login appears on manager PC-C without refresh | NOT TESTED | Header event path exists; Users page does not subscribe; real name omitted in header. | F06, F07, F09 | Two disposable users/browsers; capture event and DOM times. |
| User closes browser normally without logout | NOT TESTED | Disconnect attempts offline but leaves session authenticated; Users page sees open session; fallback timeout. | F05, F07, F11; T05 | Close isolated browser; monitor authoritative state and both UIs. |
| Browser crash | NOT TESTED | Transport failure detection then offline; missed write/event can remain stale. | F06, F11 | Kill only disposable browser process. |
| User disconnects Ethernet/Wi-Fi | NOT TESTED | Expected ping timeout ~20–45s under defaults; no exact measured bound. | F11 | Isolate test terminal interface/network namespace. |
| User shuts down PC | NOT TESTED | Same hard-disconnect path; JWT is not necessarily revoked immediately. | F01, F11 | Power off dedicated test terminal, no live till. |
| Same user logs in from two PCs | NOT TESTED | Browser PC-ID collision replaces first session; same-second token collision can reject second login. | F03, F04; T17, T18 | Two devices, same server URL; inspect test sessions. |
| Two distinct enrolled PC identifiers | NOT TESTED | Backend allows sessions, snapshot collapses by user but events can duplicate. | F05; T15 | Separate synthetic device IDs and browser contexts. |
| Multiple tabs share same token/session | NOT TESTED | Closing one sets shared session offline, despite another connection. | F05; T12 | Duplicate test tab; count connections vs row/UI state. |
| Logout from only one PC while another remains connected | NOT TESTED | Current row revoked; aggregation can hide remaining session. | F05; T20 | Distinct test sessions; compare aggregate before/after. |
| Logout from all devices | NOT TESTED | Admin closes DB rows; established clients can ignore force_logout. | F01; T07, T10 | Disposable admin/user and one noncooperative socket. |
| Network loss then reconnect | NOT TESTED | DB online can lag heartbeat; missed list events not reconciled. | F06, F11; T13, T22 | Drop/re-enable test connection while another user logs out. |
| User disabled through PUT while online | NOT TESTED | REST rejects, sessions stay open; new socket lacks active-user check. | F02; T04, T09 | Disable test user then test REST/new and existing sockets. |
| User deactivated through DELETE | NOT TESTED | Session rows revoked; no offline broadcast/server disconnect. | F01, F02 | Soft-delete disposable user; monitor manager and socket rooms. |
| User physically deleted in DB | NOT TESTED | Intended FK cascade removes sessions; live socket still has captured identity. | F02 | Only disposable schema/data; verify FK and live socket behavior. |
| Display name or username changes | NOT TESTED | New snapshots use DB identity; existing header/connection cache stays stale. | F09; T24 | Two same-name users; rename one and observe both displays. |
| User JWT expires while connected | NOT TESTED | New REST/handshake rejects; established heartbeat keeps row fresh. | F01, F08; T02, T08, T11 | Short-lived synthetic token with controlled clock. |
| Server/Express container restarts | NOT TESTED | Persisted flags survive; reconnect does not resync list; sweep eventually handles abandoned rows. | F06, F11 | Restart disposable API only, sample before first sweep. |
| Full Docker stack restarts | NOT TESTED | Persistent sessions survive; no startup live-connection reconciliation. | F11 | Restart isolated stack with disposable volume. |
| PostgreSQL restarts/outage during disconnect | NOT TESTED | SQL fails; disconnect event skipped; errors swallowed, later sweep is fallback. | F11 | Pause disposable database and close a test socket. |
| Two sessions update presence simultaneously | NOT TESTED | Unversioned same-user/PC events can remove newer state; idle applies to all user entries. | F05, F12; T16 | Barrier-controlled old/new sessions and event ordering. |
| Heartbeat overlaps timeout sweep | NOT TESTED | Stale selected row can be unconditionally revoked despite new activity. | F12 | Transaction barriers in disposable PostgreSQL. |
| Simultaneous login/logout/refresh | NOT TESTED | Replacement, unique-token and last-writer races; refresh can return unusable token. | F04, F12 | Controlled clocks and barriers, capture each response/token. |
| Logout API fails before/after commit | NOT TESTED | Local cleanup occurs either way; server revocation outcome unknown to UI. | F10; T19, T20 | Fault injection at both phases; replay copied test bearer. |
| Websocket reconnects with revoked credentials | NOT TESTED | New handshake rejects; existing connection is different and remains vulnerable. | F01; T07 | Reconnect disposable socket with revoked test token. |
| Old bearer replay after confirmed logout | NOT TESTED | requireAuth should reject based on logout_at. | T03, T20 | Real isolated logout followed by protected GET using old token. |
| Unauthorized presence-list access/forged heartbeat | NOT TESTED | REST gated, socket broadcasts global; payload cannot choose another session. | F13; T06, T14, T21, T25 | Restricted role plus missing/forged synthetic tokens. |
| 5/10/20/50 terminals, reconnect and heartbeat stress | NOT TESTED | Estimated normal writes modest; unlimited event rates and pool contention unmeasured. | F16 | Disposable load environment with explicit resource bounds. |
| HTTPS UI and custom socket/API ports | NOT TESTED | Default HTTPS-to-plaintext API mismatch expected. | F15 | Isolated built deployment and trusted test certificates. |

Existing tests were read, not executed: [auth.test.js](D:/Projects/mahali-light/tests/integration/auth.test.js:203) covers login with mocked signing/database; [PresenceWidget.test.tsx](D:/Projects/mahali-light/web/components/layout/PresenceWidget.test.tsx:17) checks rendering permissions with mocked listOnline. They do not establish actual multi-device revocation, socket recovery, or real PostgreSQL semantics. The normal test runner was not used to avoid possible cache/report/setup-file writes beyond the one permitted report.

## 12. Prioritized Recommendations

No recommendation below was implemented.

| Priority | Recommendation | Findings | Acceptance criteria |
|---|---|---|---|
| P0 — before release | Enforce socket revocation/expiry on server; disconnect affected sessions and revalidate events/rooms. | F01, F02 | Revoked/expired/disabled client cannot send accepted events or receive protected future events, including noncooperative clients. |
| P0 — before release | Replace server-hostname device identity; bind unique JWTs to unique sessions. | F03, F04 | Two actual PCs remain independently authenticated; same-second logins create unique credentials according to explicit policy. |
| P0 — before release | Require consistent trusted HTTPS/WSS and validate proxy/socket routing. | F14, F15 | REST and socket credentials never traverse plaintext LAN; all supported entry points connect and reconnect. |
| P1 — required correctness | Implement per-connection leases and a canonical aggregate per user/session with freshness and revisions. | F05, F07, F08, F11 | One-tab close does not hide another connection; all views agree; stale online has a defined bounded lifetime. |
| P1 — required correctness | Reconcile presence at connect/reconnect/auth change and safely merge snapshots/events. | F06 | Manager converges after missed login/logout and reordered snapshots without refresh. |
| P1 — security/recovery | Make logout idempotent with distinguishable confirmed/unconfirmed outcomes and bounded revocation recovery. | F10 | Fault injection never silently presents an unconfirmed remote session as fully revoked. |
| P1 — authorization | Use a shared presence-view policy across REST, rooms and frontend. | F13 | Restricted clients receive neither snapshots nor unauthorized presence events. |
| P1 — identity requirement | Preserve authoritative real name + username + stable ID and propagate changes. | F09 | Same-name employees remain distinguishable, all identity edits propagate. |
| P1 — concurrency | Add conditional transitions and serialize/compare generations for session replacement, timeout and refresh. | F12 | Barrier tests cannot log out a newly active/new session or return an already superseded refresh token without explicit conflict handling. |
| P2 — operation and scale | Bound heartbeat rates/connections; instrument errors, lag, pool pressure; validate 5–50 terminals. | F16, F11 | Measured event-delay budget, bounded stale interval, no sustained pool starvation or growth after reconnect cycles. |

Recommended target semantics: “signed in” means valid server session, “connected” means at least one valid fresh connection lease, “active” means recent explicit user activity, “idle” means connected without recent human activity, and “offline” means no fresh authenticated connection. Device details should not alter user identity or duplicate the online-user count.

For the next validation phase, use a separately authorized disposable PostgreSQL database and independent API/web/socket processes, synthetic accounts only, controlled clocks, and no production connection strings. The current audit authorized only source-level isolated checks; no production testing is implied by these recommendations.

## 13. Production Readiness Verdict

**Do not sign off this presence/logout implementation as production-ready for the described multi-PC LAN POS deployment.**

The source includes useful foundations: server-side session rows, hashed tokens, protected logout, per-request REST revocation checks, server-derived identity, heartbeat timers, disconnect handling, indexes, and eventual inactivity cleanup. Focused mock executions support those specific claims.

Release-blocking gaps remain in established-socket authorization, independent browser-terminal sessions, reliable user aggregation, reconciliation after interruption, and consistent secure transport. The real-name requirement is also unmet in the header. A successful logout click or an online dot is currently insufficient evidence of backend revocation or actual authenticated connectivity.

After remediation, completion requires the real-environment matrix above in an isolated deployment, including captured token-replay results, rejected noncooperative socket traffic, measured cross-device propagation/recovery times, and bounded offline behavior under restart/database/network failures. No production readiness or latency claim can be made from the current unexecuted integration scenarios.

## Appendix A — Source fingerprints for executed checks

Hashes are SHA-256 of UTF-8 source text as read by the isolated harness. They tie the mock execution to the reviewed working-tree source; they do not attest to deployed containers.

| Source path | SHA-256 |
|---|---|
| D:/Projects/mahali-light/server/middleware/auth.js | 8ddc1c0ad36d84471b11ae73a72c83a6415a37a40a07d08b0ff52d8c5772bb3f |
| D:/Projects/mahali-light/server/socket/index.js | dc68c294f254a2f076a61badd50712ae34be23e213dfa51c4a00f1786df3f53e |
| D:/Projects/mahali-light/web/store/presenceStore.ts | 2e2b961f10c1c962d43c4d39471c7737af7ca951ad3e3da22aa17d6f95d5a0a0 |
| D:/Projects/mahali-light/web/lib/config.ts | 17a91894a79b77ca24ea278d516627fdbda5d5619bcac657c274abf082f1fe11 |
| D:/Projects/mahali-light/web/services/authService.ts | c0ebb8b26c7a2d429b4a560d930950853459e0c41c645f889835baedb718c50e |
| D:/Projects/mahali-light/server/controllers/authController.js | b25ea4024e1b9f46901613742cca402d66c8a4c1b5880af1da52adfb7190074b |
| D:/Projects/mahali-light/web/store/socketStore.ts | 9d4e040bcd208368488a3b3135a859ac705a0ca4ad2d71978a59215cb8444177 |
| D:/Projects/mahali-light/server/middleware/permissions.js | 6f9d3c6bff855d374e52b3b9b117ad005ffacc04223d313a0521806adfaa3cb4 |

## Appendix B — Reproducible isolated harness

The following is the executed harness, included here so no second file needs to be created. It can be piped to node stdin from the project root. It reads only the named source files and already installed modules, uses a dependency allowlist for evaluated application code, substitutes all application SQL/socket/timer/storage boundaries, and writes results only to stdout. A zero process exit code means the harness completed; individual PASS/FAIL results are the audit results. It is intentionally not the application's integration runner.


```javascript
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ts = require('./web/node_modules/typescript');
const assert = require('assert/strict');
const results = [];
const files = new Map();
function load(file, deps, globals = {}) {
  let source = fs.readFileSync(file, 'utf8');
  files.set(file, crypto.createHash('sha256').update(source).digest('hex'));
  if (file.endsWith('.ts')) source = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => {
      if (!Object.hasOwn(deps, name)) throw Error('Blocked dependency: ' + name);
      return deps[name];
    },
    console, ...globals
  }, { filename: file, timeout: 5000 });
  return module.exports;
}
class AppError extends Error {
  constructor(code, message, options = {}) { super(message || code); this.code = code; this.status = options.status; }
}
const errors = { AppError, ERROR_CODES: new Proxy({}, { get: (_, key) => key }) };
const env = { JWT_SECRET: 'isolated-audit-only-synthetic-key-not-production', JWT_EXPIRES_IN: '8h' };
function authModule(query) {
  return load('server/middleware/auth.js', {
    crypto, jsonwebtoken: jwt, '../db/postgres': { query }, '../../shared/errorCodes': errors
  }, { process: { env } });
}
async function test(id, name, fn) {
  try { const detail = await fn(); results.push({ id, status: 'PASS', name, detail: detail || '' }); }
  catch (e) { results.push({ id, status: 'FAIL', name, detail: e.message }); }
}
const nullQuery = async () => ({ rows: [] });
const auth = authModule(nullQuery);
const validToken = auth.signToken({ sub: 'u1', username: 'cashier' });
const expiredToken = auth.signToken({ sub: 'u1', username: 'cashier' }, { expiresIn: -1 });
function socketHarness({ revoked = false, disabled = false } = {}) {
  const state = { revoked, disabled, status: 'online', calls: [], verifyCount: 0 };
  const timers = [], emissions = [];
  class Server {
    use(fn) { this.middleware = fn; }
    on(name, fn) { this[name] = fn; }
    emit(name, payload) { emissions.push({ name, payload, scope: 'all' }); }
  }
  const query = async (sql, params) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT s.id AS session_id')) {
      return { rows: state.revoked ? [] : [{ session_id: 's1', pc_identifier: 'pc1', username: 'cashier', role_name: 'Cashier', is_active: !state.disabled }] };
    }
    return { rows: [], rowCount: 1 };
  };
  const { attachSocket } = load('server/socket/index.js', {
    'socket.io': { Server },
    '../middleware/auth': {
      verifyToken: token => { state.verifyCount++; return auth.verifyToken(token); },
      hashToken: auth.hashToken
    },
    '../db/postgres': { query },
    '../services/attendanceService': { checkOutSafe: async () => {} },
    '../utils/corsOrigins': { isAllowedOrigin: () => true }
  }, { setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  const io = attachSocket({});
  async function connect(token = validToken) {
    const handlers = {}, rooms = [];
    const socket = {
      handshake: { auth: token ? { token } : {} }, data: {},
      join: room => rooms.push(room),
      emit: (name, payload) => emissions.push({ name, payload, scope: 'self' }),
      broadcast: { emit: (name, payload) => emissions.push({ name, payload, scope: 'all-except-self' }) },
      on: (name, fn) => { handlers[name] = fn; },
      disconnect: () => { socket.disconnected = true; }
    };
    let error;
    await io.middleware(socket, e => { error = e; });
    if (!error) io.connection(socket);
    return { socket, handlers, rooms, error };
  }
  return { state, io, timers, emissions, connect };
}
function storeCreate() {
  return initializer => {
    let state;
    const get = () => state;
    const set = change => { state = { ...state, ...(typeof change === 'function' ? change(state) : change) }; };
    state = initializer(set, get);
    return { getState: get, setState: set };
  };
}
function presenceStore() {
  return load('web/store/presenceStore.ts', { zustand: { create: storeCreate } }).usePresenceStore;
}
async function checkRest(token, { revoked = false, active = true } = {}) {
  const calls = [];
  const instance = authModule(async (sql, args) => {
    calls.push(sql);
    if (sql.includes('SELECT id, logout_at')) return { rows: [{ id: 's1', logout_at: revoked ? 'revoked' : null, status: 'offline' }] };
    if (sql.includes('SELECT u.id')) return { rows: [{ id: 'u1', username: 'cashier', is_active: active, role_id: 'r1' }] };
    return { rows: [] };
  });
  let error; const req = { headers: token ? { authorization: 'Bearer ' + token } : {} };
  await instance.requireAuth()(req, {}, e => { error = e; });
  return { error, req, calls };
}
(async () => {
  await test('T01', 'REST rejects missing credentials', async () => {
    assert.equal((await checkRest(null)).error?.code, 'AUTH_TOKEN_MISSING');
  });
  await test('T02', 'REST rejects expired token', async () => {
    assert.equal((await checkRest(expiredToken)).error?.code, 'AUTH_SESSION_EXPIRED');
  });
  await test('T03', 'REST rejects revoked session', async () => {
    assert.equal((await checkRest(validToken, { revoked: true })).error?.code, 'AUTH_SESSION_EXPIRED');
  });
  await test('T04', 'REST rejects disabled account', async () => {
    assert.equal((await checkRest(validToken, { active: false })).error?.code, 'AUTH_ACCOUNT_INACTIVE');
  });
  await test('T05', 'Valid REST token remains usable while socket status is offline', async () => {
    const r = await checkRest(validToken); assert.equal(r.error, undefined); assert.equal(r.req.sessionId, 's1');
  });
  await test('T06', 'Socket rejects missing credentials', async () => {
    assert.equal((await socketHarness().connect(null)).error?.message, 'AUTH_TOKEN_MISSING');
  });
  await test('T07', 'Socket rejects revoked credentials on new handshake', async () => {
    assert.equal((await socketHarness({ revoked: true }).connect()).error?.message, 'AUTH_SESSION_EXPIRED');
  });
  await test('T08', 'Socket rejects expired credentials on new handshake', async () => {
    assert.equal((await socketHarness().connect(expiredToken)).error?.message, 'AUTH_SESSION_EXPIRED');
  });
  await test('T09', 'Socket rejects disabled account with an open session', async () => {
    const r = await socketHarness({ disabled: true }).connect();
    assert.ok(r.error, 'Handshake accepted disabled user; SQL does not filter u.is_active');
  });
  await test('T10', 'Already connected socket rejects heartbeats after revocation', async () => {
    const h = socketHarness(); const s = await h.connect(); h.state.revoked = true; h.state.calls = [];
    await s.handlers.heartbeat();
    const unconditional = h.state.calls.find(c => c.sql.includes("status = 'online'") && !c.sql.includes('logout_at'));
    assert.ok(!unconditional, 'Revoked socket issued unconditional last_activity_at/status=online UPDATE; no session recheck');
  });
  await test('T11', 'Connected heartbeat revalidates JWT lifetime', async () => {
    const h = socketHarness(); const s = await h.connect(); const before = h.state.verifyCount;
    await s.handlers.heartbeat();
    assert.ok(h.state.verifyCount > before, 'verifyToken called only at handshake; heartbeat did not revalidate token');
  });
  await test('T12', 'Closing one of two sockets sharing a session preserves presence', async () => {
    const h = socketHarness(); const a = await h.connect(); await h.connect(); h.state.calls = []; h.emissions.length = 0;
    await a.handlers.disconnect();
    assert.ok(!h.state.calls.some(c => c.sql.includes("status = 'offline'")), 'One socket disconnect unconditionally marks shared session offline and broadcasts user_offline');
  });
  await test('T13', 'Reconnect marks DB session online before announcing online', async () => {
    const h = socketHarness(); await h.connect();
    assert.ok(h.state.calls.some(c => c.sql.startsWith('UPDATE') && c.sql.includes("status = 'online'")),
      'Connection broadcasts user_online without a DB online update; waits for later heartbeat');
  });
  await test('T14', 'Presence events restricted to authorized observers', async () => {
    const h = socketHarness(); await h.connect();
    assert.ok(!h.emissions.some(e => e.name === 'user_online' && e.scope === 'all-except-self'),
      'Cashier connection broadcasts presence to every other authenticated socket');
  });
  await test('T15', 'Same user across two PCs is one online-user entry', async () => {
    const s = presenceStore();
    s.getState().setOnlineUsers([{ userId: 'u1', pcIdentifier: 'pc1', username: 'cashier' }]);
    s.getState().upsertUser({ userId: 'u1', pcIdentifier: 'pc2', username: 'cashier' });
    assert.equal(s.getState().onlineUsers.length, 1, 'One user becomes two entries after event from second PC');
  });
  await test('T16', 'Session-specific idle does not idle a user active elsewhere', async () => {
    const s = presenceStore();
    s.getState().setOnlineUsers([{ userId: 'u1', pcIdentifier: 'pc1', status: 'online' }, { userId: 'u1', pcIdentifier: 'pc2', status: 'online' }]);
    s.getState().setIdle({ userId: 'u1' });
    assert.equal(s.getState().onlineUsers.find(u => u.pcIdentifier === 'pc2').status, 'online', 'Idle event changes all PCs for user');
  });
  await test('T17', 'Browser PC identifier distinguishes two physical terminals', async () => {
    function config() { return load('web/lib/config.ts', {}, { window: { location: { hostname: 'pos-server', protocol: 'http:', origin: 'http://pos-server' } }, process: { env: {} } }); }
    assert.notEqual(config().PC_IDENTIFIER, config().PC_IDENTIFIER, 'Both independent browser contexts resolve to pos-server-web');
  });
  await test('T18', 'Token issuance has per-session uniqueness in same second', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const a = auth.signToken({ sub: 'u1', username: 'cashier', iat });
    const b = auth.signToken({ sub: 'u1', username: 'cashier', iat });
    assert.notEqual(a, b, 'Same sub/username/iat produces identical JWT and token_hash; conflicts with unique DB index');
  });
  await test('T19', 'Failed server logout retains recoverable revocation state', async () => {
    const state = { token: validToken }; let cleared = false;
    const service = load('web/services/authService.ts', {
      './http': { apiGet: async () => {}, apiPost: async () => { throw Error('synthetic network failure'); } },
      '@/lib/config': { PC_IDENTIFIER: 'test-pc' },
      '@/store/authStore': { useAuthStore: { getState: () => ({ logoutLocal: () => { state.token = null; cleared = true; } }) } }
    });
    await service.logout().catch(() => {});
    assert.ok(!cleared, 'API failure clears local token; no persisted pending revocation/retry in service');
  });
  await test('T20', 'Successful logout controller revokes only current session and broadcasts', async () => {
    const calls = [], events = []; let response; let error;
    const controller = load('server/controllers/authController.js', {
      bcrypt: {}, zod: require('zod'),
      '../db/postgres': { query: async (sql, args) => { calls.push({sql,args}); return { rows: sql.startsWith('SELECT pc_identifier') ? [{ pc_identifier: 'pc1' }] : [] }; } },
      '../middleware/auth': auth,
      '../../shared/errorCodes': errors,
      '../utils/response': { ok: (_, body) => { response = body; } },
      '../utils/activityLog': { logActivity: async () => {} },
      '../services/attendanceService': { checkOutSafe: async () => {} }
    });
    await controller.logout({ user: { id: 'u1' }, sessionId: 's1', app: { get: () => ({ emit: (event, data) => events.push({event,data}) }) } }, {}, e => { error = e; });
    assert.equal(error, undefined); assert.ok(response.loggedOut);
    assert.ok(calls[0].sql.includes('logout_at = NOW()'));
    assert.equal(calls[0].args[0], 's1');
    assert.ok(events.some(e => e.event === 'user_offline'));
    return 'Controller SQL and event verified with mock database; no real SQL executed';
  });
  await test('T21', 'Presence store retains server ID and username over attempted heartbeat spoofing', async () => {
    const h = socketHarness(); const s = await h.connect(); h.state.calls = [];
    await s.handlers.heartbeat({ userId: 'victim', username: 'spoof', status: 'online' });
    assert.equal(h.state.calls[0].params[0], 's1');
    assert.equal(s.socket.data.username, 'cashier');
    return 'Heartbeat ignores client payload and uses authenticated sessionId';
  });

  function clientHarness() {
    const presence = presenceStore(); const handlers = {}; const intervals = []; let syncs = 0;
    const sock = { connected: true, on: (n,f) => {handlers[n]=f;}, emit: () => {}, removeAllListeners: () => {}, disconnect: () => {} };
    const noopStore = { getState: () => ({}) };
    const mod = load('web/store/socketStore.ts', {
      zustand: { create: storeCreate },
      'socket.io-client': { io: () => sock },
      '@/lib/config': { getSocketUrl: () => 'in-memory-only' },
      './authStore': { useAuthStore: { getState: () => ({ token: validToken, user: {id:'u1'}, logoutLocal: () => {} }) } },
      './presenceStore': { usePresenceStore: presence },
      './toastStore': { toast: { error: () => {}, info: () => {}, success: () => {}, warning: () => {} } },
      '@/services/stockCacheService': { handleStockUpdate: () => {}, syncOnReconnect: async () => {syncs++;} },
      './notificationStore': { useNotificationStore: noopStore },
      './backupStore': { useBackupStore: noopStore }
    }, { setInterval: (fn, ms) => { intervals.push({fn,ms}); return intervals.length; }, clearInterval: () => {} });
    mod.useSocketStore.getState().connect();
    return { presence, handlers, store: mod.useSocketStore, intervals, getSyncs: () => syncs };
  }
  await test('T22', 'Manager reconnect reconciles missed offline events', async () => {
    const h = clientHarness();
    h.presence.getState().setOnlineUsers([{userId:'gone',pcIdentifier:'pc-gone',username:'gone'}]);
    h.handlers.connect(); h.handlers.disconnect(); h.handlers.connect();
    assert.equal(h.getSyncs(),1);
    assert.equal(h.presence.getState().onlineUsers.length,0,
      'Reconnect resyncs stock only; departed user remains in presence store without a new snapshot');
  });
  await test('T23', 'Explicit client disconnect clears stale presence between logins', async () => {
    const h = clientHarness();
    h.presence.getState().setOnlineUsers([{userId:'gone',pcIdentifier:'pc-gone',username:'gone'}]);
    h.store.getState().disconnect();
    assert.equal(h.presence.getState().onlineUsers.length,0,'Disconnect clears socket/timer but leaves prior presence data');
  });
  await test('T24', 'New presence event preserves authoritative snapshot metadata', async () => {
    const s = presenceStore();
    s.getState().setOnlineUsers([{userId:'u1',pcIdentifier:'pc1',username:'cashier',lastActivityAt:'2026-10-23T00:00:00Z'}]);
    s.getState().upsertUser({userId:'u1',pcIdentifier:'pc1',username:'cashier'});
    assert.ok(s.getState().onlineUsers[0].lastActivityAt,'upsert replaces entire entry and drops lastActivityAt');
  });
  await test('T25', 'Permission gate rejects presence access for force-logout-only role', async () => {
    const permissions = load('server/middleware/permissions.js', {'../../shared/errorCodes':errors});
    let error;
    permissions.requirePermission('user.edit')({user:{permissions:['user.force_logout']}},{}, e=>{error=e;});
    assert.equal(error?.status,403);
    return 'Confirms REST policy; widget permits same role, so UI/API policy mismatch is a separate defect';
  });

  console.log(JSON.stringify({ runtime: process.version, isolation: 'VM-loaded source, explicit dependency allowlist, fake SQL/socket/timers/browser storage; no service import, DB/network connection, or file writes', results, sourceHashes: Object.fromEntries(files) }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
```

