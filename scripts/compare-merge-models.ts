/**
 * 조율(merge) 단계를 모델별로 같은 입력에 돌려 비교한다.
 *
 * "조율 모델은 더 커야 하지 않나"는 Decision Room 비교로 답할 수 없다. 그쪽은
 * 옵션 두 개 중 고르는 과제고, merge는 아이디어 수십 개를 12섹션·12블록으로
 * 묶으면서 선택·근거·충돌을 동시에 정하는 훨씬 넓은 과제다. 크기 차이가 드러날
 * 곳이 있다면 여기다.
 *
 * 정규화 결과는 고정하고 merge 호출만 바꿔서, 채점 가능한 항목만 본다.
 *
 *   OPENAI_API_KEY=... npx tsx scripts/compare-merge-models.ts
 *
 * 유료 호출을 낸다. 모델 수 × 1회, 각 호출이 입력 수천 토큰이다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildMergeNormalizedIdeasPrompt,
  conflictsWithForbiddenDirection,
  documentSectionDefinitions,
  ensureServerOwnedSelectionSource,
  validatePlanMergeAnalysis,
} from '../src/planmerge/lib/ai/planmergeProtocol';
import type {
  NormalizedIdea,
  PlanMergeAnalysisPayload,
  PlanMergeAnalysisResult,
} from '../src/planmerge/lib/ai/planmergeProtocol';
import { callResponsesJsonWithMetadata, resetModelCapabilityCache } from '../src/planmerge/lib/ai/gmsServer';
import { OPENAI_RESPONSES_URL } from '../src/planmerge/lib/ai/analysisCredentials';

const MODELS = (process.env.COMPARE_MODELS ?? 'gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-5.5-pro')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

// merge는 temperature를 못 쓰는 추론 모델에서 돌기 때문에 출력이 결정적이지 않다.
// 한 번만 재고 결론 내리면 분산을 성능으로 착각한다.
const REPEATS = Math.max(1, Number(process.env.COMPARE_REPEATS ?? 1) || 1);

const apiKey = process.env.OPENAI_API_KEY?.trim();

if (!apiKey) {
  console.error('OPENAI_API_KEY가 필요합니다.');
  process.exit(1);
}

const fixtureDir = resolve(process.cwd(), 'e2e', 'fixtures');
const payload = JSON.parse(
  readFileSync(resolve(fixtureDir, 'multi-author-payload.json'), 'utf8'),
) as PlanMergeAnalysisPayload;
const reference = JSON.parse(
  readFileSync(resolve(fixtureDir, 'multi-author-result.json'), 'utf8'),
) as PlanMergeAnalysisResult;

/** 정규화 결과는 고정한다. 바뀌는 것은 merge 호출뿐이다. */
const ideas: NormalizedIdea[] = reference.normalizedIdeas;
const ideasById = new Map(ideas.map((idea) => [idea.id, idea]));
const authorByDraft = new Map(payload.drafts.map((draft) => [draft.id, draft.authorName]));
const forbiddenIdeaIds = new Set(
  ideas.filter((idea) => conflictsWithForbiddenDirection(idea)).map((idea) => idea.id),
);
const prompt = buildMergeNormalizedIdeasPrompt(payload, ideas);

type Score = {
  model: string;
  elapsed: number;
  status: string;
  sections: string;
  sourceCoverage: string;
  conflictsKept: number;
  forbiddenSelected: number;
  crossAuthorOptions: number;
  reasonTooShort: number;
  tokens: string;
  errors?: string[];
};

function score(model: string, elapsed: number, raw: unknown, tokens: string): Score {
  const base: Score = {
    model,
    elapsed,
    status: 'INVALID',
    sections: '-',
    sourceCoverage: '-',
    conflictsKept: 0,
    forbiddenSelected: 0,
    crossAuthorOptions: 0,
    reasonTooShort: 0,
    tokens,
  };

  if (typeof raw !== 'object' || raw === null) {
    return base;
  }

  // 서버가 하는 일을 그대로 흉내낸다: 아이디어를 붙이고 출처를 서버가 기록한다.
  const merged = ensureServerOwnedSelectionSource({
    ...(raw as PlanMergeAnalysisResult),
    protocolVersion: '0.3',
    source: 'openai',
    normalizedIdeas: ideas,
    warnings: Array.isArray((raw as PlanMergeAnalysisResult).warnings)
      ? (raw as PlanMergeAnalysisResult).warnings
      : [],
  });

  const validation = validatePlanMergeAnalysis(payload, merged);
  const blocks = Array.isArray(merged.decisionBlocks) ? merged.decisionBlocks : [];
  const finalSections = Array.isArray(merged.finalDocumentSections) ? merged.finalDocumentSections : [];

  const citedDrafts = new Set<string>();
  let crossAuthorOptions = 0;
  let forbiddenSelected = 0;
  let conflictsKept = 0;
  let reasonTooShort = 0;

  for (const block of blocks) {
    const options = Array.isArray(block.options) ? block.options : [];

    if ((block.selectionReason ?? '').trim().length < 20) {
      reasonTooShort += 1;
    }

    for (const option of options) {
      const authors = new Set(
        (option.sourceIdeaIds ?? [])
          .map((ideaId) => ideasById.get(ideaId)?.sourceDraftId)
          .filter((draftId): draftId is string => Boolean(draftId)),
      );

      authors.forEach((draftId) => citedDrafts.add(draftId));

      if (authors.size > 1) {
        crossAuthorOptions += 1;
      }

      if (option.optionType === 'conflict') {
        conflictsKept += 1;
      }

      if (option.id === block.selectedOptionId) {
        if ((option.sourceIdeaIds ?? []).some((ideaId) => forbiddenIdeaIds.has(ideaId))) {
          forbiddenSelected += 1;
        }
      }
    }
  }

  return {
    ...base,
    status: validation.valid ? 'VALID' : `INVALID(${validation.errors.length})`,
    ...(validation.valid ? {} : { errors: validation.errors.slice(0, 3) }),
    sections: `${finalSections.length}/${documentSectionDefinitions.length}`,
    sourceCoverage: `${citedDrafts.size}/${payload.drafts.length}`,
    conflictsKept,
    forbiddenSelected,
    crossAuthorOptions,
    reasonTooShort,
  };
}

async function run(model: string): Promise<Score> {
  resetModelCapabilityCache();
  const startedAt = Date.now();

  try {
    const response = await callResponsesJsonWithMetadata<unknown>(prompt, {
      apiKey: apiKey!,
      apiUrl: OPENAI_RESPONSES_URL,
      model,
      maxOutputTokens: 32_000,
      providerLabel: 'OpenAI Responses API',
      temperature: 0.1,
    });
    const usage = response.usage;

    return score(
      model,
      Date.now() - startedAt,
      response.data,
      usage ? `${usage.inputTokens}/${usage.outputTokens}` : '-',
    );
  } catch (error) {
    return {
      ...score(model, Date.now() - startedAt, null, '-'),
      status: `ERROR: ${error instanceof Error ? error.message.slice(0, 60) : String(error)}`,
    };
  }
}

async function main() {
  console.log(`\n조율(merge) 모델 비교 — 초안 ${payload.drafts.length}개 / 고정된 아이디어 ${ideas.length}개`);
  console.log(`작성자: ${[...authorByDraft.values()].join(', ')}`);
  console.log(`금지 방향 아이디어 ${forbiddenIdeaIds.size}개 — 선택안으로 올리면 오답\n`);

  const rows: Score[] = [];

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= REPEATS; attempt += 1) {
      const label = REPEATS > 1 ? `${model} #${attempt}` : model;
      process.stdout.write(`  ${label.padEnd(20)} … `);
      const row = await run(model);
      rows.push({ ...row, model: label });
      console.log(`${(row.elapsed / 1000).toFixed(1)}s ${row.status}`);

      if (row.errors) {
        for (const err of row.errors) console.log(`      ✗ ${err}`);
      }
    }
  }

  console.log('');
  console.log('  model            status    섹션    출처   충돌  금지선택  다중작성자옵션  짧은근거  tokens');
  console.log('  ' + '-'.repeat(96));

  for (const r of rows) {
    console.log(
      `  ${r.model.padEnd(20)} ${r.status.padEnd(9)} ${r.sections.padEnd(7)} ${r.sourceCoverage.padEnd(6)} `
      + `${String(r.conflictsKept).padEnd(5)} ${String(r.forbiddenSelected).padEnd(9)} `
      + `${String(r.crossAuthorOptions).padEnd(15)} ${String(r.reasonTooShort).padEnd(9)} ${r.tokens}`,
    );
  }

  console.log('\n  기준: 섹션 12/12 · 출처 7/7 · 금지선택 0 · 짧은근거 0 이 정답.');
  console.log('  충돌과 다중작성자옵션은 높을수록 이견을 평탄화하지 않았다는 뜻이다.\n');
}

void main();
