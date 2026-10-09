import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Single source of truth for env: <repo>/env/.env.<mode> (development | staging | production).
// Real process env vars (e.g. Docker build args) win over file values.
const envDir = '../../env'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_')
  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      restoreMocks: true,
      testTimeout: 20000,
      include: ['src/**/*.test.{ts,tsx}'],
      // Tests mock the network at /api; pin build-time config so a shell/env file cannot leak in.
      env: { VITE_API_BASE_URL: '/api', VITE_APP_NAME: 'Workshop Registration' },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      },
    },
  }
})
