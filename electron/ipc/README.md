# Electron IPC

Phase 1 only uses three IPC handlers, registered directly in `main.js`:

- `config:get` — read the local JSON config (server IP, PC identifier)
- `config:set` — patch and persist the local config
- `system:info` — return hostname, platform and PC identifier

Future phases (sync, offline cache, printer drivers, etc.) will add modules in
this folder following the pattern `ipcMain.handle('<channel>', handler)`.
