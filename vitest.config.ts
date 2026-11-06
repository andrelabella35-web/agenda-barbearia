import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://agenda:agenda@localhost:5432/agenda_test',
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
