import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/uploads': { target: backend, changeOrigin: false },
      '/sitemap.xml': { target: backend, changeOrigin: false },
      '/robots.txt': { target: backend, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
