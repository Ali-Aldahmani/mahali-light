# Hardware Agent security

Process: `hardware-agent/server.js` (`npm start` in that folder).

## Binding

Listens on **127.0.0.1 only**. Non-loopback peers receive `403 HW_LOCALHOST_ONLY`.

## Allowlist

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/health` | none |
| GET | `/v1/printers` | `X-Hardware-Token` |
| POST | `/v1/print` | `X-Hardware-Token` |

Unknown paths: `404 HW_UNKNOWN_COMMAND`.

## Print body

- `kind`: `invoice` \| `receipt` only
- `invoiceId`: UUID v1–v5
- `apiToken`: Express JWT (used only to GET the PDF from Express; not stored)
- `printer`: optional name passed to `lp -d` (no shell concatenation)
- `copies`: 1–5

No arbitrary shell, filesystem browse, SQL, or raw printer command strings.

## Pairing

Token is created in `~/.bytecra-hardware-agent/pairing-token` (0600). Paste into the browser tab session (`sessionStorage`) via POS printer settings / `setHardwareAgentToken`. The token never leaves the till.

## Express

Agent fetches `${EXPRESS_URL}/api/invoices/:id/pdf|receipt`. It does not open PostgreSQL.

## Threat notes

A malicious page on the till could call localhost if it knows the token. Keep the token out of localStorage and only on trusted POS origin.
