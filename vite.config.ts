import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/friday-memory/**',
          '**/jarvis-memory/**',
          '**/.agents/**',
          '**/.gemini/**',
          '**/dist/**',
          '**/core_engine/**',
          '**/workers_cpp/**',
          '**/gateway_rust/**',
          '**/memory_engine/**',
          '**/custom_tools/**',
          '**/hud/**',
          '**/data/**',
          '**/.venv/**',
        ],
      },
    },
  };
});
