import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { prisma } from './db.js';
import { autoSetup } from './lib/setup.js';

const port = Number(process.env.PORT ?? 4000);
// cPanel and similar hosts have no command line: create or update the tables on start
if (process.env.AUTO_SETUP === '1') {
  await autoSetup(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations'));
}
const app = createApp();

const server = app.listen(port, () => {
  console.log(`YASH MOBILE POS API listening on http://localhost:${port}`);
});

// drop expired sessions hourly
setInterval(() => {
  prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}, 3600_000).unref();

const shutdown = () => server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
