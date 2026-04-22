import path from 'node:path'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import liveReload from 'vite-plugin-live-reload'

function readGitValue(command: string, fallback: string) {
  try {
    return execSync(command, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback
  } catch {
    return fallback
  }
}

const gitVersion = readGitValue('git rev-parse --short HEAD', 'unknown')
const gitDatetime = readGitValue('git show -s --format=%cd --date=format:"%Y-%m-%d %H:%M:%S" HEAD', 'unknown')

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_GIT_VERSION': JSON.stringify(gitVersion),
    'import.meta.env.VITE_GIT_DATETIME': JSON.stringify(gitDatetime),
  },
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
