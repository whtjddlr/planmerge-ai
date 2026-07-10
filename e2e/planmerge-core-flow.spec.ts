import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.describe.serial('PlanMerge keyless fallback core flow', () => {
  test.setTimeout(120_000);

  test('runs the sample fallback flow, gates sharing, resolves a decision, exports, and handles DB-less share', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });

    await page.goto('/');

    await expect(page).toHaveTitle('PlanMerge');
    await expect(page.getByTestId('project-brief-panel')).toContainText('기준을 먼저 세우고');

    await page.getByTestId('load-sample-workspace-button').click();
    await expect(page.getByTestId('workspace-switcher')).toContainText('검증 샘플');
    await expect(page.getByTestId('decision-panel')).toBeVisible();

    await openToolbarMenu(page);
    await expect(page.getByTestId('toolbar-rerun-analysis-button')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('nav-drafts').click();
    await expect(page.getByTestId('shared-drafts-owner-panel')).toHaveCount(0);

    const analysisResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/analyze/planmerge') && response.request().method() === 'POST',
    );
    const runAnalysisButton = page.getByTestId('run-analysis-button');
    await runAnalysisButton.click();

    const analysisResponse = await analysisResponsePromise;
    expect(analysisResponse.status()).toBe(200);

    const analysisPayload: unknown = await analysisResponse.json();
    expect(getStringField(analysisPayload, 'source')).toBe('local_harness');
    expect(getStringArrayField(analysisPayload, 'warnings').join('\n')).toContain('GMS_API_KEY');
    await expect(runAnalysisButton).toBeEnabled();

    await page.getByTestId('nav-inspector').click();
    await expect(page.getByRole('heading', { level: 2, name: '근거와 품질 상태를 점검합니다.' })).toBeVisible();
    await page.getByTestId('inspector-tab-validation').click();
    await expect(page.getByText(/GMS_API_KEY/)).toBeVisible();

    await page.getByTestId('nav-merge').click();
    await expect(page.getByText('로컬 검증', { exact: true })).toBeVisible();

    await page.getByTestId('document-section-7').click();
    const decisionPanel = page.getByTestId('decision-panel');
    await expect(decisionPanel).toBeVisible();
    await expect(page.getByTestId('publication-primary-action')).toContainText('남은 검토 1건');

    await openToolbarMenu(page);
    const blockedShareButton = page.getByTestId('share-workspace-button');
    await expect(blockedShareButton).toBeDisabled();
    await expect(blockedShareButton).toHaveAttribute('title', /결정 1건|공유 보류/);
    await page.keyboard.press('Escape');

    await decisionPanel.getByTestId('decision-focus-toggle').click();
    await expect(decisionPanel).toHaveAttribute('data-focus-mode', 'true');
    await expect(decisionPanel.getByRole('heading', { name: '현재 문장과 대체 문장을 비교합니다.' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(decisionPanel).toHaveAttribute('data-focus-mode', 'false');

    await decisionPanel.getByTestId('approve-decision-button').click();
    await expect(decisionPanel.getByText('이 결정은 승인되었습니다.')).toBeVisible();
    await expect(page.getByTestId('publication-primary-action')).toContainText('최종본 내보내기');

    const applyOptionButton = decisionPanel.getByTestId('apply-decision-option').first();
    await expect(applyOptionButton).toBeVisible();
    await applyOptionButton.click();

    await expect(page.getByTestId('app-notice')).toBeVisible();
    await expect(page.getByTestId('publication-primary-action')).toContainText('최종본 내보내기');

    await page.getByTestId('nav-openQuestions').click();
    await expect(page.getByRole('heading', { level: 2, name: '검토 큐' })).toBeVisible();
    await expect(page.getByRole('main').getByText('공유 가능', { exact: true })).toBeVisible();
    await expect(page.getByText('검토 완료', { exact: true })).toBeVisible();

    await page.getByTestId('nav-inspector').click();
    await page.getByTestId('inspector-tab-logs').click();

    const decisionLog = page.getByTestId('decision-log-entry').first();
    await expect(decisionLog).toBeVisible();

    await openToolbarMenu(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-markdown-button').click();

    const download = await downloadPromise;
    const downloadPath = await download.path();

    if (!downloadPath) {
      throw new Error('Markdown download path was not available.');
    }

    const markdown = await readFile(downloadPath, 'utf8');

    expect(markdown).toContain('##');
    expect(markdown).toContain('GMS_API_KEY');

    await openToolbarMenu(page);
    const shareButton = page.getByTestId('share-workspace-button');
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toBeEnabled();

    const shareResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/workspaces') && response.request().method() === 'POST',
    );

    await shareButton.click();

    const shareResponse = await shareResponsePromise;
    expect(shareResponse.status()).toBe(503);
    await expect(page.getByTestId('app-notice')).toBeVisible();
    await expect(page.getByLabel(/공유 링크/)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.getByTestId('nav-drafts').click();
    await page.getByTestId('draft-raw-text-input').fill(
      '추가 초안: 파일 업로드와 기존 분석 이후 공유 범위를 다시 논의해야 한다.',
    );
    await page.getByTestId('draft-submit-button').click();
    await openToolbarMenu(page);
    await expect(page.getByTestId('share-workspace-button')).toBeDisabled();
  });
});

async function openToolbarMenu(page: Page) {
  await page.getByTestId('toolbar-menu-button').click();
  await expect(page.getByTestId('export-markdown-button')).toBeVisible();
}

function getStringField(value: unknown, key: string) {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];

  return typeof field === 'string' ? field : undefined;
}

function getStringArrayField(value: unknown, key: string) {
  if (!isRecord(value)) {
    return [];
  }

  const field = value[key];

  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
