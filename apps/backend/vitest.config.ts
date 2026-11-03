import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // better-sqlite3 is synchronous; a single worker keeps temp DB files isolated.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
