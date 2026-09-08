# Electron exit matrix

Electron is **not required** for normal POS use (browser + LAN). The
`electron/` tree and `src/` (Vite SPA) are kept only for rollback/reference —
see `docs/web-migration/VITE_ARCHIVE_STATUS.md`. The native Next.js frontend
(`web/`) never imports from `electron/` and guards every `window.electron`
access with optional chaining so it degrades to pure-browser behavior.

## Capability classification

| Capability | Classification | Next.js / browser replacement |
| --- | --- | --- |
| App window / load UI | obsolete | `web/` served by Next.js, opened in any browser |
| `config:get/set` (generic key/value) | obsolete for web | not used by `web/` |
| Sidebar collapsed preference | browser compatible | `localStorage` (`web/components/layout/Sidebar.tsx`), was `window.electron.getConfig/setConfig` |
| `pcIdentifier` | browser compatible | `${hostname}-web` fallback in `web/lib/config.ts` (`PC_IDENTIFIER`) |
| `print:invoice/receipt` (silent thermal) | Hardware Agent required | Hardware Agent `POST /v1/print`, or browser "print to PDF" tab (same-origin `/api/invoices/:id/pdf`) |
| `print:get-printers` | Hardware Agent required | Hardware Agent `GET /v1/printers` |
| `print:download` save dialog | browser compatible | native browser download (blob `<a>` in-page, no Electron save dialog) |
| `backup:download` save dialog | browser compatible | fetch blob + browser download |
| `backup:usb-list` (till USB) | Hardware Agent / server-side only | USB detection only works on whichever machine runs the process; a Dockerized Linux API container cannot see a Windows till's USB bus. Use NAS/network destination, or run the Hardware Agent on that till. |
| `screenshot:capture` | obsolete | not exposed in the browser POS (no legitimate POS use case) |
| `notify:desktop` | browser compatible | in-app toast (`web/components/ui/Toast.tsx`) / Notification API |
| Fullscreen (F11) | browser compatible | native browser fullscreen; the Next.js keyboard-shortcut hook (`web/hooks/useKeyboardShortcuts.ts`) still calls `window.electron?.toggleFullscreen?.()` opportunistically but never requires it |
| TLS certificate-error pin | server-side / ops | plain HTTP on a trusted LAN, or install the server's TLS CA on client machines |
| `electron-updater` | obsolete for web | Docker image rebuild + `docker compose up -d` redeploys every client at once |
| Auto-update IPC | obsolete | not used by `web/` |

## Source files that reference `window.electron` (pre-migration `src/`)

All 13 are guarded with `?.` and none block a plain-browser session. Their
disposition in the native Next.js port (`web/`):

| File | Used for | Native disposition |
| --- | --- | --- |
| `src/components/layout/Sidebar.jsx` | read/write collapsed state | replaced with `localStorage` in `web/components/layout/Sidebar.tsx` |
| `src/components/layout/PCIdentifierBadge.jsx` | display PC identifier | ported as-is (optional chaining), falls back to hostname |
| `src/config.js` | `resolveOrigin()`, `PC_IDENTIFIER` | ported as-is in `web/lib/config.ts` — already dual-compatible, browser path never touches `window.electron` |
| `src/hooks/useKeyboardShortcuts.js` | F11 fullscreen | ported as-is in `web/hooks/useKeyboardShortcuts.ts`, optional call only |
| `src/pages/settings/SettingsHubPage.jsx` | Electron-only settings sections | ported with Electron sections conditionally rendered only when `window.electron` exists |
| `src/pages/setup/SetupWizardPage.jsx` | write network config after setup | ported as-is in `web/app/(auth)/setup/page.tsx`, optional call only |
| `src/services/authService.js` | attach PC identifier to login | ported as-is |
| `src/services/backupService.js` | trigger native save dialog | browser fetch+blob download used instead when `window.electron` is absent |
| `src/services/bugReportService.js` | attach app/OS metadata | ported as-is, degrades gracefully |
| `src/services/http.js` | `X-PC-Identifier` header | ported as-is in `web/services/http.ts` |
| `src/services/pdfService.js` | native print dialog | browser `window.open` PDF tab used instead |
| `src/services/printService.js` | route silent print through Electron IPC | routes through the Hardware Agent HTTP API instead (`web/services/hardwareAgentClient.ts`) |
| `src/store/notificationStore.js` | native desktop notification | Notification API / in-app toast instead |

Normal cashiers: any modern browser (Chrome/Edge) → `http://SERVER_IP`.
Silent thermal printing: install the Hardware Agent on that specific till PC.
