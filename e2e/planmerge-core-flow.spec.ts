import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.describe.serial('PlanMerge keyless fallback core flow', () => {
  test.setTimeout(120_000);

  test('runs the sample fallback flow, overrides a decision, exports, approves, and handles DB-less share', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });

    await page.goto('/');
    const navigation = page.getByRole('navigation');

    await expect(page).toHaveTitle('PlanMerge');
    await expect(page.getByRole('heading', { level: 1, name: /^프로젝트 설정$/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /^새 병합 프로젝트 만들기$/ })).toBeVisible();

    await page.getByRole('button', { name: /^검증 샘플 바로 열기$/ }).click();
    await expect(page.getByTestId('workspace-switcher')).toContainText('검증 샘플');
    await expect(page.getByRole('heading', { level: 1, name: /^병합 결과$/ })).toBeVisible();
    await expect(page.getByRole('heading', {
      level: 1,
      name: /^회의록 기반 액션아이템 정리 SaaS 기획서$/,
    })).toBeVisible();

    await navigation.getByRole('button', { name: /^초안 입력$/ }).click();
    const analysisResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/analyze/planmerge') && response.request().method() === 'POST',
    );

    const runAnalysisButton = page.getByRole('button', { name: /^병합 분석 실행$/ });
    await runAnalysisButton.click();

    const analysisResponse = await analysisResponsePromise;
    expect(analysisResponse.status()).toBe(200);

    const analysisPayload: unknown = await analysisResponse.json();
    expect(getStringField(analysisPayload, 'source')).toBe('local_harness');
    expect(getStringArrayField(analysisPayload, 'warnings')).toContain(
      'GMS_API_KEY가 없어 로컬 하네스를 사용했습니다.',
    );
    await expect(runAnalysisButton).toBeEnabled();

    await navigation.getByRole('button', { name: /^분석 Inspector$/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Analysis Inspector$/ })).toBeVisible();
    await page.getByRole('button', { name: /^Validation$/ }).click();

    const warningsSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: /^Warnings$/ }),
    });
    await expect(warningsSection.getByText('GMS_API_KEY가 없어 로컬 하네스를 사용했습니다.', { exact: true }))
      .toBeVisible();

    await navigation.getByRole('button', { name: /^병합 결과$/ }).click();
    await expect(page.getByText('Local Harness', { exact: true })).toBeVisible();

    const mvpSection = page.getByTestId('document-section-7');
    await expect(mvpSection).toContainText('MVP 범위');
    await mvpSection.click();

    const decisionPanel = page.getByTestId('decision-panel');
    await expect(decisionPanel.getByRole('heading', { level: 2, name: /^선택 과정$/ })).toBeVisible();
    await expect(decisionPanel).toContainText('충돌 의견');

    const applyOptionButton = decisionPanel.getByTestId('apply-decision-option').first();
    await expect(applyOptionButton).toBeVisible();
    await applyOptionButton.click();

    await expect(page.getByTestId('app-notice')).toContainText('선택안을 변경하고');
    await expect(decisionPanel).toContainText('사용자 선택');

    await navigation.getByRole('button', { name: /^분석 Inspector$/ }).click();
    await page.getByRole('button', { name: /^Decision Logs$/ }).click();

    const decisionLog = page.getByTestId('decision-log-entry').first();
    await expect(decisionLog).toBeVisible();
    await expect(decisionLog).toContainText('사용자 변경');
    await expect(decisionLog).toContainText('변경 후');
    await expect(decisionLog).toContainText('선택 과정 패널');

    await openToolbarMenu(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Markdown 내보내기$/ }).click();

    const download = await downloadPromise;
    const downloadPath = await download.path();

    if (!downloadPath) {
      throw new Error('Markdown download path was not available.');
    }

    const markdown = await readFile(downloadPath, 'utf8');

    expect(markdown).toContain('## 의사결정 기록');
    expect(markdown).toContain('## 분석 경고');
    expect(markdown).toContain('GMS_API_KEY가 없어 로컬 하네스를 사용했습니다.');
    expect(markdown).toMatch(/#### 출처\s+- /);

    await navigation.getByRole('button', { name: /^병합 결과$/ }).click();
    await page.getByTestId('document-section-7').click();
    await page.getByRole('button', { name: /^선택안 승인$/ }).click();

    await expect(page.getByRole('button', { name: /^승인 완료$/ })).toBeVisible();
    await expect(page.getByTestId('app-notice')).toContainText('선택안을 승인했습니다.');

    await page.getByTestId('document-section-1').click();
    await expect(page.getByRole('button', { name: /^선택안 승인$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^승인 완료$/ })).toHaveCount(0);

    await openToolbarMenu(page);

    const shareButton = page.getByRole('button', { name: /^팀 공유 링크 만들기$/ });
    await expect(shareButton).toBeVisible();

    if (await shareButton.isDisabled()) {
      await expect(shareButton).toHaveAttribute(
        'title',
        /분석 결과가 있어야 공유할 수 있습니다.|품질 게이트 차단/,
      );
    } else {
      const shareResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/api/workspaces') && response.request().method() === 'POST',
      );

      await shareButton.click();

      const shareResponse = await shareResponsePromise;
      expect(shareResponse.status()).toBe(503);
      await expect(page.getByTestId('app-notice')).toContainText(
        '데이터베이스가 설정되지 않아 공유 기능을 사용할 수 없습니다.',
      );
      await expect(page.getByLabel('팀 공유 링크')).toHaveCount(0);
    }
  });
});

async function openToolbarMenu(page: Page) {
  await page.getByRole('button', { name: /^추가 작업$/ }).click();
  await expect(page.getByRole('button', { name: /^Markdown 내보내기$/ })).toBeVisible();
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
