import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Inline the built CSS and JS into index.html so the output is a single
 * self-contained file.
 *
 * This is not a size optimisation, it is what makes the build work when opened
 * directly off disk. Chrome applies CORS to external `<script type="module">`,
 * and a file:// page has a null origin, so an external module bundle is blocked
 * and silently never executes: the page renders but no event handler is ever
 * attached. An *inline* module needs no fetch, so it runs. Relative asset paths
 * are necessary for file:// but not sufficient.
 *
 * The single file also serves GitHub Pages perfectly well, so one artifact
 * covers both: the hosted app, and a page a sceptical user can download, read
 * end to end, and run offline.
 *
 * Hand-rolled rather than pulling in vite-plugin-singlefile: at ~30 lines it is
 * less to audit than an extra dependency, which matters for a project whose
 * pitch is "read the source".
 */
function inlineEverything(): Plugin {
  const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    name: 'offimg-inline-everything',
    // Must run after Vite has emitted the hashed asset files and rewritten the
    // HTML to point at them.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (file) => file.type === 'asset' && file.fileName.endsWith('.html'),
      );
      if (!html || html.type !== 'asset') return;

      let source = String(html.source);

      for (const [key, file] of Object.entries(bundle)) {
        const name = escapeForRegExp(file.fileName);

        if (file.type === 'chunk' && file.fileName.endsWith('.js')) {
          // A literal </script anywhere in the code would end the inline script
          // early. It can only legitimately occur inside a string, where the
          // escaped form parses identically.
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(
            new RegExp(`<script[^>]*\\bsrc="[^"]*${name}"[^>]*>\\s*</script>`),
            () => `<script type="module">\n${code}\n</script>`,
          );
          delete bundle[key];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          source = source.replace(
            new RegExp(`<link[^>]*\\bhref="[^"]*${name}"[^>]*>`),
            () => `<style>\n${String(file.source)}\n</style>`,
          );
          delete bundle[key];
        }
      }

      // Fail the build rather than shipping a page that renders but does
      // nothing, which is exactly the failure this plugin exists to prevent.
      const leftover = source.match(/<(?:script[^>]*\bsrc|link[^>]*\bhref)="\.?\/?assets\/[^"]*"/g);
      if (leftover) {
        this.error(
          `Failed to inline ${leftover.length} subresource(s); the file:// build would not run: ${leftover.join(', ')}`,
        );
      }

      html.source = source;
    },
  };
}

export default defineConfig({
  // Relative base so the built page works from a GitHub Pages subpath
  // (/offimg-studio/) as well as from file://.
  base: './',
  plugins: [inlineEverything()],
  build: {
    target: 'es2022',
    // Inline any future binary asset as a data URI too, so the single-file
    // output stays genuinely self-contained.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // The inlined CSS is injected as a <style> tag by the plugin above; without
    // this Vite would also emit a separate stylesheet link.
    cssCodeSplit: false,
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
