import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    globalSetup: ['./test/support/global-setup.ts'],
    fileParallelism: false,
    include: ['**/*.e2e-spec.ts'],
  },
});
