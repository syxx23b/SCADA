import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import liveReload from 'vite-plugin-live-reload'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    liveReload(['../Scada.Api/wwwroot/**/*.{html,js,css}']),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      // OneDrive/workspace sync can miss fs events; polling is more reliable for HMR.
      usePolling: true,
      interval: 200,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        ws: true,
      },
      '/webroot': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
      '/fr': {
        target: 'http://127.0.0.1:8075',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/fr/, ''),
      },
      '/hubs': {
        target: 'http://localhost:5000',
        ws: true,
      },
      '/vnc': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../Scada.Api/wwwroot'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
