# Phase 19 — QA checklist

Use this list before marking a release **1.0.0** ready. Run on **server PC** plus at least **two client PCs**.

## Auth
- [ ] Login with correct credentials
- [ ] Login with wrong credentials (error)
- [ ] Account locks after 5 failed attempts
- [ ] Session expires after idle time
- [ ] Force logout works cross-PC
- [ ] Permission denied shows correct modal
- [ ] Role-based UI hiding works

## POS & invoices
- [ ] Product search by name/SKU/barcode
- [ ] Barcode scanner auto-detects input
- [ ] Variant selection works
- [ ] Meter/kg quantity input (decimals)
- [ ] Per-item discount applies correctly
- [ ] Invoice discount applies correctly
- [ ] VAT 5% calculates correctly
- [ ] Split payment (cash+bank+credit)
- [ ] Change calculator for cash
- [ ] Guest sale (no customer)
- [ ] Customer credit payment
- [ ] Credit limit enforcement
- [ ] Stock deducts on confirmation
- [ ] Invoice PDF generates correctly
- [ ] Thermal receipt prints correctly
- [ ] Edit request flow works end to end
- [ ] Cancel invoice restores stock

## Inventory
- [ ] Stock levels update real-time
- [ ] All PCs see stock changes live
- [ ] Adjustment request → approval flow
- [ ] Stock count full flow
- [ ] Quarantine stock separate from main
- [ ] Reorder alert fires correctly
- [ ] Low stock badge shows in sidebar

## Multi-PC & setup
- [ ] First-time setup wizard cannot be skipped
- [ ] Server mode: local IP shown, clients can connect
- [ ] Client mode: test connection before finish
- [ ] Three PCs connect to server
- [ ] Offline POS cache sync on start
- [ ] Settings saved in app_settings (single row)

## Settings & polish
- [ ] Settings hub sections save correctly
- [ ] Global search (Ctrl+F) navigates to detail
- [ ] Keyboard shortcut overlay (?)
- [ ] Sidebar collapse persists per PC
- [ ] Version shown in settings footer
- [ ] Scheduled backup runs (server PC only)

## Backup
- [ ] Scheduled backup runs on time
- [ ] Restore flow completes successfully
- [ ] Retention cleanup removes old files
