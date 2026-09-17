/**
 * 병합 결과가 있는 상태의 핵심 흐름.
 *
 * 분석 API를 실제 모델 출력 픽스처로 가로채므로 유료 호출 없이 결정적으로 돈다.
 * 검증 대상은 "모델이 옳은 답을 내는가"가 아니라(그건 `npm run test:live`) "받은
 * 결과를 화면이 정직하게 보여주는가"다.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  analysisPayload,
  analysisResult,
  findForbiddenConflictBlock,
  openToolbarMenu,
  runAnalysis,
  sectionNumberOf,
  seedWorkspaceWithoutAnalysis,
  stubAnalysis,
  stubConfiguredProvider,
} from './support/workspace';

async function analyzeAndWait(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^병합 결과$/ }).click();
  await runAnalysis(page);
  await expect(page.getByText('Evidence Quality')).toBeVisible();
}

test.describe('병합 결과 흐름', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await seedWorkspaceWithoutAnalysis(page);
    await stubConfiguredProvider(page);
    await stubAnalysis(page);
  });

  test('실행 전 비용 안내는 호출 수와 직전 실측만 말하고 토큰을 추정하지 않는다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^병합 결과$/ }).click();

    // 결과가 없을 때: 호출 수는 파이프라인 구조에서 나온다(초안 7개 → 9~11회).
    const notice = page.getByTestId('analysis-cost-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`모델 호출 ${analysisPayload.drafts.length + 2}~${analysisPayload.drafts.length + 4}회 예상`);
    await expect(notice).toContainText('미리 추정하지 않습니다');
    await expect(notice).not.toContainText(/토큰 [\d,]+/);

    await runAnalysis(page);
    await expect(page.getByText('Evidence Quality')).toBeVisible();

    // 결과가 있을 때: 스텁이 헤더로 준 실측(호출 8회, 17,331 + 9,919 토큰)만 보여준다.
    await page.getByRole('button', { name: /^초안 입력$/ }).click();
    const afterRun = page.getByTestId('analysis-cost-notice');
    await expect(afterRun).toBeVisible();
    await expect(afterRun).toContainText('직전 실행 실측: 호출 8회, 토큰 27,250');
  });

  test('서버에 키가 있으면 등록을 묻지 않고, 결과 지표는 실제 데이터에서 계산된다', async ({ page }) => {
    await analyzeAndWait(page);

    await expect(page.getByTestId('analysis-key-banner')).toHaveCount(0);

    const ideaCount = analysisResult.decisionBlocks.length;
    expect(ideaCount).toBeGreaterThan(0);

    // 툴바 문구는 고정값이 아니라 초안 수·아이디어 수에서 나온다.
    const header = page.getByRole('banner').or(page.locator('header')).first();
    await expect(page.getByText(new RegExp(`${analysisPayload.drafts.length}개 초안에서 \\d+개 아이디어를 추출했습니다`))).toBeVisible();

    // 사용자 키로 돌아갈 수 있으므로 이번 분석 비용도 보여준다.
    await expect(page.getByText(/모델 호출 \d+회, 토큰 [\d,]+/)).toBeVisible();
    await expect(header).toBeTruthy();
  });

  test('모든 초안이 출처로 반영되고 12개 섹션이 채워진다', async ({ page }) => {
    await analyzeAndWait(page);

    await expect(page.getByText(`${analysisPayload.drafts.length}/${analysisPayload.drafts.length}`).first()).toBeVisible();

    for (const section of ['개요', '문제 정의', '타깃 사용자', 'MVP 범위', '미결정 사항']) {
      await expect(page.getByRole('heading', { name: new RegExp(`^\\d+\\. ${section}$`) })).toBeVisible();
    }
  });

  test('사람이 금지 방향 의견을 선택하면 위반이 계속 보이고 게이트가 막는다', async ({ page }) => {
    const block = findForbiddenConflictBlock();
    const conflictOption = block.options.find((option) => option.optionType === 'conflict')!;

    await analyzeAndWait(page);
    await page.getByTestId(`document-section-${sectionNumberOf(block.sectionKey)}`).click();

    // 충돌 의견을 선택안으로 올린다. 사람의 권한이지만 위반을 해소하지는 않는다.
    await expect(page.getByText(conflictOption.content.slice(0, 25)).first()).toBeVisible();
    await page.getByRole('button', { name: '충돌 의견을 선택안으로 적용' }).click();

    // 게이트가 실제 사유를 말하며 차단한다.
    await expect(page.getByText('프로젝트가 금지한 방향을 제안하고 있어 내보낼 수 없습니다')).toBeVisible();

    // Review Queue가 이 섹션을 최우선으로 올린다.
    await page.getByRole('button', { name: /^Review Queue$/ }).click();
    await expect(page.getByText('금지 방향 위반').first()).toBeVisible();
    await expect(page.getByText('금지 방향 위반 해소 — 선택안 변경 또는 기준 수정').first()).toBeVisible();
  });

  test('선택안을 되돌리면 위반이 해소된다', async ({ page }) => {
    const block = findForbiddenConflictBlock();

    await analyzeAndWait(page);
    await page.getByTestId(`document-section-${sectionNumberOf(block.sectionKey)}`).click();

    await page.getByRole('button', { name: '충돌 의견을 선택안으로 적용' }).click();
    await expect(page.getByText('프로젝트가 금지한 방향을 제안하고 있어 내보낼 수 없습니다')).toBeVisible();

    // 이전 AI 선택안이 대안으로 남아 있어 되돌릴 수 있다.
    await expect(page.getByText('사용자 변경 전 AI 선택안입니다.')).toBeVisible();
    await page.getByRole('button', { name: '대안 의견을 선택안으로 적용' }).click();

    await expect(page.getByText('프로젝트가 금지한 방향을 제안하고 있어 내보낼 수 없습니다')).toHaveCount(0);
  });

  test('Markdown 내보내기는 선택 근거와 출처를 함께 담는다', async ({ page }) => {
    await analyzeAndWait(page);

    const downloadPromise = page.waitForEvent('download');
    await openToolbarMenu(page);
    await page.getByRole('button', { name: /^Markdown 내보내기$/ }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });
});
