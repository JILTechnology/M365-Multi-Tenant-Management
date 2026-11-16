import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Native module: loaded from node_modules at runtime (copied in by forge.config.ts).
      external: ['node-pty'],
    },
  },
});
