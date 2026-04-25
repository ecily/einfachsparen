import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'https://whale-app-nmndr.ondigitalocean.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})