import { execSync } from 'node:child_process';

// Fresh schema + roles/permissions/owner in the test database before the suite.
export default function setup() {
  const env = {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'mysql://root:@127.0.0.1:3306/yash_pos_test',
    SEED_DEMO: '0',
    SEED_ADMIN_PASSWORD: 'Owner@12345',
  };
  if (!/test/i.test(env.DATABASE_URL)) throw new Error('Refusing to reset a database whose name does not contain "test"');
  execSync('npx prisma migrate reset --force --skip-seed', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });
}
