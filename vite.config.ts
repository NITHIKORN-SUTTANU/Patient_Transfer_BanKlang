import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const demoMode = mode === 'demo' || env.VITE_DEMO_MODE === 'true'
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(demoMode ? 'true' : ''),
    },
    server: {
      proxy: {
        '/api': {
          target: process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
