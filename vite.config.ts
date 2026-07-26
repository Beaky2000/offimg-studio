import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built page works both from a GitHub Pages subpath
  // (/offimg-studio/) and when opened directly off disk via file://.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: {
    // Pinned rather than left to drift, so a firewall rule and a shared URL
    // stay valid between runs.
    port: 5199,
    strictPort: true,
    // `host` is deliberately NOT set here: the plain `npm run dev` stays bound
    // to localhost. Use `npm run dev:host` to serve on the local network, e.g.
    // to check pixel rendering on a machine with a different display scaling.
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
