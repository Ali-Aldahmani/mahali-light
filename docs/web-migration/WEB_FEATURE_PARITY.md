# Web feature parity — superseded

This document described feature parity for the **old** architecture, where
`web/` mounted the Vite/React-Router SPA inside a Next.js catch-all route
(`web/app/[[...slug]]` + `web/components/ClientApp.tsx`). That architecture
has been replaced: `web/` is now a native Next.js App Router application with
its own routes, components, stores, services, and types — no React Router,
no wrapped SPA.

See **`docs/web-migration/NEXTJS_NATIVE_PARITY.md`** for the current,
route-by-route parity record, and **`docs/web-migration/VITE_ARCHIVE_STATUS.md`**
for the status of the old `src/` tree.
