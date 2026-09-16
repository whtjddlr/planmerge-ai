/**
 * 키가 없을 때의 정직한 실패 경로.
 *
 * 폴백을 제거한 뒤 이 경로의 계약이 바뀌었다. 예전에는 키가 없어도 규칙 기반
 * 결과가 나왔고 E2E도 그걸 전제로 짜여 있었다. 이제는 아무 결과도 나오지 않고,
 * 그 사실과 다음에 할 일을 화면이 말해 줘야 한다.
 *
 * 모델을 호출하지 않으므로 키 없이 돌아간다.
 */
import { expect, test } from '@playwright/test';
import {
  analysisPayload,
  runAnalysis,
  seedWorkspaceWithoutAnalysis,
  stubAnalysisUnconfigured,
} from './support/workspace';

test.describe('분석 키가 없는 상태', () => {
  test.beforeEach(async ({ page }) => {
    await seedWorkspaceWithoutAnalysis(page);
    await stubAnalysisUnconfigured(page);
  });

  test('키 등록 배너를 띄우고, 분석을 시도하면 이유를 남긴 채 실패한다', async ({ page }) => {
    await page.goto('/');

    // 서버에도 브라우저에도 키가 없으면 먼저 등록을 요청한다.
    const keyBanner = page.getByTestId('analysis-key-banner');
    await expect(keyBanner).toBeVisible();
    await expect(keyBanner).toContainText('OpenAI API 키가 필요합니다');
    await expect(keyBanner.getByRole('button', { name: /^키 등록$/ })).toBeVisible();

    await page.getByRole('button', { name: /^병합 결과$/ }).click();

    // 샘플이든 사용자 초안이든, 분석 전에는 결과가 없다고 말해야 한다.
    await expect(page.getByRole('heading', { name: /^아직 병합 결과가 없습니다\.$/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`^${analysisPayload.drafts.length}개 초안으로 분석 실행$`) }),
    ).toBeVisible();

    await runAnalysis(page);

    // 실패는 2.4초 토스트가 아니라 사라지지 않는 배너로 남는다.
    const errorBanner = page.getByTestId('analysis-error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('분석에 실패했습니다.');
    await expect(errorBanner).toContainText('API 키가 없습니다');

    // 규칙 기반 결과가 대신 그려지지 않는다.
    await expect(page.getByRole('heading', { name: /^아직 병합 결과가 없습니다\.$/ })).toBeVisible();
  });

  test('키 등록 폼은 키를 화면에 노출하지 않고 저장 위치를 밝힌다', async ({ page }) => {
    await page.goto('/');

    // 설정 화면에도 같은 폼이 있으므로 배너 안으로 한정한다.
    const banner = page.getByTestId('analysis-key-banner');
    await banner.getByRole('button', { name: /^키 등록$/ }).click();

    const input = banner.getByLabel('OpenAI API 키');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(banner.getByText('이 브라우저에만 저장되고')).toBeVisible();

    // 형식이 맞지 않는 값은 400으로 거절되고 그 이유가 폼에 남는다.
    await input.fill('not-a-key');
    await banner.getByRole('button', { name: /^확인하고 저장$/ }).click();
    await expect(banner.getByText('OpenAI API 키 형식이 아닙니다.')).toBeVisible();
  });
});
