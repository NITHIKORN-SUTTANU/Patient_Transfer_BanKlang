import { defineConfig } from '@playwright/test'

const deployedURL = process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './tests',
  // Domain tests use Node's test runner via npm run test:domain.
  testIgnore: '**/*.test.mjs',
  use: { baseURL: deployedURL || 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: deployedURL ? undefined : { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
})
