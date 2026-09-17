import { defineConfig, devices } from '@playwright/test';

// 로그인 스펙의 test.skip은 dev 서버가 아니라 이 러너 프로세스의 env를 본다. 여기서 켜야
// 스펙이 돌고, 아래 webServer.env가 같은 값을 서버에 넘겨 둘이 어긋나지 않는다.
process.env.AUTH_TEST_LOGIN = process.env.AUTH_TEST_LOGIN ?? '1';

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
      // 로그인 스펙은 이 값이 없으면 스스로 skip한다. 한때 여기 빠져 있어서 "7 passed,
      // 1 skipped"가 정상처럼 보였고 로그인 흐름은 어디서도 검증되지 않았다.
      // 테스트 Credentials provider는 DB 없이(JWT 세션) 동작하고, src/auth.ts가
      // production에서는 이 스위치를 거부한다.
      AUTH_TEST_LOGIN: process.env.AUTH_TEST_LOGIN,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
