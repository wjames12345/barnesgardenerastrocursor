// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://wjames12345.github.io',
  base: '/barnesgardenerastrocursor',
  integrations: [sitemap()],
  server: { host: true, port: 4321 },
});
