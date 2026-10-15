import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { applyMigrations, ensureAccessControl, ensureOwner, splitSql } from '../src/lib/setup.js';

const dir = path.resolve('prisma/migrations');

describe('first-run setup (cPanel AUTO_SETUP)', () => {
  it('splits migration files into single statements, dropping comments', () => {
    expect(splitSql('-- a\nCREATE TABLE `x` (\n `a` INT\n);\n\n-- b\nALTER TABLE `x` ADD `b` INT;\n')).toEqual(['CREATE TABLE `x` (\n `a` INT\n)', 'ALTER TABLE `x` ADD `b` INT']);
    const init = fs.readdirSync(dir).find((n) => n.endsWith('_init'))!;
    const steps = splitSql(fs.readFileSync(path.join(dir, init, 'migration.sql'), 'utf8'));
    expect(steps.length).toBeGreaterThan(30);
    expect(steps.every((s) => /^(CREATE|ALTER)\s/i.test(s))).toBe(true);
  });

  it('treats migrations applied by prisma migrate as done', async () => {
    expect(await applyMigrations(dir)).toEqual([]);
  });

  it('is safe to run on every start: no duplicate roles, owner password never replaced', async () => {
    const roles = await prisma.role.count();
    const perms = await prisma.rolePermission.count();
    await ensureAccessControl();
    await ensureAccessControl();
    expect(await prisma.role.count()).toBe(roles);
    expect(await prisma.rolePermission.count()).toBe(perms);
    const before = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
    expect(await ensureOwner('Another-Pass1!')).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } })).passwordHash).toBe(before.passwordHash);
  });
});
