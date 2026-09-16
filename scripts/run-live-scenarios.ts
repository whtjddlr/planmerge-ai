/**
 * 실행 중인 서버에 실제 모델 분석을 돌려 결과가 규칙을 지키는지 확인한다.
 *
 *   npm run dev                 # 다른 터미널에서
 *   npm run test:live
 *
 * 키는 `OPENAI_API_KEY`에서 읽어 BYOK 헤더로 보낸다. 서버에 키가 설정돼 있으면
 * 서버 키가 우선하므로 어느 쪽이든 동작한다.
 *
 * 이 스크립트는 유료 호출을 발생시킨다. `harness:quality`(오프라인)와 달리 CI 기본
 * 경로에 넣지 않는다.
 */
import { liveScenarios, type LiveScenario } from './live-scenarios';
import {
  validatePlanMergeAnalysis,
  type PlanMergeAnalysisResult,
} from '../src/planmerge/lib/ai/planmergeProtocol';
import {
  ANALYSIS_KEY_HEADER,
  ANALYSIS_MODEL_HEADER,
} from '../src/planmerge/lib/ai/analysisCredentials';

const BASE_URL = process.env.PLANMERGE_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.OPENAI_API_KEY?.trim();
const MODEL = process.env.OPENAI_ANALYSIS_MODEL?.trim();
// 분석 라우트는 분당 5회로 제한된다. 시나리오 사이에 여유를 둔다.
const GAP_MS = 13_000;

type ScenarioOutcome = {
  id: string;
  title: string;
  intent: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  failures: string[];
  summary?: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 모든 시나리오에 공통으로 적용되는 불변식.
 *
 * 프로토콜 검증기가 잡는 구조적 규칙 위에, "모델이 실제로 정직했는가"에 해당하는
 * 것들을 더 본다. 출처 텍스트를 지어내지 않았는지가 핵심이다.
 */
function checkSharedInvariants(
  scenario: LiveScenario,
  result: PlanMergeAnalysisResult,
): string[] {
  const failures: string[] = [];
  const payload = { project: scenario.project, drafts: scenario.drafts };

  const validation = validatePlanMergeAnalysis(payload, result);
  if (!validation.valid) {
    failures.push(`프로토콜 검증 실패: ${validation.errors.slice(0, 4).join('; ')}`);
  }

  if (result.protocolVersion !== '0.3') {
    failures.push(`protocolVersion이 0.3이 아니다: ${result.protocolVersion}`);
  }

  // 로컬 규칙 결과가 실제 분석인 척 돌아오면 안 된다.
  if (result.source !== 'openai' && result.source !== 'gms') {
    failures.push(`source가 실제 제공자가 아니다: ${result.source}`);
  }

  const draftsById = new Map(scenario.drafts.map((entry) => [entry.id, entry]));

  for (const idea of result.normalizedIdeas) {
    const source = draftsById.get(idea.sourceDraftId);

    if (!source) {
      failures.push(`아이디어 ${idea.id}가 존재하지 않는 초안을 가리킨다`);
      continue;
    }

    if (idea.sourceModel !== source.aiModel) {
      failures.push(`아이디어 ${idea.id}의 sourceModel이 초안과 다르다`);
    }

    // sourceExcerpt는 원문에서 온 것이어야 한다. 모델이 매끄럽게 다듬는 경우가 있어
    // 완전 일치는 요구하지 않고, 원문과 충분히 겹치는지를 본다.
    const overlap = excerptOverlap(idea.sourceExcerpt, source.rawText);
    if (overlap < 0.5) {
      failures.push(
        `아이디어 ${idea.id}의 sourceExcerpt가 원문과 거의 겹치지 않는다 (겹침 ${Math.round(overlap * 100)}%): "${idea.sourceExcerpt.slice(0, 50)}"`,
      );
    }

    const judgement = idea.forbiddenDirectionConflict;

    if (!judgement.reason.trim()) {
      failures.push(`아이디어 ${idea.id}에 금지 방향 판정 근거가 없다`);
    }
    if (judgement.conflicts && !judgement.evidence.trim()) {
      failures.push(`아이디어 ${idea.id}가 충돌이라면서 근거 원문이 없다`);
    }
  }

  // 금지 방향으로 판정된 아이디어는 어떤 블록에서도 선택안이 될 수 없다.
  const conflicting = new Set(
    result.normalizedIdeas
      .filter((idea) => idea.forbiddenDirectionConflict.conflicts && idea.intent !== 'warn')
      .map((idea) => idea.id),
  );

  for (const block of result.decisionBlocks) {
    const selected = block.options.find((option) => option.id === block.selectedOptionId);

    if (!selected) {
      failures.push(`블록 ${block.id}에 selectedOptionId가 가리키는 옵션이 없다`);
      continue;
    }

    if (selected.sourceIdeaIds.some((ideaId) => conflicting.has(ideaId))) {
      failures.push(`블록 ${block.id}의 선택안이 금지 방향 아이디어에 근거한다`);
    }
  }

  return failures;
}

/** 발췌가 원문에서 왔는지 보는 거친 척도. 어절 단위 포함 비율. */
function excerptOverlap(excerpt: string, rawText: string) {
  const tokens = excerpt
    .split(/\s+/)
    .map((token) => token.replace(/[.,!?"'()]/g, ''))
    .filter((token) => token.length > 1);

  if (!tokens.length) {
    return 0;
  }

  const haystack = rawText.replace(/\s+/g, ' ');
  const hits = tokens.filter((token) => haystack.includes(token)).length;

  return hits / tokens.length;
}

function summarize(result: PlanMergeAnalysisResult) {
  const conflicts = result.normalizedIdeas.filter(
    (idea) => idea.forbiddenDirectionConflict.conflicts,
  ).length;

  return [
    `ideas=${result.normalizedIdeas.length}`,
    `blocks=${result.decisionBlocks.length}`,
    `sections=${result.finalDocumentSections.length}`,
    `missing=${result.missingSections.length}`,
    `forbidden=${conflicts}`,
    `review=${result.decisionBlocks.filter((block) => block.needsHumanReview).length}`,
  ].join(' ');
}

async function runScenario(scenario: LiveScenario): Promise<ScenarioOutcome> {
  const startedAt = Date.now();
  const base: Omit<ScenarioOutcome, 'status' | 'failures'> = {
    id: scenario.id,
    title: scenario.title,
    intent: scenario.intent,
    durationMs: 0,
  };

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}/api/analyze/planmerge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { [ANALYSIS_KEY_HEADER]: API_KEY } : {}),
        ...(API_KEY && MODEL ? { [ANALYSIS_MODEL_HEADER]: MODEL } : {}),
      },
      body: JSON.stringify({ project: scenario.project, drafts: scenario.drafts }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      status: 'FAIL',
      failures: [`요청 실패: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text();
    return {
      ...base,
      durationMs,
      status: 'FAIL',
      failures: [`HTTP ${response.status}: ${body.slice(0, 200)}`],
    };
  }

  const result = await response.json() as PlanMergeAnalysisResult;
  const failures = [
    ...checkSharedInvariants(scenario, result),
    ...scenario.check(result),
  ];

  return {
    ...base,
    durationMs,
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    summary: summarize(result),
  };
}

async function main() {
  console.log(`\nPlanMerge 실제 모델 시나리오 — ${BASE_URL}`);
  console.log(`키 출처: ${API_KEY ? 'OPENAI_API_KEY (BYOK 헤더)' : '서버 설정에 의존'}\n`);

  const outcomes: ScenarioOutcome[] = [];

  for (const [index, scenario] of liveScenarios.entries()) {
    process.stdout.write(`▶ ${scenario.id} … `);
    const outcome = await runScenario(scenario);
    outcomes.push(outcome);
    console.log(`${outcome.status} (${(outcome.durationMs / 1000).toFixed(1)}s)`);

    if (index < liveScenarios.length - 1) {
      await delay(GAP_MS);
    }
  }

  console.log('\n────────────────────────────────────────');

  for (const outcome of outcomes) {
    console.log(`\n${outcome.status} ${outcome.id} — ${outcome.title}`);
    console.log(`  의도: ${outcome.intent}`);

    if (outcome.summary) {
      console.log(`  결과: ${outcome.summary}`);
    }

    for (const failure of outcome.failures) {
      console.log(`  ✗ ${failure}`);
    }
  }

  const failed = outcomes.filter((outcome) => outcome.status === 'FAIL');

  console.log('\n────────────────────────────────────────');
  console.log(`실제 모델 시나리오: ${outcomes.length - failed.length}/${outcomes.length} 통과`);

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
