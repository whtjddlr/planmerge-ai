/**
 * E2E 공용 셋업.
 *
 * 폴백이 제거된 뒤로 "키 없이 결과가 나온다"는 전제가 사라졌다. 그래서 결과가
 * 있어야 하는 테스트는 분석 API를 가로채 **실제 모델 출력 픽스처**를 돌려준다.
 * 유료 호출 없이 결정적으로 돌고, 모델이 실제로 규칙을 지키는지는 `npm run test:live`가 본다.
 *
 * 픽스처는 7명이 각자 다른 AI로 쓴 초안을 `gpt-5.6-luna`로 실제 병합한 결과다.
 * 충돌 4건, 금지 방향 위반 1건, 여러 작성자가 근거가 된 옵션 6건이 들어 있어
 * 손으로 만든 데이터보다 화면 상태를 훨씬 넓게 덮는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

// Playwright는 스펙을 CJS로 트랜스파일하므로 import.meta를 쓸 수 없다.
// 테스트는 항상 프로젝트 루트에서 실행되므로 루트 기준 경로로 읽는다.
const FIXTURE_DIR = resolve(process.cwd(), 'e2e', 'fixtures');

export const analysisPayload = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, 'multi-author-payload.json'), 'utf8'),
) as {
  project: Record<string, unknown>;
  drafts: Array<{ id: string; authorName: string; aiModel: string; rawText: string }>;
};

export const analysisResult = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, 'multi-author-result.json'), 'utf8'),
) as {
  protocolVersion: string;
  decisionBlocks: Array<{
    id: string;
    sectionKey: string;
    selectedOptionId: string;
    conflictLevel: string;
    options: Array<{ id: string; optionType: string; content: string }>;
  }>;
};

const WORKSPACE_ID = 'e2e-multi-author';

/** 분석 전 상태의 워크스페이스를 심는다. 초안만 있고 병합 결과는 없다. */
export async function seedWorkspaceWithoutAnalysis(page: Page) {
  await page.addInitScript(
    ([workspaceId, project, drafts]) => {
      window.localStorage.clear();
      window.localStorage.setItem(
        `planmerge_workspace_v1:${workspaceId}`,
        JSON.stringify({
          analysisRunId: 0,
          project,
          drafts,
          approvedBlockIds: [],
          decisionLogs: [],
        }),
      );
      window.localStorage.setItem(
        'planmerge_workspaces_v1',
        JSON.stringify([{
          id: workspaceId,
          title: (project as { title: string }).title,
          draftCount: (drafts as unknown[]).length,
          updatedAt: new Date().toISOString(),
        }]),
      );
      window.localStorage.setItem('planmerge_active_workspace_v1', workspaceId);
    },
    [WORKSPACE_ID, analysisPayload.project, analysisPayload.drafts] as const,
  );
}

/**
 * 서버에 분석 키가 설정된 것처럼 응답한다.
 *
 * 이걸 부르지 않으면 앱은 키 등록 배너를 띄운다. 그 상태 자체가 keyless 스펙의 검증 대상이다.
 */
export async function stubConfiguredProvider(page: Page) {
  await page.route('**/api/analysis-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ serverConfigured: true, provider: 'openai', model: 'gpt-5.6-luna' }),
    });
  });
}

/** 분석 API를 실제 모델 출력 픽스처로 가로챈다. */
export async function stubAnalysis(page: Page) {
  await page.route('**/api/analyze/planmerge', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'x-planmerge-usage': JSON.stringify({
          inputTokens: 17331, outputTokens: 9919, reasoningTokens: 2628, calls: 8,
        }),
      },
      body: JSON.stringify(analysisResult),
    });
  });
}

/**
 * 분석 API를 NDJSON 스트림으로 가로챈다. 진행 이벤트 두 개 뒤에 결과가 온다.
 * 진행 표시가 서버 이벤트에서만 나오는지(시간으로 꾸미지 않는지) 보는 스펙이 쓴다.
 */
export async function stubAnalysisStream(page: Page) {
  const lines = [
    { type: 'progress', stage: 'normalize', status: 'started', completed: 0, total: analysisPayload.drafts.length },
    { type: 'progress', stage: 'normalize', status: 'done', completed: analysisPayload.drafts.length, total: analysisPayload.drafts.length },
    { type: 'progress', stage: 'merge', status: 'started' },
    { type: 'progress', stage: 'merge', status: 'done' },
    { type: 'progress', stage: 'compose', status: 'started' },
    { type: 'progress', stage: 'compose', status: 'done' },
    {
      type: 'result',
      result: analysisResult,
      usage: { inputTokens: 17331, outputTokens: 9919, reasoningTokens: 2628, calls: 9 },
    },
  ];

  await page.route('**/api/analyze/planmerge', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson; charset=utf-8',
      body: lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
    });
  });
}

/** 분석 API가 모델 편차로 502를 낸 상태. 사유 코드가 화면 안내로 이어지는지 본다. */
export async function stubAnalysisFailure(page: Page, reason: string) {
  await page.route('**/api/analyze/planmerge', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'analysis_failed',
        reason,
        errors: ['gpt-5.6-luna 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.'],
      }),
    });
  });
}

/** 분석 API가 키 미설정으로 실패하는 상태를 만든다. */
export async function stubAnalysisUnconfigured(page: Page) {
  await page.route('**/api/analyze/planmerge', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'analysis_provider_unconfigured',
        errors: ['AI 분석에 사용할 API 키가 없습니다. 화면에서 키를 등록하거나 서버에 OPENAI_API_KEY를 설정해 주세요.'],
      }),
    });
  });
}

export async function openToolbarMenu(page: Page) {
  await page.getByRole('button', { name: '추가 작업' }).click();
}

/**
 * 분석을 실행한다.
 *
 * 결과가 없을 때는 병합 화면의 준비 CTA가 유일한 경로이고, 결과가 있으면 툴바
 * 메뉴의 "다시 분석"을 쓴다. 실제 사용자가 누르는 버튼을 그대로 따라간다.
 */
export async function runAnalysis(page: Page) {
  const prepCta = page.getByRole('button', { name: /개 초안으로 분석 실행$/ });

  if (await prepCta.count()) {
    await prepCta.first().click();
    return;
  }

  await openToolbarMenu(page);
  await page.getByRole('button', { name: /^다시 분석$/ }).click();
}

/** 금지 방향 충돌 옵션을 가진 블록. 픽스처에서 찾아 쓴다. */
export function findForbiddenConflictBlock() {
  const block = analysisResult.decisionBlocks.find((entry) => (
    entry.conflictLevel === 'high'
    && entry.options.some((option) => option.optionType === 'conflict')
  ));

  if (!block) {
    throw new Error('fixture must contain a high-conflict decision block');
  }

  return block;
}

export function sectionNumberOf(sectionKey: string) {
  const order = [
    'overview', 'problem', 'target_user', 'pain_points', 'solution', 'core_features',
    'mvp_scope', 'user_flow', 'requirements', 'success_metrics', 'risks', 'open_questions',
  ];
  const index = order.indexOf(sectionKey);

  if (index < 0) {
    throw new Error(`unknown sectionKey: ${sectionKey}`);
  }

  return index + 1;
}
