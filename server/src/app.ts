import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { errorHandler, notFound } from './lib/http.js';
import { csrfGuard, requireAuth, sessionMiddleware } from './lib/auth.js';
import { authRouter } from './routes/auth.js';
import { productsRouter } from './routes/products.js';
import { brandsRouter, categoriesRouter, suppliersRouter } from './routes/catalog.js';
import { purchasesRouter } from './routes/purchases.js';
import { stockRouter } from './routes/stock.js';
import { returnsRouter, salesRouter } from './routes/sales.js';
import { auditRouter, customersRouter, rolesRouter, usersRouter, warrantiesRouter } from './routes/people.js';
import { cashRouter, expensesRouter, settingsRouter } from './routes/money.js';
import { reportsRouter } from './routes/reports.js';
import { dashboardRouter } from './routes/dashboard.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'self'"],
          // only when served over HTTPS; on a plain-HTTP shop LAN it would break every asset request
          upgradeInsecureRequests: process.env.COOKIE_SECURE === '1' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const openapiPath = path.resolve(here, '../openapi.yaml');
  if (fs.existsSync(openapiPath)) {
    const spec = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));
    app.get('/api/openapi.json', (_req, res) => res.json(spec));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'YASH MOBILE POS API' }));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/uploads', express.static(path.resolve('uploads'), { maxAge: '7d', fallthrough: false }));

  const api = express.Router();
  api.use(sessionMiddleware, csrfGuard);
  api.use('/auth', authRouter);
  api.use(requireAuth);
  api.use('/products', productsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/brands', brandsRouter);
  api.use('/suppliers', suppliersRouter);
  api.use('/purchases', purchasesRouter);
  api.use('/stock', stockRouter);
  api.use('/sales', salesRouter);
  api.use('/returns', returnsRouter);
  api.use('/customers', customersRouter);
  api.use('/warranties', warrantiesRouter);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/expenses', expensesRouter);
  api.use('/cash', cashRouter);
  api.use('/settings', settingsRouter);
  api.use('/reports', reportsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use((_req, _res, next) => next(notFound('Unknown API route')));
  app.use('/api', api);

  // production: serve the built PWA from the same origin (keeps cookies first-party and SameSite=Strict)
  const clientDist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
