import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
        measure: resolve(__dirname, 'measure.html'),
      },
    },
  },
});
