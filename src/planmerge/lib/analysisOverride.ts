import {
  documentSectionDefinitions,
  type PlanMergeAnalysisResult,
  type ProtocolDecisionBlock,
  type ProtocolDecisionOption,
} from './ai/planmergeProtocol';
import type { DecisionResolutionResult } from './ai/decisionResolution';

export function applyDecisionOptionOverride(
  analysisResult: PlanMergeAnalysisResult,
  decisionBlockId: string,
  optionId: string,
): PlanMergeAnalysisResult {
  const targetBlock = analysisResult.decisionBlocks.find((block) => block.id === decisionBlockId);
  const targetOption = targetBlock?.options.find((option) => option.id === optionId);

  if (!targetBlock || !targetOption) {
    return analysisResult;
  }

  const nextDecisionBlocks = analysisResult.decisionBlocks.map((block) => {
    if (block.id !== decisionBlockId) {
      return block;
    }

    return applyOverrideToBlock(block, optionId, targetOption.content);
  });
  const nextTargetBlock = nextDecisionBlocks.find((block) => block.id === decisionBlockId) ?? targetBlock;

  // 사람이 충돌 의견을 선택안으로 올린 것은 정당한 권한이지만, 그 결정이 검토를
  // 마친 상태로 보이면 안 된다. 선택했다는 사실이 위반을 해소하지는 않는다.
  const overrodeConflict = targetOption.optionType === 'conflict';

  return {
    ...analysisResult,
    decisionBlocks: overrodeConflict
      ? nextDecisionBlocks.map((block) => (
        block.id === decisionBlockId ? { ...block, needsHumanReview: true } : block
      ))
      : nextDecisionBlocks,
    // 본문은 건드리지 않는다. 예전에는 섹션 본문 전체를 방금 고른 옵션 문장 하나로
    // 교체했다 — 섹션에 결정이 3개면 나머지 2개 내용이 문서에서 사라졌고, 모델이 쓴
    // 산문도 첫 클릭에 날아갔다. 이제 본문은 composedFrom과 어긋나 "갱신 필요"로
    // 표시되고, 사용자가 누르면 모델이 그 섹션을 다시 쓴다.
    missingSections: analysisResult.missingSections.filter((sectionKey) => sectionKey !== nextTargetBlock.sectionKey),
  };
}

export function applyDecisionResolutionProposal(
  analysisResult: PlanMergeAnalysisResult,
  result: DecisionResolutionResult,
): PlanMergeAnalysisResult {
  const { proposal } = result;

  if (
    !result.applicable ||
    proposal.status !== 'ready' ||
    !proposal.synthesizedDecision?.trim() ||
    !proposal.revisedSectionContent?.trim()
  ) {
    return analysisResult;
  }

  const targetBlock = analysisResult.decisionBlocks.find((block) => block.id === proposal.decisionBlockId);

  if (
    !targetBlock ||
    !proposal.recommendedOptionId ||
    proposal.supportingOptionIds.length === 0 ||
    !proposal.supportingOptionIds.includes(proposal.recommendedOptionId)
  ) {
    return analysisResult;
  }

  const optionsById = new Map(targetBlock.options.map((option) => [option.id, option] as const));
  const supportingOptions = proposal.supportingOptionIds
    .map((optionId) => optionsById.get(optionId))
    .filter((option): option is ProtocolDecisionOption => Boolean(option));

  if (supportingOptions.length !== proposal.supportingOptionIds.length) {
    return analysisResult;
  }

  if (!optionsById.has(proposal.recommendedOptionId)) {
    return analysisResult;
  }

  const sourceIdeaIds = [...new Set(supportingOptions.flatMap((option) => option.sourceIdeaIds))];

  if (sourceIdeaIds.length === 0) {
    return analysisResult;
  }

  const consensusOptionId = createConsensusOptionId(targetBlock.id, result.responseId, result.generatedAt);
  const consensusOption: ProtocolDecisionOption = {
    id: consensusOptionId,
    optionType: 'selected',
    content: proposal.synthesizedDecision.trim(),
    sourceIdeaIds,
  };
  const nextTargetBlock: ProtocolDecisionBlock = {
    ...targetBlock,
    selectedOptionId: consensusOptionId,
    // selectionReason은 사람이 읽는 산문으로만 둔다. 누가 결정했는지는
    // selectionSource가 들고 있으므로 접두사로 인코딩하지 않는다.
    selectionReason: proposal.selectionReason.trim(),
    selectionSource: 'decision_room',
    confidence: Math.min(Math.max(proposal.confidence, 0), 1),
    conflictLevel: 'none',
    needsHumanReview: false,
    options: [
      consensusOption,
      ...targetBlock.options
        .filter((option) => option.id !== consensusOptionId)
        .map((option) => ({
          ...option,
          optionType: 'alternative' as const,
          differenceFromSelected: option.differenceFromSelected
            ?? '합의안 적용 전 Decision Block에 있던 의견입니다.',
          severity: undefined,
        })),
    ],
  };
  const nextDecisionBlocks = analysisResult.decisionBlocks.map((block) => (
    block.id === nextTargetBlock.id ? nextTargetBlock : block
  ));

  return {
    ...analysisResult,
    decisionBlocks: nextDecisionBlocks,
    finalDocumentSections: applyResolvedSectionContent(
      analysisResult,
      nextTargetBlock,
      proposal.revisedSectionContent.trim(),
    ),
    missingSections: analysisResult.missingSections.filter(
      (sectionKey) => sectionKey !== nextTargetBlock.sectionKey,
    ),
  };
}

function applyOverrideToBlock(
  block: ProtocolDecisionBlock,
  optionId: string,
  selectedContent: string,
): ProtocolDecisionBlock {
  const previousSelectedOptionId = block.selectedOptionId;
  const nextOptions = block.options.map((option) => {
    if (option.id === optionId) {
      return {
        ...option,
        optionType: 'selected' as const,
        severity: undefined,
      };
    }

    if (option.id === previousSelectedOptionId) {
      return {
        ...option,
        optionType: 'alternative' as const,
        differenceFromSelected: '사용자 변경 전 AI 선택안입니다.',
        severity: undefined,
      };
    }

    return option;
  });

  return {
    ...block,
    selectedOptionId: optionId,
    selectionReason: `사용자가 "${selectedContent}"을 이 섹션의 선택안으로 적용했습니다.`,
    selectionSource: 'human',
    conflictLevel: inferConflictLevel(nextOptions),
    needsHumanReview: false,
    confidence: Math.max(block.confidence, 0.8),
    options: nextOptions,
  };
}

function inferConflictLevel(options: ProtocolDecisionOption[]): ProtocolDecisionBlock['conflictLevel'] {
  const conflictSeverities = options
    .filter((option) => option.optionType === 'conflict')
    .map((option) => option.severity);

  if (conflictSeverities.includes('high')) return 'high';
  if (conflictSeverities.includes('medium')) return 'medium';
  if (conflictSeverities.includes('low')) return 'low';
  return 'none';
}

/**
 * Decision Room이 쓴 섹션 산문을 본문에 반영한다 — 그 섹션의 결정이 이 블록 하나일 때만.
 *
 * 중재안의 `revisedSectionContent`는 모델이 쓴 산문이지만 블록 하나를 보고 쓴 것이다.
 * 섹션에 결정이 여럿이면 그걸 본문으로 삼는 순간 다른 결정의 내용이 사라진다. 그때는
 * 본문을 두고, composedFrom과 어긋나 "갱신 필요"가 뜨게 한다. 사용자가 누르면
 * 그 섹션의 결정 전부를 보고 다시 쓴다.
 */
function applyResolvedSectionContent(
  analysisResult: PlanMergeAnalysisResult,
  block: ProtocolDecisionBlock,
  content: string,
): PlanMergeAnalysisResult['finalDocumentSections'] {
  const sectionBlockIds = analysisResult.decisionBlocks
    .filter((entry) => entry.sectionKey === block.sectionKey)
    .map((entry) => entry.id);

  if (sectionBlockIds.length !== 1 || sectionBlockIds[0] !== block.id) {
    return analysisResult.finalDocumentSections;
  }

  const sectionTitle = documentSectionDefinitions.find((section) => section.key === block.sectionKey)?.title
    ?? block.sectionKey;
  const existingIndex = analysisResult.finalDocumentSections.findIndex((section) => section.sectionKey === block.sectionKey);
  const nextSection = {
    sectionKey: block.sectionKey,
    title: analysisResult.finalDocumentSections[existingIndex]?.title ?? sectionTitle,
    content,
    sourceDecisionBlockIds: [block.id],
    composedFrom: [{ decisionBlockId: block.id, selectedOptionId: block.selectedOptionId }],
  };

  if (existingIndex === -1) {
    return [...analysisResult.finalDocumentSections, nextSection];
  }

  return analysisResult.finalDocumentSections.map((section, index) => (
    index === existingIndex ? nextSection : section
  ));
}

function createConsensusOptionId(
  decisionBlockId: string,
  responseId: string | undefined,
  generatedAt: string,
) {
  const evidenceId = responseId ?? generatedAt;
  const safeEvidenceId = evidenceId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-40) || 'resolution';

  return `${decisionBlockId}:consensus:${safeEvidenceId}`;
}
