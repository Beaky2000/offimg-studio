import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built page works both from a GitHub Pages subpath
  // (/offimg-studio/) and when opened directly off disk via file://.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
