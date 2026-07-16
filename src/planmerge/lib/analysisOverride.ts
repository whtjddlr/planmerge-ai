import {
  documentSectionDefinitions,
  type DocumentSectionKey,
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
  const nextSelectedOption = nextTargetBlock.options.find((option) => option.id === nextTargetBlock.selectedOptionId);

  return {
    ...analysisResult,
    decisionBlocks: nextDecisionBlocks,
    finalDocumentSections: updateFinalDocumentSection(
      analysisResult,
      nextTargetBlock.sectionKey,
      decisionBlockId,
      nextSelectedOption?.content ?? targetOption.content,
    ),
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
    result.source === 'local_fallback' ||
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
    selectionReason: `GPT-5.6 consensus: ${proposal.selectionReason.trim()}`,
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
            ?? 'Retained from the original decision block after the GPT-5.6 consensus patch.',
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
    finalDocumentSections: updateFinalDocumentSection(
      analysisResult,
      nextTargetBlock.sectionKey,
      nextTargetBlock.id,
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

function updateFinalDocumentSection(
  analysisResult: PlanMergeAnalysisResult,
  sectionKey: DocumentSectionKey,
  decisionBlockId: string,
  content: string,
) {
  const sectionTitle = documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? sectionKey;
  const existingSection = analysisResult.finalDocumentSections.find((section) => section.sectionKey === sectionKey);
  const nextSection = {
    sectionKey,
    title: existingSection?.title ?? sectionTitle,
    content,
    sourceDecisionBlockIds: [
      ...new Set([...(existingSection?.sourceDecisionBlockIds ?? []), decisionBlockId]),
    ],
  };
  const existingIndex = analysisResult.finalDocumentSections.findIndex((section) => section.sectionKey === sectionKey);

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
