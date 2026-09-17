/**
 * Decision Room 판단을 여러 모델에 같은 과제로 돌려 비교한다.
 *
 * "판단 모델은 더 큰 걸 써야 하나"는 추측으로 답할 수 없다. 이 스크립트는 실제
 * 프롬프트와 실제 검증기를 그대로 써서, 모델별로 다음을 본다.
 *
 * - 제안이 구조 검증을 통과하는가
 * - 금지 방향 옵션을 추천하지 않는가 (이 과제의 정답)
 * - ready / needs_input 중 무엇을 고르는가
 * - 추론 토큰을 얼마나 쓰고 얼마나 걸리는가
 *
 *   OPENAI_API_KEY=... npx tsx scripts/compare-decision-models.ts
 *
 * 유료 호출을 낸다. 모델 수 × 1회.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildDecisionResolutionPrompt,
  createDecisionResolutionPayload,
  decisionResolutionProposalJsonSchema,
  validateDecisionResolutionProposal,
} from '../src/planmerge/lib/ai/decisionResolution';
import { callResponsesJsonWithMetadata, resetModelCapabilityCache } from '../src/planmerge/lib/ai/gmsServer';
import { conflictsWithForbiddenDirection } from '../src/planmerge/lib/ai/planmergeProtocol';
import type { PlanMergeAnalysisResult } from '../src/planmerge/lib/ai/planmergeProtocol';
import { OPENAI_RESPONSES_URL } from '../src/planmerge/lib/ai/analysisCredentials';

const MODELS = (process.env.COMPARE_MODELS ?? 'gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const apiKey = process.env.OPENAI_API_KEY?.trim();

if (!apiKey) {
  console.error('OPENAI_API_KEY가 필요합니다.');
  process.exit(1);
}

// 기본은 e2e 픽스처(금지 방향 충돌 과제). COMPARE_PAYLOAD/COMPARE_RESULT로
// 다른 과제를 줄 수 있다 — 근거가 빈약해 물러서야 하는 경우가 모델을 더 잘 가른다.
const fixtureDir = resolve(process.cwd(), 'e2e', 'fixtures');
const payloadPath = process.env.COMPARE_PAYLOAD ?? resolve(fixtureDir, 'multi-author-payload.json');
const resultPath = process.env.COMPARE_RESULT ?? resolve(fixtureDir, 'multi-author-result.json');
const payloadInput = JSON.parse(readFileSync(payloadPath, 'utf8')) as { project: never; drafts: never[] };
const analysisResult = JSON.parse(readFileSync(resultPath, 'utf8')) as PlanMergeAnalysisResult;

const ideasById = new Map(analysisResult.normalizedIdeas.map((idea) => [idea.id, idea]));

/** 금지 방향 충돌이 살아 있는 블록을 고른다. 판단이 실제로 어려운 과제다. */
const targetBlock = analysisResult.decisionBlocks.find((block) => (
  block.options.some((option) => (
    option.optionType === 'conflict'
    && option.sourceIdeaIds.some((ideaId) => {
      const idea = ideasById.get(ideaId);
      return idea !== undefined && conflictsWithForbiddenDirection(idea);
    })
  ))
));

// 충돌 블록이 없는 픽스처(빈약 입력)라면 첫 블록을 과제로 쓴다.
const block = targetBlock ?? analysisResult.decisionBlocks[0];

if (!block) {
  console.error('픽스처에 Decision Block이 없습니다.');
  process.exit(1);
}

/** 이 옵션들을 추천하면 오답이다. */
const forbiddenOptionIds = new Set(
  block.options
    .filter((option) => option.sourceIdeaIds.some((ideaId) => {
      const idea = ideasById.get(ideaId);
      return idea !== undefined && conflictsWithForbiddenDirection(idea);
    }))
    .map((option) => option.id),
);

const payload = createDecisionResolutionPayload({
  project: payloadInput.project,
  drafts: payloadInput.drafts,
  analysisResult,
  decisionBlockId: block.id,
  opinions: [{
    id: 'opinion-compare',
    content: '채팅 없이 신청 수락률이 떨어질까 걱정입니다. 대신할 방법을 같이 정해 주세요.',
    createdAtLabel: '방금 전',
  }],
});

const prompt = buildDecisionResolutionPrompt(payload);

async function run(model: string) {
  resetModelCapabilityCache();
  const startedAt = Date.now();

  try {
    const response = await callResponsesJsonWithMetadata<unknown>(prompt, {
      apiKey: apiKey!,
      apiUrl: OPENAI_RESPONSES_URL,
      model,
      maxOutputTokens: 8_000,
      providerLabel: 'OpenAI Responses API',
      reasoningEffort: 'medium',
      jsonSchema: {
        name: 'planmerge_decision_resolution',
        schema: decisionResolutionProposalJsonSchema,
      },
    });
    const elapsed = Date.now() - startedAt;
    const validation = validateDecisionResolutionProposal(payload, response.data);

    if (!validation.valid) {
      return {
        model,
        elapsed,
        verdict: 'INVALID',
        detail: validation.errors.slice(0, 2).join('; '),
        usage: response.usage,
      };
    }

    const { proposal } = validation;
    const recommended = proposal.recommendedOptionId;
    const pickedForbidden = Boolean(recommended && forbiddenOptionIds.has(recommended))
      || proposal.supportingOptionIds.some((id) => forbiddenOptionIds.has(id));

    return {
      model,
      elapsed,
      verdict: pickedForbidden ? 'FORBIDDEN' : 'OK',
      detail: `${proposal.status} · confidence ${proposal.confidence} · recommended ${recommended ?? 'null'}`,
      summary: proposal.summary,
      usage: response.usage,
    };
  } catch (error) {
    return {
      model,
      elapsed: Date.now() - startedAt,
      verdict: 'ERROR',
      detail: error instanceof Error ? error.message.slice(0, 120) : String(error),
    };
  }
}

async function main() {
  console.log(`\nDecision Room 판단 비교 — 블록 ${block.id} (${block.sectionKey})`);
  console.log(`금지 방향 옵션 ${forbiddenOptionIds.size}개를 추천하면 오답\n`);

  for (const model of MODELS) {
    process.stdout.write(`  ${model.padEnd(16)} … `);
    const outcome = await run(model);
    const tokens = outcome.usage
      ? `in ${outcome.usage.inputTokens} / out ${outcome.usage.outputTokens} / reasoning ${outcome.usage.reasoningTokens}`
      : '-';

    console.log(`${outcome.verdict.padEnd(10)} ${(outcome.elapsed / 1000).toFixed(1)}s  ${tokens}`);
    console.log(`      ${outcome.detail}`);

    if (outcome.summary) {
      console.log(`      요약: ${outcome.summary.slice(0, 100)}`);
    }
  }

  console.log('');
}

void main();
