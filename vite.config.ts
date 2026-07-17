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
        dev: resolve(__dirname, 'dev.html'),
        measure: resolve(__dirname, 'measure.html'),
      },
    },
  },
});
