import 'dotenv/config';
import { createApp } from './app.js';
import { prisma } from './db.js';

const port = Number(process.env.PORT ?? 4000);
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
