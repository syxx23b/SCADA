import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        ws: true,
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
  },
})
