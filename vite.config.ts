/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { withCsp } from './src/csp.ts';

const csp = (): Plugin => ({
  name: 'smart-mindmap-csp',
  apply: 'build',
  transformIndexHtml: { order: 'post', handler: withCsp },
});

export default defineConfig({
  plugins: [react(), csp()],
  // Bind ke semua interface agar bisa diakses lewat NetBird: http://<ip-netbird>:5173 (npm run dev), :4173 (npm run preview).
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
  },
});
