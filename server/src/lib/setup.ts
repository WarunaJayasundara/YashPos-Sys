// First-run setup for hosts without a command line (cPanel): tables, roles, settings and the owner account.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { hashPassword } from './auth.js';
import { DEFAULT_ROLES, PERMISSIONS } from './permissions.js';

/** Splits a Prisma migration file into single statements (MySQL runs one per call). */
export function splitSql(sql: string) {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Applies pending migrations, recording them in Prisma's own table so `prisma migrate deploy` stays compatible. */
export async function applyMigrations(dir: string) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`_prisma_migrations\` (
    \`id\` VARCHAR(36) NOT NULL, \`checksum\` VARCHAR(64) NOT NULL, \`finished_at\` DATETIME(3) NULL,
    \`migration_name\` VARCHAR(255) NOT NULL, \`logs\` TEXT NULL, \`rolled_back_at\` DATETIME(3) NULL,
    \`started_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`applied_steps_count\` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
    'SELECT migration_name, finished_at FROM `_prisma_migrations` WHERE rolled_back_at IS NULL');
  const broken = rows.find((r) => !r.finished_at);
  if (broken) throw new Error(`Migration ${broken.migration_name} failed earlier. Restore the database backup before starting again.`);
  const done = new Set(rows.map((r) => r.migration_name));
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort();
  const applied: string[] = [];
  for (const name of names) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
    const id = crypto.randomUUID();
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    await prisma.$executeRawUnsafe('INSERT INTO `_prisma_migrations` (id, checksum, migration_name) VALUES (?, ?, ?)', id, checksum, name);
    const steps = splitSql(sql);
    for (const stmt of steps) await prisma.$executeRawUnsafe(stmt);
    await prisma.$executeRawUnsafe('UPDATE `_prisma_migrations` SET finished_at = CURRENT_TIMESTAMP(3), applied_steps_count = ? WHERE id = ?', steps.length, id);
    applied.push(name);
  }
  return applied;
}

/** Creates permissions and system roles. Admin always holds every permission; other roles get defaults only once. */
export async function ensureAccessControl() {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, name: r.name, maxDiscountPercent: r.maxDiscountPercent.toFixed(2), isSystem: true },
    });
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (r.code === 'admin' || existing === 0) {
      await prisma.rolePermission.createMany({
        data: r.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })),
        skipDuplicates: true,
      });
    }
  }
  await prisma.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

/** Creates the owner account once. Never changes an existing password. */
export async function ensureOwner(password: string) {
  if (await prisma.user.findUnique({ where: { username: 'owner' } })) return false;
  const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await prisma.user.create({ data: { username: 'owner', fullName: 'Shop Owner', roleId: admin.id, passwordHash: await hashPassword(password) } });
  return true;
}

/** Runs on start when AUTO_SETUP=1: migrations, roles, settings, and the owner if none exists yet. */
export async function autoSetup(migrationsDir: string) {
  const applied = await applyMigrations(migrationsDir);
  if (applied.length) console.log(`Database updated: ${applied.join(', ')}`);
  await ensureAccessControl();
  if (!(await prisma.user.count())) {
    const pw = process.env.SEED_ADMIN_PASSWORD;
    if (!pw) console.warn('No users yet: set SEED_ADMIN_PASSWORD and restart to create the owner account.');
    else if (await ensureOwner(pw)) console.log('Owner account created (username: owner).');
  }
}
