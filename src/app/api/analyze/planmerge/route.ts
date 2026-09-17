import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  buildDraftNormalizePrompt,
  MAX_ANALYSIS_DRAFT_COUNT,
  buildMergeNormalizedIdeasPrompt,
  buildPlanMergeRepairPrompt,
  documentSectionDefinitions,
  parsePlanMergeAnalysisPayload,
  ensureAssumptionBackedBlocksAreReviewed,
  ensureDecisionBlockShape,
  exceedsPlacementRecoveryLimit,
  ensureOptionsCiteKnownIdeas,
  applyRepairedDecisionBlocks,
  buildDecisionBlockRepairPrompt,
  ensureServerOwnedEnvelope,
  ensureServerOwnedSelectionSource,
  partitionBlockerScope,
  validateRepairedDecisionBlocks,
  validateDraftNormalizeResult,
  validatePlanMergeAnalysis,
} from '@/planmerge/lib/ai/planmergeProtocol';
import type {
  DraftNormalizeResult,
  NormalizedIdea,
  NormalizedIdeaIntent,
  NormalizedIdeaType,
  PlanMergeAnalysisPayload,
  PlanMergeAnalysisResult,
} from '@/planmerge/lib/ai/planmergeProtocol';
import {
  addModelUsage,
  callGmsJson,
  emptyModelUsage,
  getAnalysisConfig,
} from '@/planmerge/lib/ai/gmsServer';
import type { GmsConfig, ModelUsage } from '@/planmerge/lib/ai/gmsServer';
import {
  applyDocumentComposition,
  buildDocumentCompositionPrompt,
  validateDocumentCompositionResult,
} from '@/planmerge/lib/ai/documentComposition';
import {
  applyIdeaPlacements,
  buildIdeaPlacementPrompt,
  validateIdeaPlacementResult,
} from '@/planmerge/lib/ai/ideaPlacement';
import { classifyAnalysisFailure } from '@/planmerge/lib/ai/analysisFailureReason';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

// 초안 30개 × normalize 1회 + merge까지 한 요청 안에서 끝나야 한다. 플랫폼 기본
// 타임아웃(수십 초)에 걸리면 사용자는 원인을 알 수 없는 실패만 보게 되므로 명시한다.
// Vercel에서는 플랜 한도를 넘는 값을 쓰면 배포가 거절되니 플랜을 바꾸면 같이 조정한다.
export const maxDuration = 300;

// 요청 1건이 초안 수만큼의 모델 호출을 발생시키므로 보수적으로 제한한다.
const RATE_LIMIT = { limit: 5, windowMs: 60_000 };
// 초안 전부를 한꺼번에 던지면 업스트림 rate limit을 자초한다. 동시 실행을 묶어
// 429를 줄이고, 재시도 백오프가 실제로 회복할 여지를 남긴다.
//
// 지연은 토큰 양이 아니라 배치 수가 결정한다. 초안 13개를 6씩 돌리면 3배치이고,
// 각 배치는 그 안에서 가장 느린 호출을 기다린다. 업스트림 한도는 배포마다 다르므로
// 값을 환경변수로 빼 둔다.
// 실측(초안 13개, gpt-5.6-luna): 6 → 54초 / 13 → 47초, 양쪽 모두 429 없음.
// 13%만 줄어드는 이유는 merge 호출 1건이 병렬화되지 않는 하한이기 때문이다.
// normalize를 더 붙여도 그 아래로는 내려가지 않는다.
const DEFAULT_NORMALIZE_CONCURRENCY = 12;

function readNormalizeConcurrency() {
  const raw = Number(process.env.NORMALIZE_CONCURRENCY);

  if (Number.isSafeInteger(raw) && raw >= 1 && raw <= MAX_ANALYSIS_DRAFT_COUNT) {
    return raw;
  }

  return DEFAULT_NORMALIZE_CONCURRENCY;
}

const NORMALIZE_CONCURRENCY = readNormalizeConcurrency();
// merge 출력은 초안 수에 따라 커진다. 예산이 모자라면 응답이 incomplete로 잘려
// 전체 요청이 실패하므로, 아이디어 에코를 없앤 뒤에도 여유를 둔다.
const MERGE_MAX_OUTPUT_TOKENS = 32_000;

// 배치 판정은 누락된 아이디어 몇 개만 다루므로 merge보다 훨씬 작다.
const PLACEMENT_MAX_OUTPUT_TOKENS = 8_000;

// 문서 작성은 섹션 12개 산문이 나오므로 출력이 크다. 입력은 결정 요약뿐이다.
const COMPOSITION_MAX_OUTPUT_TOKENS = 16_000;

// 블록 단위 복구는 깨진 블록 몇 개만 다룬다. merge 전체를 다시 쓰는 것보다 훨씬 작다.
const BLOCK_REPAIR_MAX_OUTPUT_TOKENS = 12_000;


const normalizedIdeaTypes = new Set<NormalizedIdeaType>([
  'problem',
  'target_user',
  'feature',
  'scope',
  'requirement',
  'metric',
  'risk',
  'open_question',
  'flow',
  'solution',
]);

const normalizedIdeaIntents = new Set<NormalizedIdeaIntent>([
  'propose',
  'warn',
  'require',
  'assume',
  'question',
]);

// 규칙 기반 로컬 결과를 정상 응답으로 돌려주면 사용자는 모델이 의미를 비교한 결과와
// 키워드 매칭이 만들어낸 결과를 구분할 수 없다. 운영에서는 분석이 불가능하면 실패로
// 노출하고, 어느 단계에서 멈췄는지 code로 알린다.
function failureResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, errors: [message] }, { status });
}

/**
 * 정해진 동시 실행 수로 순회하고, 한 건이라도 실패하면 남은 호출을 중단한다.
 *
 * Promise.all은 첫 실패로 즉시 거절하지만 이미 떠 있는 요청은 그대로 완주한다.
 * 그 응답은 아무도 쓰지 않으면서 토큰만 쓰므로, 중단 신호로 끊는다.
 */
async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  task: (item: TItem, signal: AbortSignal) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  const controller = new AbortController();
  let nextIndex = 0;

  const worker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length || controller.signal.aborted) {
        return;
      }

      results[index] = await task(items[index], controller.signal);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );

  try {
    await Promise.all(workers);
  } catch (error) {
    controller.abort();
    // 중단된 작업들이 정리될 때까지 기다린 뒤 원래 오류를 올린다.
    await Promise.allSettled(workers);
    throw error;
  }

  return results;
}

/**
 * 토큰 사용량은 프로토콜 본문이 아니라 응답 헤더로 알린다.
 *
 * 사용자 키로 돌아가는 제품이라 "이번 분석이 얼마를 썼는지"는 보여줘야 하지만,
 * 그렇다고 분석 결과 스키마에 전송 메타데이터를 섞으면 프로토콜 버전을 올려야 한다.
 */
const USAGE_HEADER = 'x-planmerge-usage';

function usageHeaders(usage: ModelUsage) {
  return { [USAGE_HEADER]: JSON.stringify(usage) };
}

/**
 * 진행 단계. 화면이 "지금 무엇을 하고 있는가"를 보여주는 데 쓴다.
 *
 * 분석은 80~120초가 걸리고 그동안 사용자는 정적 문장 하나를 봤다. 호출이 5종류로
 * 나뉜 뒤로는 단계를 보여줄 수 있는데, 단일 요청 구조라 서버가 진행을 흘려보내야
 * 한다. 클라이언트가 `Accept: application/x-ndjson`을 보내면 한 줄에 이벤트 하나씩
 * 스트리밍하고, 아니면 예전처럼 JSON 한 덩어리를 준다 — 스크립트·스텁·curl은 바뀌지
 * 않는다.
 */
export type AnalysisStage = 'normalize' | 'merge' | 'placement' | 'compose' | 'repair';

export type AnalysisStageEvent = {
  stage: AnalysisStage;
  status: 'started' | 'done';
  /** normalize에서만: 끝난 초안 수 / 전체. */
  completed?: number;
  total?: number;
};

type StageListener = (event: AnalysisStageEvent) => void;

const NDJSON_MEDIA_TYPE = 'application/x-ndjson';

function wantsStream(request: Request) {
  return (request.headers.get('accept') ?? '').toLowerCase().includes(NDJSON_MEDIA_TYPE);
}

async function normalizeDrafts(
  payload: PlanMergeAnalysisPayload,
  config: GmsConfig,
  onUsage: (usage: ModelUsage) => void,
  onStage: StageListener,
) {
  const drafts = payload.drafts.filter((draft) => draft.rawText.trim());
  let completed = 0;

  onStage({ stage: 'normalize', status: 'started', completed: 0, total: drafts.length });

  const normalizeResults = await mapWithConcurrency(
    drafts,
    NORMALIZE_CONCURRENCY,
    async (draft, signal) => {
      const rawResult = await callGmsJson<DraftNormalizeResult>(
        buildDraftNormalizePrompt(payload.project, draft),
        { maxOutputTokens: 4000, signal, config, onUsage },
      );
      const result = normalizeDraftProtocolResult(draft, rawResult);
      const validation = validateDraftNormalizeResult(draft, result);

      if (!validation.valid) {
        throw new Error(`Normalize validation failed for ${draft.id}: ${validation.errors.join(', ')}`);
      }

      completed += 1;
      onStage({ stage: 'normalize', status: 'started', completed, total: drafts.length });

      return result.normalizedIdeas;
    },
  );

  onStage({ stage: 'normalize', status: 'done', completed: drafts.length, total: drafts.length });

  return normalizeResults.flat();
}

function normalizeDraftProtocolResult(
  draft: PlanMergeAnalysisPayload['drafts'][number],
  result: DraftNormalizeResult,
): DraftNormalizeResult {
  const ids = new Set<string>();

  return {
    protocolVersion: '0.4',
    source: result.source,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    normalizedIdeas: (Array.isArray(result.normalizedIdeas) ? result.normalizedIdeas : [])
      .map((idea, index) => {
        const fallbackId = `${draft.id}_idea_${index + 1}`;
        const rawId = typeof idea.id === 'string' && idea.id.trim()
          ? idea.id.trim()
          : fallbackId;
        const id = ids.has(rawId) ? fallbackId : rawId;

        ids.add(id);

        return {
          id,
          sourceDraftId: draft.id,
          sourceModel: draft.aiModel,
          sourceExcerpt: typeof idea.sourceExcerpt === 'string' && idea.sourceExcerpt.trim()
            ? idea.sourceExcerpt.trim()
            : draft.rawText.slice(0, 180),
          sectionKey: idea.sectionKey,
          topic: typeof idea.topic === 'string' && idea.topic.trim()
            ? idea.topic.trim()
            : draft.taskTitle,
          ideaType: normalizedIdeaTypes.has(idea.ideaType)
            ? idea.ideaType
            : inferIdeaTypeFromSection(idea.sectionKey),
          normalizedText: typeof idea.normalizedText === 'string' && idea.normalizedText.trim()
            ? idea.normalizedText.trim()
            : draft.rawText.slice(0, 240),
          forbiddenDirectionConflict: idea.forbiddenDirectionConflict,
          intent: normalizedIdeaIntents.has(idea.intent)
            ? idea.intent
            : inferIntentFromText(idea.normalizedText),
          confidence: typeof idea.confidence === 'number' && idea.confidence >= 0 && idea.confidence <= 1
            ? idea.confidence
            : 0.7,
        };
      }),
  };
}

function inferIdeaTypeFromSection(sectionKey: NormalizedIdea['sectionKey']): NormalizedIdeaType {
  if (sectionKey === 'problem') return 'problem';
  if (sectionKey === 'target_user') return 'target_user';
  if (sectionKey === 'core_features') return 'feature';
  if (sectionKey === 'mvp_scope') return 'scope';
  if (sectionKey === 'requirements') return 'requirement';
  if (sectionKey === 'success_metrics') return 'metric';
  if (sectionKey === 'risks') return 'risk';
  if (sectionKey === 'open_questions') return 'open_question';
  if (sectionKey === 'user_flow') return 'flow';
  if (sectionKey === 'solution') return 'solution';

  return 'requirement';
}

function inferIntentFromText(text: unknown): NormalizedIdeaIntent {
  const content = typeof text === 'string' ? text : '';

  if (/risk|위험|리스크|우려|문제|주의/.test(content)) {
    return 'warn';
  }

  if (/must|필수|해야|필요|요구/.test(content)) {
    return 'require';
  }

  if (content.includes('?') || /질문|미정|검토/.test(content)) {
    return 'question';
  }

  if (/가정|예상|assume/.test(content)) {
    return 'assume';
  }

  return 'propose';
}

// merge 모델은 아이디어를 돌려주지 않는다. 서버가 정규화 단계에서 검증한 배열을 붙인다.
// 모델이 굳이 배열을 돌려줬다면 그 값은 버리고 그 사실을 경고로 남긴다.
function ensureMergeUsesCanonicalIdeas(
  result: PlanMergeAnalysisResult,
  normalizedIdeas: NormalizedIdea[],
): PlanMergeAnalysisResult {
  const returnedIdeas = result.normalizedIdeas;
  const modelEchoedIdeas = Array.isArray(returnedIdeas)
    && JSON.stringify(returnedIdeas) !== JSON.stringify(normalizedIdeas);

  return {
    ...result,
    normalizedIdeas,
    warnings: [
      ...(Array.isArray(result.warnings) ? result.warnings : []),
      ...(modelEchoedIdeas
        ? ['merge 응답이 돌려준 normalizedIdeas는 버리고 서버에서 검증한 아이디어로 고정했습니다.']
        : []),
    ],
  };
}

function ensureCanonicalMissingSections(result: PlanMergeAnalysisResult): PlanMergeAnalysisResult {
  const finalSectionKeys = new Set(result.finalDocumentSections.map((section) => section.sectionKey));
  const missingSections = documentSectionDefinitions
    .map((section) => section.key)
    .filter((sectionKey) => !finalSectionKeys.has(sectionKey));
  const sameMissingSections =
    result.missingSections.length === missingSections.length &&
    missingSections.every((sectionKey) => result.missingSections.includes(sectionKey));

  if (sameMissingSections) {
    return result;
  }

  return {
    ...result,
    missingSections,
    warnings: [
      ...result.warnings,
      '응답의 missingSections는 서버에서 최종 문서 섹션 기준으로 보정했습니다.',
    ],
  };
}

// postProcess의 ensure* 보정은 배열 순회를 전제한다. 골격이 깨진 응답을 그대로 넣으면
// 검증·repair 재시도 전에 TypeError로 폴백해 버리므로, 보정 가능한 형태인지 먼저 가른다.
/**
 * 보정 체인이 쓸 수 있는 형태로 정리하고, 정리할 수 없으면 undefined를 준다.
 *
 * 고칠 수 있는 것과 없는 것을 구분한다.
 *
 * - `decisionBlocks`가 없거나 `options`가 배열이 아니면 되돌릴 근거가 없다 → 포기.
 * - `finalDocumentSections`/`missingSections`/`warnings`는 체인이 결정 블록에서
 *   다시 세울 수 있다(`ensureFinalDocumentCoverage`, `ensureCanonicalMissingSections`)
 *   → 잘못된 항목만 버리고 계속한다.
 *
 * 예전에는 섹션 하나가 객체가 아니면 postProcess가 통째로 빠졌다. 그러면 canonical
 * 아이디어조차 붙지 않아서, "섹션 형태가 틀렸다" 한 줄짜리 문제가 출처 오류 수십 개로
 * 보고되고 repair가 엉뚱한 곳을 고치러 갔다. 실제로 한 번 그렇게 502가 났다.
 */
function coerceMergeResultShape(result: unknown): PlanMergeAnalysisResult | undefined {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return undefined;
  }

  const record = result as Record<string, unknown>;

  if (!Array.isArray(record.decisionBlocks)) {
    return undefined;
  }

  // 옵션 배열이 없는 블록은 서버가 되돌릴 근거가 없다. 하지만 그 블록 하나 때문에 전체를
  // 포기하면 canonical 아이디어도 붙지 않고 봉투도 안 찍혀서, 검증기가 모델 원본을 보고
  // 오류 50개를 쏟아낸다. 그러면 오류가 블록 범위로 좁혀지지 않아 전체 복구로 내려가고,
  // 전체 복구는 문서를 재구성한다. 실측에서 이게 과잉 병합(Coherence 33%)의 원인이었다.
  //
  // 대신 그 블록만 버린다. 버려진 블록이 인용하던 아이디어는 "배치되지 않음"이 되어
  // 배치 판정 호출이 어디에 둘지 모델에 되묻는다 — 이미 있는 이음새다.
  const blocks = record.decisionBlocks.filter((block) => (
    typeof block === 'object'
    && block !== null
    && Array.isArray((block as Record<string, unknown>).options)
  ));
  const droppedBlocks = record.decisionBlocks.length - blocks.length;

  const sections = Array.isArray(record.finalDocumentSections)
    ? record.finalDocumentSections.filter((section) => typeof section === 'object' && section !== null)
    : [];
  const droppedSections = Array.isArray(record.finalDocumentSections)
    ? record.finalDocumentSections.length - sections.length
    : 0;
  const warnings = (Array.isArray(record.warnings) ? record.warnings : [])
    .filter((warning): warning is string => typeof warning === 'string');

  const notes = [...warnings];

  if (droppedSections) {
    notes.push(`형태가 맞지 않는 최종 문서 섹션 ${droppedSections}개를 버리고 결정 블록에서 다시 세웠습니다.`);
  }

  if (droppedBlocks) {
    notes.push(`옵션 목록이 없는 결정 ${droppedBlocks}개를 버렸습니다. 그 아이디어들은 배치 판정으로 다시 배치합니다.`);
  }

  return {
    ...(record as unknown as PlanMergeAnalysisResult),
    decisionBlocks: blocks as PlanMergeAnalysisResult['decisionBlocks'],
    finalDocumentSections: sections as PlanMergeAnalysisResult['finalDocumentSections'],
    missingSections: (Array.isArray(record.missingSections)
      ? record.missingSections
      : []) as PlanMergeAnalysisResult['missingSections'],
    warnings: notes,
  };
}

/**
 * merge 결과를 그대로 내보낼 수 없게 만드는 사유를 모은다.
 *
 * 스키마 위반만 보면 안 된다. 배치를 서버가 룰로 대신한 결과는 **스키마상
 * 완벽했다** — 출처도 붙어 있고 선택안도 하나씩 있어서 검증기가 통과시켰고,
 * 충돌 0인 문서가 정상 응답으로 나갔다. 그래서 배치 실패를 같은 자리에서 본다.
 */
function collectMergeBlockers(
  payload: PlanMergeAnalysisPayload,
  merge: BuiltMergeResult,
): string[] {
  return [...merge.blockers, ...validatePlanMergeAnalysis(payload, merge.result).errors];
}

type BuiltMergeResult = {
  result: PlanMergeAnalysisResult;
  /** 그대로 내보낼 수 없게 만드는 사유. 있으면 repair, 그래도 안 되면 502. */
  blockers: string[];
};

/**
 * 모델이 되돌릴 수 있는 형태로 정리한다. 여기까지는 모델 호출이 없다.
 *
 * 남는 `unplacedIdeas`는 어떤 옵션도 인용하지 않은 아이디어다. 서버는 이걸
 * 배치하지 않는다 — 배치는 "어느 결정에 속하는가"와 "채택안인가"를 정하는
 * 판단이라 룰로 할 수 없다(과거 실측: topic 문자열 일치 0/67, 전부 서버가
 * 블록을 만들어 충돌 0인 문서가 됐다).
 */
function repairMergeShape(
  result: PlanMergeAnalysisResult,
  normalizedIdeas: NormalizedIdea[],
  source: PlanMergeAnalysisResult['source'],
): { result: PlanMergeAnalysisResult; unplacedIdeas: NormalizedIdea[] } | undefined {
  const coerced = coerceMergeResultShape(result);

  if (!coerced) {
    return undefined;
  }

  // 봉투는 서버가 찍는다. 모델이 생략하거나 다른 값을 보내도 검증이 여기서 떨어지지 않는다.
  const canonical = ensureMergeUsesCanonicalIdeas(
    ensureServerOwnedEnvelope(coerced, source),
    normalizedIdeas,
  );
  const cited = ensureOptionsCiteKnownIdeas(canonical, normalizedIdeas);
  const shaped = ensureDecisionBlockShape(cited);
  const owned = ensureServerOwnedSelectionSource(shaped);
  const citedIdeaIds = new Set(
    owned.decisionBlocks.flatMap((block) => block.options.flatMap((option) => option.sourceIdeaIds)),
  );

  return {
    result: owned,
    unplacedIdeas: owned.normalizedIdeas.filter((idea) => !citedIdeaIds.has(idea.id)),
  };
}

/** 파생값과 canonical 복원만 남은 마무리. 문서 본문은 여기서 만들지 않는다. */
function finalizeMergeResult(result: PlanMergeAnalysisResult): PlanMergeAnalysisResult {
  return ensureCanonicalMissingSections(
    ensureAssumptionBackedBlocksAreReviewed(result),
  );
}

/**
 * merge 응답을 내보낼 수 있는 결과로 만든다. 누락된 아이디어가 있으면
 * **모델에 배치 판정을 묻는다.**
 *
 * 세 갈래다.
 * - 누락 없음 → 호출 없이 마무리.
 * - 누락이 `PLACEMENT_RECOVERABLE_IDEA_LIMIT`를 넘음 → merge 자체가 실패한
 *   것이므로 배치 판정으로 메우지 않고 blocker로 올려 repair로 보낸다.
 * - 그 아래 → 배치 판정 호출 1건(입력이 작다: 블록 요약 + 누락 아이디어만).
 *   검증이 실패하면 서버가 대신 배치하지 않고 blocker로 올린다.
 */
async function buildMergeResult(
  payload: PlanMergeAnalysisPayload,
  raw: PlanMergeAnalysisResult,
  normalizedIdeas: NormalizedIdea[],
  options: { config: GmsConfig; onUsage: (usage: ModelUsage) => void; onStage: StageListener },
): Promise<BuiltMergeResult> {
  const shaped = repairMergeShape(raw, normalizedIdeas, options.config.provider);

  if (!shaped) {
    return { result: raw, blockers: [] };
  }

  let current = shaped.result;

  if (shaped.unplacedIdeas.length) {
    if (exceedsPlacementRecoveryLimit(shaped.unplacedIdeas.length, normalizedIdeas.length)) {
      return {
        result: finalizeMergeResult(current),
        blockers: [
          `merge 응답이 ${normalizedIdeas.length}개 아이디어 중 ${shaped.unplacedIdeas.length}개를 어떤 옵션의 sourceIdeaIds에도 인용하지 않았습니다. `
          + '모든 아이디어를 인용하고, 같은 주제를 말하는 아이디어들은 하나의 Decision Block 안에 서로 다른 옵션으로 묶으십시오.',
        ],
      };
    }

    options.onStage({ stage: 'placement', status: 'started' });

    const placementRaw = await callGmsJson<unknown>(
      buildIdeaPlacementPrompt(payload, current.decisionBlocks, shaped.unplacedIdeas),
      {
        maxOutputTokens: PLACEMENT_MAX_OUTPUT_TOKENS,
        config: options.config,
        onUsage: options.onUsage,
      },
    );
    const placement = validateIdeaPlacementResult(
      placementRaw,
      current.decisionBlocks,
      shaped.unplacedIdeas,
    );

    // 검증이 실패하면 서버가 대신 배치하지 않는다. 문서 작성 호출도 내지 않고
    // repair로 보낸다 — 결정이 확정되지 않았는데 문서를 쓸 이유가 없다.
    if (!placement.valid) {
      return {
        result: finalizeMergeResult(current),
        blockers: [
          `배치 판정이 검증을 통과하지 못했습니다(${shaped.unplacedIdeas.length}개 아이디어 미배치): ${placement.errors.slice(0, 3).join(', ')}`,
        ],
      };
    }

    current = applyIdeaPlacements(current, placement.result, shaped.unplacedIdeas);
    options.onStage({ stage: 'placement', status: 'done' });
  }

  if (!current.decisionBlocks.length) {
    return { result: finalizeMergeResult(current), blockers: [] };
  }

  return composeDocument(payload, current, options);
}

/**
 * 확정된 결정으로 문서를 쓴다.
 *
 * 블록이 바뀌면 본문도 다시 써야 하므로(본문은 이전 선택안을 보고 쓰였다) 블록 단위
 * 복구 뒤에도 이 함수를 다시 부른다.
 */
async function composeDocument(
  payload: PlanMergeAnalysisPayload,
  result: PlanMergeAnalysisResult,
  options: { config: GmsConfig; onUsage: (usage: ModelUsage) => void; onStage: StageListener },
): Promise<BuiltMergeResult> {
  options.onStage({ stage: 'compose', status: 'started' });

  const compositionRaw = await callGmsJson<unknown>(
    buildDocumentCompositionPrompt(payload, result.decisionBlocks),
    {
      maxOutputTokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      config: options.config,
      onUsage: options.onUsage,
    },
  );
  const composition = validateDocumentCompositionResult(
    compositionRaw,
    result.decisionBlocks,
    result.normalizedIdeas,
    payload,
  );

  if (!composition.valid) {
    return {
      result: finalizeMergeResult(result),
      blockers: [
        `문서 작성이 검증을 통과하지 못했습니다: ${composition.errors.slice(0, 3).join(', ')}`,
      ],
    };
  }

  options.onStage({ stage: 'compose', status: 'done' });

  return {
    result: finalizeMergeResult(applyDocumentComposition(result, composition.sections)),
    blockers: [],
  };
}

/**
 * 깨진 결정 블록만 다시 받아 제자리에 끼운다.
 *
 * 성공하면 문서를 다시 쓴 결과, 고칠 수 없으면 undefined를 준다. undefined면 호출자가
 * 전체 복구로 내려간다.
 */
async function repairDecisionBlocks(
  payload: PlanMergeAnalysisPayload,
  result: PlanMergeAnalysisResult,
  blockIndexes: number[],
  errors: string[],
  normalizedIdeas: NormalizedIdea[],
  options: { config: GmsConfig; onUsage: (usage: ModelUsage) => void; onStage: StageListener },
): Promise<BuiltMergeResult | undefined> {
  const requests = blockIndexes
    .filter((index) => result.decisionBlocks[index] !== undefined)
    .map((index) => ({
      repairIndex: index,
      block: result.decisionBlocks[index],
      errors: errors.filter((error) => error.startsWith(`decisionBlocks[${index}]`)),
    }));

  if (!requests.length) {
    return undefined;
  }

  options.onStage({ stage: 'repair', status: 'started' });

  const raw = await callGmsJson<unknown>(
    buildDecisionBlockRepairPrompt(payload, requests, normalizedIdeas),
    {
      maxOutputTokens: BLOCK_REPAIR_MAX_OUTPUT_TOKENS,
      config: options.config,
      onUsage: options.onUsage,
    },
  );
  const repaired = validateRepairedDecisionBlocks(raw, requests.map((request) => request.repairIndex));

  if (!repaired.valid) {
    console.error('[analyze/planmerge] block repair scope validation failed:', repaired.errors);

    return undefined;
  }

  // 서버가 소유하는 필드는 모델이 무엇을 보냈든 다시 찍는다.
  const spliced = ensureServerOwnedSelectionSource(
    ensureServerOwnedEnvelope(
      applyRepairedDecisionBlocks(result, repaired.blocksByIndex),
      options.config.provider,
    ),
  );

  // 블록이 바뀌었으므로 본문을 다시 쓴다 — 이전 선택안을 보고 쓴 문서를 그대로 두지 않는다.
  return composeDocument(payload, spliced, options);
}

export async function POST(request: Request) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'analyze-planmerge',
    getClientKey(request, session?.user?.id),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['분석 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: ['request body must be valid JSON'] },
      { status: 400 },
    );
  }

  const parsedPayload = parsePlanMergeAnalysisPayload(body);

  if (!parsedPayload.valid) {
    return NextResponse.json(
      { errors: parsedPayload.errors },
      { status: 400 },
    );
  }

  const { payload } = parsedPayload;

  if (!payload.drafts.length) {
    return failureResponse(400, 'no_drafts', '분석할 초안이 없습니다. 초안을 하나 이상 입력해 주세요.');
  }

  const config = getAnalysisConfig(request);

  if (!config.apiKey) {
    return failureResponse(
      503,
      'analysis_provider_unconfigured',
      'AI 분석에 사용할 API 키가 없습니다. 화면에서 키를 등록하거나 서버에 OPENAI_API_KEY를 설정해 주세요.',
    );
  }

  const failureMessage = `${config.model} 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.`;

  if (!wantsStream(request)) {
    let usage = emptyModelUsage();

    try {
      const result = await runAnalysisPipeline(payload, config, {
        onUsage: (next) => { usage = addModelUsage(usage, next); },
        onStage: () => {},
      });

      return NextResponse.json(result, { headers: usageHeaders(usage) });
    } catch (error) {
      // 업스트림 오류 본문에는 게이트웨이 내부 정보가 섞일 수 있어 서버 로그에만 남긴다.
      console.error('[analyze/planmerge] analysis failed:', error);

      return NextResponse.json(
        { code: 'analysis_failed', reason: classifyAnalysisFailure(error), errors: [failureMessage] },
        { status: 502 },
      );
    }
  }

  // NDJSON: 진행 이벤트 → result 또는 error. 스트림이 시작되면 상태 코드를 바꿀 수 없으므로
  // 실패도 본문 이벤트로 알리고, 사용량은 마지막 result 이벤트에 싣는다(헤더는 이미 나갔다).
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      let usage = emptyModelUsage();

      try {
        const result = await runAnalysisPipeline(payload, config, {
          onUsage: (next) => { usage = addModelUsage(usage, next); },
          onStage: (event) => send({ type: 'progress', ...event }),
        });

        send({ type: 'result', result, usage });
      } catch (error) {
        console.error('[analyze/planmerge] analysis failed:', error);
        send({
          type: 'error',
          status: 502,
          code: 'analysis_failed',
          reason: classifyAnalysisFailure(error),
          errors: [failureMessage],
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': `${NDJSON_MEDIA_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * 정규화 → 병합 → (배치) → 문서 작성 → 검증 → (복구). 성공하면 결과, 실패하면 throw.
 * JSON 응답과 NDJSON 스트림이 같은 함수를 부르므로 두 경로가 갈라질 수 없다.
 */
async function runAnalysisPipeline(
  payload: PlanMergeAnalysisPayload,
  config: GmsConfig,
  hooks: { onUsage: (usage: ModelUsage) => void; onStage: StageListener },
): Promise<PlanMergeAnalysisResult> {
  const normalizedIdeas = await normalizeDrafts(payload, config, hooks.onUsage, hooks.onStage);

  hooks.onStage({ stage: 'merge', status: 'started' });
  const mergeResultRaw = await callGmsJson<PlanMergeAnalysisResult>(
    buildMergeNormalizedIdeasPrompt(payload, normalizedIdeas),
    { maxOutputTokens: MERGE_MAX_OUTPUT_TOKENS, config, onUsage: hooks.onUsage },
  );
  hooks.onStage({ stage: 'merge', status: 'done' });

  const merge = await buildMergeResult(payload, mergeResultRaw, normalizedIdeas, {
    config,
    onUsage: hooks.onUsage,
    onStage: hooks.onStage,
  });
  const mergeErrors = collectMergeBlockers(payload, merge);

  if (!mergeErrors.length) {
    return { ...merge.result, source: config.provider } satisfies PlanMergeAnalysisResult;
  }

  // 어떤 오류로 복구에 들어갔는지는 운영에서 알아야 한다. 전부 이 리포가 만든 문구이고,
  // 이 로그가 없었을 때 "블록 단위 복구가 왜 안 걸리는지"를 추측으로 메울 수밖에 없었다.
  console.warn('[analyze/planmerge] merge blockers:', JSON.stringify(mergeErrors));

  // 오류가 전부 블록 하나로 좁혀지면 그 블록만 다시 받는다. 결과 전체를 다시 쓰게 하면
  // 모델이 구조를 새로 짜고, 실측에서 그 경로가 여러 섹션을 한 블록으로 접었다.
  const scope = partitionBlockerScope(mergeErrors);

  if (scope.blockIndexes.length && !scope.others.length) {
    const blockRepaired = await repairDecisionBlocks(
      payload,
      merge.result,
      scope.blockIndexes,
      mergeErrors,
      normalizedIdeas,
      { config, onUsage: hooks.onUsage, onStage: hooks.onStage },
    );

    if (blockRepaired) {
      const blockRepairErrors = collectMergeBlockers(payload, blockRepaired);

      if (!blockRepairErrors.length) {
        hooks.onStage({ stage: 'repair', status: 'done' });

        return {
          ...blockRepaired.result,
          source: config.provider,
          warnings: [
            ...blockRepaired.result.warnings,
            `검증에 실패한 결정 ${scope.blockIndexes.length}개를 블록 단위로 복구했습니다.`,
          ],
        } satisfies PlanMergeAnalysisResult;
      }

      // 좁은 복구로도 안 되면 전체 복구로 내려가지 않는다. 호출을 더 쓰면서 구조를
      // 뭉갤 위험만 사는 셈이다.
      throw new Error(`Block repair validation failed: ${blockRepairErrors.join(', ')}`);
    }
  }

  hooks.onStage({ stage: 'repair', status: 'started' });
  const repairedResultRaw = await callGmsJson<PlanMergeAnalysisResult>(
    buildPlanMergeRepairPrompt(payload, merge.result, mergeErrors, normalizedIdeas),
    { maxOutputTokens: MERGE_MAX_OUTPUT_TOKENS, config, onUsage: hooks.onUsage },
  );
  const repaired = await buildMergeResult(payload, repairedResultRaw, normalizedIdeas, {
    config,
    onUsage: hooks.onUsage,
    onStage: hooks.onStage,
  });
  const repairErrors = collectMergeBlockers(payload, repaired);

  if (repairErrors.length) {
    throw new Error(`Repair validation failed: ${repairErrors.join(', ')}`);
  }

  hooks.onStage({ stage: 'repair', status: 'done' });

  return {
    ...repaired.result,
    source: config.provider,
    warnings: [
      ...repaired.result.warnings,
      '1차 merge 검증 실패 후 repair prompt로 복구했습니다.',
    ],
  } satisfies PlanMergeAnalysisResult;
}
