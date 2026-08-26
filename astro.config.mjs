// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// Set this to the live domain before the first deploy — it is what
// sitemap.xml, robots.txt and every canonical/OG URL are built from.
const SITE = process.env.SITE_URL || 'https://peak-vending.com';

export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
