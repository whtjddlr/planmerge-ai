import { expect, test } from '@playwright/test';

test.describe('PlanMerge GPT-5.6 Decision Room', () => {
  test.setTimeout(120_000);

  test('reviews an evidence-backed patch, applies one section, and records model evidence', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });

    await page.route('**/api/decision-blocks/*/resolution', async (route) => {
      const requestPayload = route.request().postDataJSON() as DecisionResolutionRequest;
      const decisionBlock = requestPayload.analysisResult.decisionBlocks.find(
        (block) => block.id === requestPayload.decisionBlockId,
      );

      if (!decisionBlock) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ errors: ['mock decision block missing'] }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          proposal: {
            decisionBlockId: decisionBlock.id,
            status: 'ready',
            summary: '빠른 사용자 검증을 우선하면서 기존 근거를 보존한 합의안입니다.',
            recommendedOptionId: decisionBlock.selectedOptionId,
            supportingOptionIds: [decisionBlock.selectedOptionId],
            synthesizedDecision: '핵심 병합 흐름을 먼저 검증하고 외부 연동은 후속 단계로 분리합니다.',
            revisedSectionContent: '첫 릴리스는 텍스트 입력, AI 병합, 근거 검토, 결과 내보내기까지 제공합니다. Slack과 Notion 연동은 핵심 지표를 확인한 뒤 후속 단계에서 추가합니다.',
            selectionReason: '프로젝트의 4주 검증 목표와 외부 연동 제외 원칙을 가장 직접적으로 충족하는 근거를 선택했습니다.',
            addressedOpinionIds: [],
            clarifyingQuestion: null,
            unresolvedRisks: ['초기 표본이 작으면 효율 개선 지표의 변동성이 클 수 있습니다.'],
            confidence: 0.88,
          },
          source: 'openai',
          model: 'gpt-5.6-sol',
          responseId: 'resp_e2e_decision_room',
          generatedAt: '2026-07-16T00:00:00.000Z',
          applicable: true,
        }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /^검증 샘플 바로 열기$/ }).click();
    await page.getByTestId('document-section-7').click();

    const decisionRoom = page.getByTestId('decision-resolution-panel');
    await expect(decisionRoom).toBeVisible();
    await expect(decisionRoom).toContainText('Decision Room');

    await decisionRoom.getByTestId('decision-resolution-trigger').click();

    await expect(decisionRoom.getByTestId('decision-resolution-before')).toContainText('Before');
    await expect(decisionRoom.getByTestId('decision-resolution-after')).toContainText(
      '첫 릴리스는 텍스트 입력',
    );
    await expect(decisionRoom.getByTestId('decision-resolution-evidence')).toContainText(
      '검증된 근거',
    );
    await expect(decisionRoom).toContainText('gpt-5.6-sol');
    await expect(decisionRoom).toContainText('resp_e2e_decision_room');

    await decisionRoom.getByTestId('decision-resolution-apply').click();

    await expect(page.getByTestId('app-notice')).toContainText('GPT-5.6 합의 패치를 적용했습니다.');
    await expect(page.getByTestId('document-section-7')).toContainText(
      '첫 릴리스는 텍스트 입력',
    );
    await expect(page.getByTestId('decision-resolution-panel')).toHaveCount(0);

    await page.getByRole('navigation').getByRole('button', { name: /^분석 Inspector$/ }).click();
    await page.getByRole('button', { name: /^Decision Logs$/ }).click();

    const decisionLog = page.getByTestId('decision-log-entry').first();
    await expect(decisionLog).toContainText('GPT-5.6 consensus');
    await expect(decisionLog.getByTestId('decision-log-model-evidence')).toContainText('gpt-5.6-sol');
    await expect(decisionLog.getByTestId('decision-log-model-evidence')).toContainText(
      'resp_e2e_decision_room',
    );
  });
});

type DecisionResolutionRequest = {
  decisionBlockId: string;
  analysisResult: {
    decisionBlocks: Array<{
      id: string;
      selectedOptionId: string;
    }>;
  };
};
