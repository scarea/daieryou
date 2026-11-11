import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const serverPort = Number(process.env.SERVER_PORT || 8787)

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT || 5173),
    host: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
