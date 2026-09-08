# Vite/React-Router frontend — deleted

**Status: removed from the working tree.** `src/` (the Vite + React Router
SPA), `electron/` (the desktop shell that wrapped it), and their root-level
build config (`vite.config.js`, `index.html`, root `tailwind.config.js`/
`postcss.config.js`, `.eslintrc.cjs`) were deleted after the native Next.js
frontend (`web/`) was verified working end-to-end against a live Docker
deployment (build succeeded, containers healthy, login/setup/POS reachable).

This is a deliberate, explicit decision made by the project owner — not an
automatic side effect of the migration. See the git history before this
change for the full prior content if it's ever needed for reference.

## What changed as a result

- Root `package.json`: removed the Vite/Electron dev & build scripts (`dev`,
  `dev:frontend`, `dev:vite`, `dev:electron`, `build`, `build:electron`,
  `build:electron:dir`, `build:all`, `preview`, `lint`, `lint:fix`), the
  electron-builder `"build"` config block, and every dependency that was only
  ever used by the deleted frontend (`react`, `react-dom`,
  `react-router-dom`, `recharts`, `lucide-react`, `axios`, `clsx`, `zustand`,
  `vite`, `@vitejs/plugin-react`, `electron`, `electron-builder`,
  `electron-updater`, `concurrently`, `cross-env`, `wait-on`, `eslint` +
  React eslint plugins, `tailwindcss`/`postcss`/`autoprefixer`,
  `@types/react`/`@types/react-dom`). `drivelist` was kept — it's used
  server-side by `server/backup/destinations/usbDestination.js`,
  independent of Electron.
- `.gitignore` / `.dockerignore`: dropped the now-meaningless
  Electron/Vite-specific entries (`dist-electron/`, `.vite/`,
  `electron/config.local.json`, ignoring `electron`/`index.html`/
  `vite.config.js`/`.eslintrc*` from the Docker build context).
- `README.md`: removed references to the legacy `npm run dev` (Vite+Electron)
  workflow.

## What's still true

- `web/` was already fully self-contained before this deletion — its
  `tsconfig.json`, `next.config.mjs`, and `tailwind.config.js` never
  referenced `../src` in any path, alias, or content glob, and
  `web/Dockerfile` never copied `src/`. This deletion changes nothing about
  how the app builds or runs; it only removes files that were no longer
  read by anything.
- `docs/web-migration/ELECTRON_EXIT_MATRIX.md` remains as the historical
  record of what every Electron IPC call did and what replaced it in the
  browser — useful context even though the source files it describes are
  gone.
- The Hardware Agent (`hardware-agent/`) is unaffected — it was always a
  separate, standalone Node process, never part of the Electron shell.

## If the desktop shell is ever wanted again

It's recoverable from git history (the commit before this deletion). Rebuilding
it from scratch instead of restoring old code would also be reasonable at
that point, since `web/` (a real browser app) is a better foundation for a
desktop wrapper (e.g. via Tauri or a thin Electron shell that just loads the
Next.js URL) than reviving the old React-Router SPA would be.
