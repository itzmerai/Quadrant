// @ts-check
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';

/**
 * Quadrant's marketing site.
 *
 * Static output: the site has no server-side behaviour and is hosted on GitHub
 * Pages. Astro rather than a client-rendered app so crawlers and link-preview
 * scrapers receive real HTML instead of an empty root element — a shared URL
 * that previews as a blank card is the one failure a marketing page cannot
 * afford.
 *
 * `base` comes from the environment because a GitHub project site is served
 * from a subpath (`/Quadrant/`) and every asset 404s without a matching base.
 * Moving to a custom domain later is then one variable, not a code change.
 */
const base = process.env.SITE_BASE ?? '/Quadrant/';
const site = process.env.SITE_ORIGIN ?? 'https://itzmerai.github.io';

export default defineConfig({
  output: 'static',
  site,
  base,
  build: {
    // One stylesheet beats a request per component on a page this small.
    inlineStylesheets: 'auto',
  },
  vite: {
    resolve: {
      alias: {
        // The app's token file is imported, never copied, so the palette shown
        // on the page cannot drift from the palette the app renders.
        '@app': fileURLToPath(new URL('../apps/ui/src', import.meta.url)),
      },
    },
  },
});
