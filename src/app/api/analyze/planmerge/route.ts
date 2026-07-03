import { NextResponse } from 'next/server';
import {
  buildDraftNormalizePrompt,
  buildMergeNormalizedIdeasPrompt,
  buildPlanMergeRepairPrompt,
  documentSectionDefinitions,
  parsePlanMergeAnalysisPayload,
  runLocalPlanMergeHarness,
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
import { callGmsJson, getGmsConfig } from '@/planmerge/lib/ai/gmsServer';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

// 요청 1건이 초안 수만큼의 GMS 호출을 발생시키므로 보수적으로 제한한다.
const RATE_LIMIT = { limit: 5, windowMs: 60_000 };

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

function buildFallback(payload: PlanMergeAnalysisPayload, warning: string): PlanMergeAnalysisResult {
  const fallback = runLocalPlanMergeHarness(payload);

  return {
    ...fallback,
    warnings: [warning, ...fallback.warnings],
  };
}

async function normalizeDrafts(payload: PlanMergeAnalysisPayload) {
  const normalizeResults = await Promise.all(
    payload.drafts
      .filter((draft) => draft.rawText.trim())
      .map(async (draft) => {
        const rawResult = await callGmsJson<DraftNormalizeResult>(
          buildDraftNormalizePrompt(payload.project, draft),
          { maxOutputTokens: 4000 },
        );
        const result = normalizeDraftProtocolResult(draft, rawResult);
        const validation = validateDraftNormalizeResult(draft, result);

        if (!validation.valid) {
          throw new Error(`Normalize validation failed for ${draft.id}: ${validation.errors.join(', ')}`);
        }

        return result.normalizedIdeas;
      }),
  );

  return normalizeResults.flat();
}

function normalizeDraftProtocolResult(
  draft: PlanMergeAnalysisPayload['drafts'][number],
  result: DraftNormalizeResult,
): DraftNormalizeResult {
  const ids = new Set<string>();

  return {
    protocolVersion: '0.1',
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

function ensureMergeUsesCanonicalIdeas(
  result: PlanMergeAnalysisResult,
  normalizedIdeas: NormalizedIdea[],
): PlanMergeAnalysisResult {
  const returnedIdeas = Array.isArray(result.normalizedIdeas) ? result.normalizedIdeas : [];
  const sameIdeas = JSON.stringify(returnedIdeas) === JSON.stringify(normalizedIdeas);

  if (sameIdeas) {
    return result;
  }

  return {
    ...result,
    normalizedIdeas,
    warnings: [
      ...(Array.isArray(result.warnings) ? result.warnings : []),
      'GMS merge 응답의 normalizedIdeas는 서버에서 검증 완료한 아이디어로 고정했습니다.',
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
      'GMS 응답의 missingSections는 서버에서 최종 문서 섹션 기준으로 보정했습니다.',
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
    Array.isArray(record.normalizedIdeas) &&
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
    ensureFinalDocumentCoverage(
      ensureDecisionBlockCoverage(
        payload,
        ensureMergeUsesCanonicalIdeas(result, normalizedIdeas),
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
    const isConflict = conflictsWithForbiddenDirection(payload.project.forbiddenDirection, idea);
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
    `GMS merge가 반영하지 않은 ${uncoveredIdeas.length}개 아이디어를 서버에서 Decision Block에 보강했습니다.`,
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
  const selectedIdea = chooseServerSelectedIdea(payload, ideas);
  const options = ideas.map((idea) => {
    const isSelected = idea.id === selectedIdea.id;
    const isConflict = !isSelected && conflictsWithForbiddenDirection(payload.project.forbiddenDirection, idea);

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
    selectionReason: 'GMS merge가 이 아이디어를 Decision Block에 반영하지 않아, 서버가 검증된 출처 아이디어를 기준으로 보강했습니다.',
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

function chooseServerSelectedIdea(payload: PlanMergeAnalysisPayload, ideas: NormalizedIdea[]) {
  return ideas.find((idea) => !conflictsWithForbiddenDirection(payload.project.forbiddenDirection, idea))
    ?? ideas[0];
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

function conflictsWithForbiddenDirection(forbiddenDirection: string, idea: NormalizedIdea) {
  if (idea.intent === 'warn') {
    return false;
  }

  const haystack = `${idea.topic} ${idea.normalizedText} ${idea.sourceExcerpt}`.toLowerCase();
  const forbidden = forbiddenDirection.toLowerCase();
  const keywordGroups = [
    ['실시간 공동 편집', '공동 편집'],
    ['외부 문서 연동', '문서 연동', 'notion'],
    ['slack', '공유'],
    ['팀 초대', '초대'],
    ['연동'],
  ];

  return keywordGroups.some((keywords) =>
    keywords.some((keyword) => forbidden.includes(keyword.toLowerCase())) &&
    keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
  );
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
  const rateLimit = checkRateLimit('analyze-planmerge', getClientKey(request), RATE_LIMIT);

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
    return NextResponse.json(buildFallback(payload, '분석할 초안이 없어 로컬 하네스 결과를 반환했습니다.'));
  }

  if (!getGmsConfig().apiKey) {
    return NextResponse.json(buildFallback(payload, 'GMS_API_KEY가 없어 로컬 하네스를 사용했습니다.'));
  }

  try {
    const normalizedIdeas = await normalizeDrafts(payload);
    const mergePrompt = buildMergeNormalizedIdeasPrompt(payload, normalizedIdeas);
    const mergeResultRaw = await callGmsJson<PlanMergeAnalysisResult>(
      mergePrompt,
      { maxOutputTokens: 8000 },
    );
    const mergeResult = postProcessMergeResult(payload, mergeResultRaw, normalizedIdeas);
    const validation = validatePlanMergeAnalysis(payload, mergeResult);

    if (validation.valid) {
      return NextResponse.json({
        ...mergeResult,
        source: 'gms',
      } satisfies PlanMergeAnalysisResult);
    }

    const repairedResultRaw = await callGmsJson<PlanMergeAnalysisResult>(
      buildPlanMergeRepairPrompt(payload, mergeResult, validation.errors),
      { maxOutputTokens: 8000 },
    );
    const repairedResult = postProcessMergeResult(payload, repairedResultRaw, normalizedIdeas);
    const repairValidation = validatePlanMergeAnalysis(payload, repairedResult);

    if (!repairValidation.valid) {
      throw new Error(`Repair validation failed: ${repairValidation.errors.join(', ')}`);
    }

    return NextResponse.json({
      ...repairedResult,
      source: 'gms',
      warnings: [
        ...repairedResult.warnings,
        '1차 merge 검증 실패 후 repair prompt로 복구했습니다.',
      ],
    } satisfies PlanMergeAnalysisResult);
  } catch (error) {
    // 업스트림 오류 본문에는 게이트웨이 내부 정보가 섞일 수 있어 서버 로그에만 남긴다.
    console.error('[analyze/planmerge] GMS analysis failed:', error);

    return NextResponse.json(
      buildFallback(payload, 'GMS 분석 실패로 로컬 하네스를 사용했습니다.'),
    );
  }
}
