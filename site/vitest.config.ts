import { defineConfig } from 'vitest/config';

/**
 * The site has its own config because vitest otherwise walks up and finds the
 * repo root's, whose include globs cover the app and not this workspace.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
