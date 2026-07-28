import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Root by default (dev, preview, e2e all serve from '/'). The GitHub Pages
  // deploy build sets DEPLOY_BASE=/battle-sim/ so project-Pages asset URLs
  // resolve under the repo subpath. Hash routing needs no other Pages config.
  base: process.env.DEPLOY_BASE || '/',
  plugins: [react()],
  esbuild: {
    // @pkmn/sim's State.serializeBattle/deserializeBattle resolve class
    // prototypes by constructor.name; minified name-mangling breaks
    // snapshot/restore in production builds (browser-only failure).
    keepNames: true,
  },
  optimizeDeps: {
    include: ['@pkmn/sim', '@smogon/calc'],
  },
  worker: {
    // The sim worker pulls in @pkmn/sim, which code-splits (learnsets chunk);
    // the default iife worker format can't code-split.
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // dev.html (data/engine inspector) and measure.html (search perf
        // harness) are developer tools, and a production build must not ship
        // them: measure.html takes `?battles=N&config=strong` straight from
        // the query string and will run a visitor's CPU flat out for ~20
        // minutes. public/robots.txt keeps them out of search results, but
        // that only asks crawlers nicely — it doesn't make the URLs 404.
        //
        // `npm run dev` serves them regardless (the dev server doesn't use
        // rollupOptions.input), so the local workflow is unchanged. Only a
        // built artifact needs the flag:
        //   BUILD_TOOLS=1 npm run build
        ...(process.env.BUILD_TOOLS
          ? {
              dev: resolve(__dirname, 'dev.html'),
              measure: resolve(__dirname, 'measure.html'),
            }
          : {}),
      },
    },
  },
});
