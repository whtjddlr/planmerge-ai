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
    command: 'node node_modules/next/dist/bin/next dev',
    url: 'http://localhost:3000',
    // E2E는 DB 없는 게스트 경로를 검증하도록 설계됐다. 로컬 .env에 실제 DATABASE_URL이
    // 있어도 여기서 비워, 테스트가 운영 DB에 공유 워크스페이스를 만들지 않게 고정한다.
    // (Next.js는 process.env에 이미 있는 키를 .env로 덮어쓰지 않는다.)
    //
    // 분석 키도 같은 이유로 비운다. 두 가지를 동시에 막는다:
    // (1) .env.local에 키가 있으면 "키 없음" 경로가 아예 재현되지 않는다.
    // (2) 테스트가 실수로 유료 모델 호출을 낼 수 있다.
    // 결과가 필요한 스펙은 support/workspace.ts가 응답을 가로채 픽스처로 돌려준다.
    env: {
      DATABASE_URL: '',
      DIRECT_URL: '',
      OPENAI_API_KEY: '',
      GMS_API_KEY: '',
      ANALYSIS_PROVIDER: 'openai',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
