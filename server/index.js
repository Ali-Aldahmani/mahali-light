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

const { notFoundHandler, errorHandler } = require('./middleware/errors');
const { startOverduePoJob } = require('./jobs/overduePurchaseOrders');

async function bootstrap() {
  await runMigrations();
  await runSeed();
  await runSeedProducts();
  await runSeedSettings();

  const app = express();
  const server = http.createServer(app);
  const io = attachSocket(server);
  app.set('io', io);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  // Background jobs.
  startOverduePoJob(io);

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[server] mahali-light API listening on http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
