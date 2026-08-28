import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const internalPackages = [
  '@arava/config',
  '@arava/database',
  '@arava/shared',
  '@arava/shared/channels',
  '@arava/ui',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: internalPackages })],
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs',
        },
      },
    },
    plugins: [externalizeDepsPlugin({ exclude: internalPackages })],
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          'document-renderer': resolve('src/renderer/document-renderer.html'),
          index: resolve('src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});
