import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // E2E는 DB 없는 게스트 경로를 검증하도록 설계됐다. 로컬 .env에 실제 DATABASE_URL이
    // 있어도 여기서 비워, 테스트가 운영 DB에 공유 워크스페이스를 만들지 않게 고정한다.
    // (Next.js는 process.env에 이미 있는 키를 .env로 덮어쓰지 않는다.)
    env: { DATABASE_URL: '', DIRECT_URL: '' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
