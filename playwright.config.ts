import { defineConfig, devices } from '@playwright/test'

const e2eSessionSecret = process.env.SESSION_SECRET ?? 'networkmind-e2e-session-secret-change-me-123456'
const e2eBaseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100'
const e2ePort = new URL(e2eBaseURL).port || '3100'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  use: { baseURL: e2eBaseURL, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run start -- -H 127.0.0.1 -p ${e2ePort}`,
    env: { SESSION_SECRET: e2eSessionSecret },
    url: `${e2eBaseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
