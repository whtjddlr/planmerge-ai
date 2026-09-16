import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  buildDraftNormalizePrompt,
  MAX_ANALYSIS_DRAFT_COUNT,
  buildMergeNormalizedIdeasPrompt,
  buildPlanMergeRepairPrompt,
  conflictsWithForbiddenDirection,
  documentSectionDefinitions,
  parsePlanMergeAnalysisPayload,
  ensureAssumptionBackedBlocksAreReviewed,
  ensureServerOwnedSelectionSource,
  validateDraftNormalizeResult,
  validatePlanMergeAnalysis,
} from '@/planmerge/lib/ai/planmergeProtocol';
import type {
  DocumentSectionKey,
  DraftNormalizeResult,
  NormalizedIdea,
  NormalizedIdeaIntent,
  NormalizedIdeaType,
  PlanMergeAnalysisPayload,
  PlanMergeAnalysisResult,
  ProtocolDecisionBlock,
  ProtocolDecisionOption,
  ProtocolFinalDocumentSection,
} from '@/planmerge/lib/ai/planmergeProtocol';
import {
  addModelUsage,
  callGmsJson,
  emptyModelUsage,
  getAnalysisConfig,
} from '@/planmerge/lib/ai/gmsServer';
import type { GmsConfig, ModelUsage } from '@/planmerge/lib/ai/gmsServer';
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

async function normalizeDrafts(
  payload: PlanMergeAnalysisPayload,
  config: GmsConfig,
  onUsage: (usage: ModelUsage) => void,
) {
  const drafts = payload.drafts.filter((draft) => draft.rawText.trim());

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

      return result.normalizedIdeas;
    },
  );

  return normalizeResults.flat();
}

function normalizeDraftProtocolResult(
  draft: PlanMergeAnalysisPayload['drafts'][number],
  result: DraftNormalizeResult,
): DraftNormalizeResult {
  const ids = new Set<string>();

  return {
    protocolVersion: '0.3',
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
function hasMergeResultShape(result: unknown): result is PlanMergeAnalysisResult {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return false;
  }

  const record = result as Record<string, unknown>;

  return (
    // normalizedIdeas는 모델이 돌려주지 않는다. 서버가 검증된 아이디어를 붙인다.
    Array.isArray(record.finalDocumentSections) &&
    Array.isArray(record.missingSections) &&
    Array.isArray(record.warnings) &&
    Array.isArray(record.decisionBlocks) &&
    record.decisionBlocks.every((block) =>
      typeof block === 'object' &&
      block !== null &&
      Array.isArray((block as Record<string, unknown>).options),
    ) &&
    record.finalDocumentSections.every((section) => typeof section === 'object' && section !== null)
  );
}

function postProcessMergeResult(
  payload: PlanMergeAnalysisPayload,
  result: PlanMergeAnalysisResult,
  normalizedIdeas: NormalizedIdea[],
) {
  if (!hasMergeResultShape(result)) {
    return result;
  }

  return ensureCanonicalMissingSections(
    ensureAssumptionBackedBlocksAreReviewed(
      ensureFinalDocumentCoverage(
        ensureDecisionBlockCoverage(
          payload,
          ensureServerOwnedSelectionSource(
          ensureMergeUsesCanonicalIdeas(result, normalizedIdeas),
        ),
        ),
      ),
    ),
  );
}

function ensureDecisionBlockCoverage(
  payload: PlanMergeAnalysisPayload,
  result: PlanMergeAnalysisResult,
): PlanMergeAnalysisResult {
  const citedIdeaIds = new Set(
    result.decisionBlocks.flatMap((block) =>
      block.options.flatMap((option) => option.sourceIdeaIds),
    ),
  );
  const uncoveredIdeas = result.normalizedIdeas.filter((idea) => !citedIdeaIds.has(idea.id));

  if (!uncoveredIdeas.length) {
    return result;
  }

  const existingBlockIds = new Set(result.decisionBlocks.map((block) => block.id));
  const existingOptionIds = new Set(result.decisionBlocks.flatMap((block) => block.options.map((option) => option.id)));
  const nextDecisionBlocks = result.decisionBlocks.map((block) => ({
    ...block,
    options: [...block.options],
  }));
  const ideasForNewBlocks: NormalizedIdea[] = [];
  let attachedOptionCount = 0;

  uncoveredIdeas.forEach((idea) => {
    const targetBlock = nextDecisionBlocks.find((block) =>
      block.sectionKey === idea.sectionKey &&
      normalizeTopic(block.topic) === normalizeTopic(idea.topic),
    );

    if (!targetBlock) {
      ideasForNewBlocks.push(idea);
      return;
    }

    const selectedOption = targetBlock.options.find((option) => option.id === targetBlock.selectedOptionId);
    const isConflict = conflictsWithForbiddenDirection(idea);
    const optionType: ProtocolDecisionOption['optionType'] = isConflict ? 'conflict' : 'alternative';

    targetBlock.options.push({
      id: uniqueId(`server_option_${safeId(idea.id)}`, existingOptionIds),
      optionType,
      content: idea.normalizedText,
      differenceFromSelected: selectedOption
        ? `${selectedOption.content}와 기준 적용 방향이 다릅니다.`
        : '기존 선택안과 다른 방향의 의견입니다.',
      severity: isConflict ? 'high' : undefined,
      sourceIdeaIds: [idea.id],
    });
    targetBlock.conflictLevel = inferConflictLevelFromOptions(targetBlock.options);
    targetBlock.needsHumanReview = targetBlock.needsHumanReview || isConflict || idea.confidence < 0.65;
    targetBlock.confidence = Math.min(targetBlock.confidence, Math.max(0.58, idea.confidence));
    attachedOptionCount += 1;
  });

  const ideasBySectionTopic = new Map<string, NormalizedIdea[]>();

  ideasForNewBlocks.forEach((idea) => {
    const key = `${idea.sectionKey}::${normalizeTopic(idea.topic)}`;

    ideasBySectionTopic.set(key, [...(ideasBySectionTopic.get(key) ?? []), idea]);
  });

  const addedBlocks = Array.from(ideasBySectionTopic.values()).map((ideas, index) =>
    createServerDecisionBlock(payload, ideas, index, existingBlockIds, existingOptionIds),
  );
  const warnings = [
    ...result.warnings,
    `merge 응답이 반영하지 않은 ${uncoveredIdeas.length}개 아이디어를 서버에서 Decision Block에 보강했습니다.`,
  ];

  if (attachedOptionCount > 0) {
    warnings.push(`${attachedOptionCount}개 아이디어는 기존 Decision Block의 대안/충돌 선택지로 연결했습니다.`);
  }

  if (addedBlocks.length > 0) {
    warnings.push(`${addedBlocks.length}개 Decision Block은 서버가 검증된 출처 아이디어 기준으로 생성했습니다.`);
  }

  return {
    ...result,
    decisionBlocks: [...nextDecisionBlocks, ...addedBlocks],
    warnings,
  };
}

function createServerDecisionBlock(
  payload: PlanMergeAnalysisPayload,
  ideas: NormalizedIdea[],
  index: number,
  existingBlockIds: Set<string>,
  existingOptionIds: Set<string>,
): ProtocolDecisionBlock {
  const selectedIdea = chooseServerSelectedIdea(ideas);
  const options = ideas.map((idea) => {
    const isSelected = idea.id === selectedIdea.id;
    const isConflict = !isSelected && conflictsWithForbiddenDirection(idea);

    return {
      id: uniqueId(`server_option_${safeId(idea.id)}`, existingOptionIds),
      optionType: isSelected ? 'selected' : isConflict ? 'conflict' : 'alternative',
      content: idea.normalizedText,
      differenceFromSelected: isSelected
        ? undefined
        : `${selectedIdea.normalizedText}와 기준 적용 방향이 다릅니다.`,
      severity: isConflict ? 'high' : undefined,
      sourceIdeaIds: [idea.id],
    } satisfies ProtocolDecisionOption;
  });
  const conflictLevel = inferConflictLevelFromOptions(options);

  return {
    id: uniqueId(`server_decision_${safeId(ideas[0]?.sectionKey ?? 'section')}_${index + 1}`, existingBlockIds),
    sectionKey: selectedIdea.sectionKey,
    topic: selectedIdea.topic,
    selectedOptionId: options.find((option) => option.optionType === 'selected')?.id ?? options[0].id,
    selectionReason: 'merge 응답이 이 아이디어를 Decision Block에 반영하지 않아, 서버가 검증된 출처 아이디어를 기준으로 보강했습니다.',
    // 서버가 만든 블록이므로 출처도 서버가 기록한다.
    selectionSource: 'merge',
    confidence: Math.min(Math.max(selectedIdea.confidence, 0.58), 0.82),
    conflictLevel,
    needsHumanReview: conflictLevel !== 'none' || selectedIdea.confidence < 0.65,
    options,
  };
}

function ensureFinalDocumentCoverage(result: PlanMergeAnalysisResult): PlanMergeAnalysisResult {
  const finalSectionKeys = new Set(result.finalDocumentSections.map((section) => section.sectionKey));
  const blocksBySection = new Map<DocumentSectionKey, ProtocolDecisionBlock[]>();

  result.decisionBlocks.forEach((block) => {
    blocksBySection.set(block.sectionKey, [...(blocksBySection.get(block.sectionKey) ?? []), block]);
  });

  const addedSections: ProtocolFinalDocumentSection[] = [];

  blocksBySection.forEach((blocks, sectionKey) => {
    if (finalSectionKeys.has(sectionKey)) {
      return;
    }

    const selectedContents = blocks
      .map((block) => block.options.find((option) => option.id === block.selectedOptionId)?.content)
      .filter((content): content is string => Boolean(content?.trim()));

    if (!selectedContents.length) {
      return;
    }

    addedSections.push({
      sectionKey,
      title: sectionTitle(sectionKey),
      content: selectedContents.join('\n\n'),
      sourceDecisionBlockIds: blocks.map((block) => block.id),
    });
  });

  if (!addedSections.length) {
    return result;
  }

  return {
    ...result,
    finalDocumentSections: [...result.finalDocumentSections, ...addedSections],
    warnings: [
      ...result.warnings,
      `${addedSections.length}개 최종 문서 섹션은 서버가 Decision Block 선택안을 기준으로 보강했습니다.`,
    ],
  };
}

function chooseServerSelectedIdea(ideas: NormalizedIdea[]) {
  return ideas.find((idea) => !conflictsWithForbiddenDirection(idea)) ?? ideas[0];
}

function inferConflictLevelFromOptions(options: ProtocolDecisionOption[]): ProtocolDecisionBlock['conflictLevel'] {
  const conflictSeverities = options
    .filter((option) => option.optionType === 'conflict')
    .map((option) => option.severity);

  if (conflictSeverities.includes('high')) return 'high';
  if (conflictSeverities.includes('medium')) return 'medium';
  if (conflictSeverities.includes('low')) return 'low';
  return 'none';
}

function normalizeTopic(topic: string) {
  return topic.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sectionTitle(sectionKey: DocumentSectionKey) {
  return documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? sectionKey;
}

function safeId(input: string) {
  return input.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'item';
}

function uniqueId(prefix: string, existingIds: Set<string>) {
  let candidate = prefix;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${prefix}_${suffix}`;
    suffix += 1;
  }

  existingIds.add(candidate);

  return candidate;
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

  let usage = emptyModelUsage();
  const collectUsage = (next: ModelUsage) => {
    usage = addModelUsage(usage, next);
  };

  try {
    const normalizedIdeas = await normalizeDrafts(payload, config, collectUsage);
    const mergePrompt = buildMergeNormalizedIdeasPrompt(payload, normalizedIdeas);
    const mergeResultRaw = await callGmsJson<PlanMergeAnalysisResult>(
      mergePrompt,
      { maxOutputTokens: MERGE_MAX_OUTPUT_TOKENS, config, onUsage: collectUsage },
    );
    const mergeResult = postProcessMergeResult(payload, mergeResultRaw, normalizedIdeas);
    const validation = validatePlanMergeAnalysis(payload, mergeResult);

    if (validation.valid) {
      return NextResponse.json(
        {
          ...mergeResult,
          source: config.provider,
        } satisfies PlanMergeAnalysisResult,
        { headers: usageHeaders(usage) },
      );
    }

    const repairedResultRaw = await callGmsJson<PlanMergeAnalysisResult>(
      buildPlanMergeRepairPrompt(payload, mergeResult, validation.errors, normalizedIdeas),
      { maxOutputTokens: MERGE_MAX_OUTPUT_TOKENS, config, onUsage: collectUsage },
    );
    const repairedResult = postProcessMergeResult(payload, repairedResultRaw, normalizedIdeas);
    const repairValidation = validatePlanMergeAnalysis(payload, repairedResult);

    if (!repairValidation.valid) {
      throw new Error(`Repair validation failed: ${repairValidation.errors.join(', ')}`);
    }

    return NextResponse.json(
      {
        ...repairedResult,
        source: config.provider,
        warnings: [
          ...repairedResult.warnings,
          '1차 merge 검증 실패 후 repair prompt로 복구했습니다.',
        ],
      } satisfies PlanMergeAnalysisResult,
      { headers: usageHeaders(usage) },
    );
  } catch (error) {
    // 업스트림 오류 본문에는 게이트웨이 내부 정보가 섞일 수 있어 서버 로그에만 남긴다.
    console.error('[analyze/planmerge] analysis failed:', error);

    return failureResponse(
      502,
      'analysis_failed',
      `${config.model} 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.`,
    );
  }
}
