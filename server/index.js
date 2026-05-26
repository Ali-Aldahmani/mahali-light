require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const { runMigrations } = require('./db/migrate');
const { run: runSeed } = require('./db/seed');
const { attachSocket } = require('./socket');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const employeesRouter = require('./routes/employees');
const rolesRouter = require('./routes/roles');
const presenceRouter = require('./routes/presence');

const { notFoundHandler, errorHandler } = require('./middleware/errors');

async function bootstrap() {
  await runMigrations();
  await runSeed();

  const app = express();
  const server = http.createServer(app);
  const io = attachSocket(server);
  app.set('io', io);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', service: 'mahali-light', time: new Date().toISOString() } });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/presence', presenceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[server] mahali-light API listening on http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
