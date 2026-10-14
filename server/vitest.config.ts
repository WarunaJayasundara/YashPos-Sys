import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 180000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'mysql://root:@127.0.0.1:3306/yash_pos_test',
      LOGIN_RATE_LIMIT: '5',
      NODE_ENV: 'test',
    },
  },
});
