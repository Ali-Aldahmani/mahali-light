# Authentication compatibility (slice 01)

Express remains the only issuer of JWTs (`signToken` in `server/middleware/auth.js`).

## Token

| Item | Express | FastAPI |
| --- | --- | --- |
| Algorithm | HS256 (`jwt.sign` default) | `JWT_ALGORITHM` default HS256 |
| Secret | `process.env.JWT_SECRET` | `JWT_SECRET` via pydantic-settings |
| Subject | `payload.sub` | `payload.sub` |
| Expiry | `JWT_EXPIRES_IN` default `8h` | verified, not issued |
| Missing Bearer | 401 `AUTH_TOKEN_MISSING` | same |
| Bad signature | 401 `AUTH_TOKEN_INVALID` | same |
| Expired JWT | 401 `AUTH_SESSION_EXPIRED` | same |

FastAPI never calls `jwt.encode` for login.

## Token hash

```text
SHA-256(utf8(rawBearerToken)) → hex
```

Node: `crypto.createHash('sha256').update(t).digest('hex')`  
Python: `hashlib.sha256(token.encode('utf-8')).hexdigest()`

## Session lookup

```sql
SELECT id, logout_at, status FROM user_sessions
 WHERE token_hash = $1
 ORDER BY login_at DESC
 LIMIT 1
```

Invalid if no row **or** `logout_at` is set → 401 `AUTH_SESSION_EXPIRED`.

`status` is selected but **not** used for HTTP auth (Express same). Socket offline without `logout_at` still authenticates HTTP.

## Force logout

Express `POST /api/users/:id/force-logout` sets `logout_at` (and `logout_type`). FastAPI then fails session lookup. No parallel session store.

## User load

Copied `loadUserContext`: `users` + `roles`, then `role_permissions`, then `user_permissions` grant/deny.

Inactive user → 403 `AUTH_ACCOUNT_INACTIVE`.

Best-effort `UPDATE user_sessions SET last_activity_at = NOW()` after auth (Express `.catch(() => {})`).

## Rank / hierarchy

Not applied on these GET routes. Express `requirePermission` is a simple AND of keys. FastAPI matches that. Rank rules stay on Express user/role write APIs.
