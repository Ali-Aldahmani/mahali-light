require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const { runMigrations } = require('./db/migrate');
const { run: runSeed } = require('./db/seed');
const { run: runSeedProducts } = require('./db/seedProducts');
const { run: runSeedSettings } = require('./db/seedSettings');
const { attachSocket } = require('./socket');
const { getUploadsRoot } = require('./utils/paths');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const employeesRouter = require('./routes/employees');
const rolesRouter = require('./routes/roles');
const presenceRouter = require('./routes/presence');
const categoriesRouter = require('./routes/categories');
const attributesRouter = require('./routes/attributes');
const productsRouter = require('./routes/products');
const variantsRouter = require('./routes/variants');
const stockRouter = require('./routes/stock');
const settingsRouter = require('./routes/settings');
const suppliersRouter = require('./routes/suppliers');
const purchaseOrdersRouter = require('./routes/purchaseOrders');
const supplierPaymentsRouter = require('./routes/supplierPayments');
const supplierReturnsRouter = require('./routes/supplierReturns');
const customersRouter = require('./routes/customers');
const customerPaymentsRouter = require('./routes/customerPayments');
const invoicesRouter = require('./routes/invoices');
const invoiceEditRequestsRouter = require('./routes/invoiceEditRequests');
const printRouter = require('./routes/print');
const warrantiesRouter = require('./routes/warranties');
const warrantyClaimsRouter = require('./routes/warrantyClaims');
const returnRequestsRouter = require('./routes/returnRequests');
const returnOrdersRouter = require('./routes/returnOrders');
const cashDrawerRouter = require('./routes/cashDrawer');
const bankAccountsRouter = require('./routes/bankAccounts');
const treasuryRouter = require('./routes/treasury');
const attendanceRouter = require('./routes/attendance');
const leavesRouter = require('./routes/leaves');
const leaveBalancesRouter = require('./routes/leaveBalances');
const holidaysRouter = require('./routes/holidays');
const reportsRouter = require('./routes/reports');
const billsRouter = require('./routes/bills');
const billPaymentsRouter = require('./routes/billPayments');
const expensesRouter = require('./routes/expenses');
const expenseCategoriesRouter = require('./routes/expenseCategories');
const financeRouter = require('./routes/finance');
const analyticsRouter = require('./routes/analytics');
const forecastRouter = require('./routes/forecast');
const notificationsRouter = require('./routes/notifications');
const backupRouter = require('./routes/backup');
const errorLogsRouter = require('./routes/errorLogs');
const bugReportsRouter = require('./routes/bugReports');
const appSettingsRouter = require('./routes/appSettings');
const setupRouter = require('./routes/setup');
const searchRouter = require('./routes/search');
const { isServerMode } = require('./utils/serverMode');

const {
  notFoundHandler,
  errorHandler,
  registerProcessHandlers,
} = require('./middleware/errors');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { startOverduePoJob } = require('./jobs/overduePurchaseOrders');
const { startStaleDraftInvoiceJob } = require('./jobs/staleDraftInvoices');
const { startPdfCleanupJob } = require('./jobs/pdfCleanup');
const { startWarrantyExpiryJob } = require('./jobs/warrantyExpiry');
const { startAttendanceSweepJob } = require('./jobs/attendanceSweep');
const { startBillStatusSweepJob } = require('./jobs/billStatusSweep');
const { startScheduledReportJob } = require('./services/scheduledReportService');
const { startForecastJob } = require('./services/forecastService');
const notificationService = require('./services/notificationService');
const { startNotificationCronJobs } = require('./jobs/notificationCron');
const { startBackupScheduler } = require('./backup/scheduler');
const maintenanceMode = require('./backup/maintenanceMode');

async function bootstrap() {
  registerProcessHandlers();
  await runMigrations();
  await runSeed();
  await runSeedProducts();
  await runSeedSettings();

  const app = express();
  const server = http.createServer(app);
  const io = attachSocket(server);
  app.set('io', io);

  // Security headers via helmet.
  //
  // CSP: this server sends only JSON responses and static binary files (images,
  // PDFs). It never sends an HTML page to a browser directly, so most CSP
  // directives are belt-and-suspenders — they protect any future HTML surface
  // and signal correct intent to scanners. Key choices:
  //   • scriptSrc 'none'   — server never serves JS to a browser.
  //   • styleSrc  'none'   — server never serves CSS to a browser.
  //   • imgSrc    'self' data: — static image files + data-URI thumbnails.
  //   • objectSrc 'none'   — PDFs are downloaded, not embedded via <object>.
  //   • frameAncestors 'none' — this API should never be iframed.
  //
  // CORP: 'cross-origin' is required because the Electron renderer loads from
  // file:// (or a different LAN IP) and must fetch images and PDFs from this
  // server. Restricting to same-origin would break image display in the app.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:      ["'self'"],
          scriptSrc:       ["'none'"],
          styleSrc:        ["'none'"],
          imgSrc:          ["'self'", 'data:'],
          connectSrc:      ["'self'"],
          fontSrc:         ["'none'"],
          objectSrc:       ["'none'"],
          mediaSrc:        ["'none'"],
          frameSrc:        ["'none'"],
          frameAncestors:  ["'none'"],
          formAction:      ["'self'"],
          baseUri:         ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // Explicit origin allow-list — replaces the previous `origin: true` wildcard
  // that reflected any Origin header back with credentials allowed.
  //
  // Three cases are always allowed without configuration:
  //   • No Origin header  — same-origin browser requests, curl, health checks.
  //   • Origin: "null"    — Electron renderer in production: the app loads from
  //                         file://, which Chromium encodes as the string "null".
  //                         Blocking this would break the desktop app entirely.
  //   • CORS_ORIGINS list — comma-separated explicit origins from the environment
  //                         (e.g. http://localhost:5173 for the Vite dev server).
  //
  // Everything else receives a 403 so that arbitrary websites on the same LAN
  // cannot make credentialed requests to the API from a browser tab.
  const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origin === 'null' || allowedOrigins.has(origin)) {
          return cb(null, true);
        }
        cb(Object.assign(new Error(`Origin "${origin}" not allowed by CORS`), { status: 403 }));
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Rate limiting — applied before any route handler so the window counters
  // are accurate regardless of which middleware runs next.
  //
  // Login gets its own strict limit (20 req/15 min per IP) that sits on top
  // of the per-username account lockout in authController.js, blocking
  // credential-stuffing attacks that cycle across different usernames.
  //
  // The global limiter (500 req/min per IP) protects every other endpoint.
  // At a 5-PC store a busy cashier generates ~25 req/min, so this leaves
  // ample headroom while still stopping runaway clients or scanning loops.
  app.use('/api/auth/login', authLimiter);
  app.use('/api', apiLimiter);

  // Phase 17 — short-circuit writes during a restore so the database isn't
  // mutated mid-restore. Mounted before any route so 503 is the universal
  // response (the middleware itself allows a small read-only allow-list).
  app.use(maintenanceMode.middleware());

  // Serve uploaded images.
  app.use(
    '/files',
    express.static(getUploadsRoot(), {
      maxAge: '7d',
      etag: true,
      index: false,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', service: 'mahali-light', time: new Date().toISOString() } });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/presence', presenceRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/attributes', attributesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/variants', variantsRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchase-orders', purchaseOrdersRouter);
  app.use('/api/supplier-payments', supplierPaymentsRouter);
  app.use('/api/supplier-returns', supplierReturnsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/customer-payments', customerPaymentsRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/invoice-edit-requests', invoiceEditRequestsRouter);
  app.use('/api/print', printRouter);
  app.use('/api/warranties', warrantiesRouter);
  app.use('/api/warranty-claims', warrantyClaimsRouter);
  app.use('/api/return-requests', returnRequestsRouter);
  app.use('/api/return-orders', returnOrdersRouter);
  // Spec also exposes the lookup helper under /api/returns/lookup — alias so
  // both paths resolve.
  app.use('/api/returns', returnRequestsRouter);
  app.use('/api/cash-drawer', cashDrawerRouter);
  app.use('/api/bank-accounts', bankAccountsRouter);
  app.use('/api/treasury', treasuryRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/leaves', leavesRouter);
  app.use('/api/leave-balances', leaveBalancesRouter);
  app.use('/api/holidays', holidaysRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/bills', billsRouter);
  app.use('/api/bill-payments', billPaymentsRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/expense-categories', expenseCategoriesRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/forecast', forecastRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/backup', backupRouter);
  app.use('/api/error-logs', errorLogsRouter);
  app.use('/api/bug-reports', bugReportsRouter);
  app.use('/api/app-settings', appSettingsRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/search', searchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  // Background jobs — SERVER mode only (client PCs skip schedulers).
  if (isServerMode()) {
    startOverduePoJob(io);
    startStaleDraftInvoiceJob();
    startPdfCleanupJob();
    startWarrantyExpiryJob(io);
    startAttendanceSweepJob(io);
    startBillStatusSweepJob(io);
    startScheduledReportJob(io);
    startForecastJob();
    notificationService.setIoInstance(io);
    startNotificationCronJobs(io);
    startBackupScheduler(io);
  } else {
    console.log('[server] client mode — background schedulers disabled');
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[server] mahali-light API listening on http://0.0.0.0:${port}`);
  });
}

function printDbHelp(err) {
  const codes = [err?.code];
  if (AggregateError && err instanceof AggregateError && Array.isArray(err.errors)) {
    codes.push(...err.errors.map((e) => e?.code));
  }
  if (!codes.includes('ECONNREFUSED')) return;
  const h = process.env.PGHOST || 'localhost';
  const p = process.env.PGPORT || '5432';
  const db = process.env.PGDATABASE || 'mahali_light';
  console.error('');
  console.error(
    '[server] Cannot connect to PostgreSQL (connection refused). The API needs a running database before setup works.',
  );
  console.error(`[server] Expected: host=${h} port=${p} database=${db}`);
  console.error('[server] Fix: install/start PostgreSQL 15+, create the database, then set PG* in .env (see .env.example).');
  console.error('[server] Then run: npm run migrate');
  console.error('[server] Windows: ensure the "postgresql-x64-*" service is running (services.msc).');
  console.error('');
}

bootstrap().catch((err) => {
  console.error('[server] failed to start', err);
  printDbHelp(err);
  process.exit(1);
});
