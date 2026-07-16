import type { DecisionSource, DecisionTrace, DocumentSectionData, SectionStatus } from '../data/mergeResult';
import type { LocalDraftSubmission } from './localWorkspace';
import {
  documentSectionDefinitions,
  type NormalizedIdea,
  type DocumentSectionKey,
  type PlanMergeAnalysisResult,
  type ProtocolDecisionBlock,
} from './ai/planmergeProtocol';

export function createDocumentSectionsFromAnalysis(
  analysisResult?: PlanMergeAnalysisResult,
  drafts: LocalDraftSubmission[] = [],
): DocumentSectionData[] {
  if (!analysisResult) {
    return createEmptyDocumentSections();
  }

  const finalSectionsByKey = new Map(
    analysisResult.finalDocumentSections.map((section) => [section.sectionKey, section]),
  );
  const decisionBlocksByKey = new Map<DocumentSectionKey, ProtocolDecisionBlock[]>();

  analysisResult.decisionBlocks.forEach((block) => {
    decisionBlocksByKey.set(block.sectionKey, [...(decisionBlocksByKey.get(block.sectionKey) ?? []), block]);
  });
  const ideasById = new Map(analysisResult.normalizedIdeas.map((idea) => [idea.id, idea]));
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));

  return documentSectionDefinitions.map((definition) => {
    const finalSection = finalSectionsByKey.get(definition.key);
    const decisionBlocks = decisionBlocksByKey.get(definition.key) ?? [];
    const status = getSectionStatus(definition.key, analysisResult);
    const decisionTraces = decisionBlocks.map((block) =>
      createDecisionTraceFromBlock(
        definition.key,
        definition.title,
        definition.sortOrder,
        block,
        ideasById,
        draftsById,
      ));

    return {
      number: definition.sortOrder,
      sectionKey: definition.key,
      title: definition.title,
      content: finalSection?.content ?? '',
      status,
      decisionTrace: decisionTraces[0],
      decisionTraces: decisionTraces.length ? decisionTraces : undefined,
    };
  });
}

function createEmptyDocumentSections(): DocumentSectionData[] {
  return documentSectionDefinitions.map((definition) => ({
    number: definition.sortOrder,
    sectionKey: definition.key,
    title: definition.title,
    content: '',
    status: 'pending',
  }));
}

function getSectionStatus(sectionKey: DocumentSectionKey, analysisResult: PlanMergeAnalysisResult): SectionStatus {
  const blocks = analysisResult.decisionBlocks.filter((block) => block.sectionKey === sectionKey);

  if (analysisResult.missingSections.includes(sectionKey)) return 'pending';
  if (blocks.some((block) => block.conflictLevel !== 'none')) return 'conflict';
  if (blocks.some((block) => block.needsHumanReview)) return 'review';
  return 'completed';
}

function createDecisionTraceFromBlock(
  sectionKey: DocumentSectionKey,
  sectionTitle: string,
  sectionNumber: number,
  primaryBlock: ProtocolDecisionBlock,
  ideasById: Map<string, NormalizedIdea>,
  draftsById: Map<string, LocalDraftSubmission>,
): DecisionTrace {
  const selectedOption = primaryBlock.options.find((option) => option.id === primaryBlock.selectedOptionId);
  const selectedSources = selectedOption
    ? createDecisionSources(selectedOption.sourceIdeaIds, ideasById, draftsById)
    : [];
  const alternatives = primaryBlock.options
    .filter((option) => option.optionType === 'alternative')
    .map((option) => ({
      optionId: option.id,
      title: option.content,
      description: option.differenceFromSelected ?? '선택안과 다른 방향의 의견입니다.',
      sources: createDecisionSources(option.sourceIdeaIds, ideasById, draftsById),
    }));
  const conflicts = primaryBlock.options
    .filter((option) => option.optionType === 'conflict')
    .map((option) => ({
      optionId: option.id,
      title: option.content,
      description: option.differenceFromSelected ?? '선택안과 충돌하는 의견입니다.',
      severity: option.severity,
      sources: createDecisionSources(option.sourceIdeaIds, ideasById, draftsById),
    }));

  return {
    decisionBlockId: primaryBlock.id,
    selectedOptionId: primaryBlock.selectedOptionId,
    sectionNumber,
    sectionTitle,
    topic: primaryBlock.topic,
    badges: [
      primaryBlock.needsHumanReview
        ? { label: '검토 필요', variant: 'warning' as const }
        : {
          label: primaryBlock.selectionReason.startsWith('GPT-5.6 consensus:')
            ? 'GPT-5.6 합의'
            : primaryBlock.selectionReason.startsWith('사용자가 ')
              ? '사용자 선택'
              : '자동 선택',
          variant: 'success' as const,
        },
      ...(primaryBlock.conflictLevel !== 'none'
        ? [{ label: `충돌 ${primaryBlock.conflictLevel}`, variant: 'warning' as const }]
        : []),
    ],
    selectedContent: selectedOption?.content ?? '선택안이 없습니다.',
    selectionReason: `[${sectionKey}] ${primaryBlock.selectionReason}`,
    selectedSources,
    alternatives,
    conflicts,
    opinions: [],
  };
}

function createDecisionSources(
  sourceIdeaIds: string[],
  ideasById: Map<string, NormalizedIdea>,
  draftsById: Map<string, LocalDraftSubmission>,
): DecisionSource[] {
  return sourceIdeaIds.map((ideaId) => {
    const idea = ideasById.get(ideaId);
    const draft = idea ? draftsById.get(idea.sourceDraftId) : undefined;

    return {
      authorName: draft?.authorName ?? (idea ? '삭제된 초안' : ideaId),
      aiModel: draft?.aiModel ?? idea?.sourceModel ?? 'source',
      sourceDraftId: idea?.sourceDraftId,
      sourceIdeaId: ideaId,
      taskTitle: draft?.taskTitle ?? idea?.topic,
      sourceExcerpt: idea?.sourceExcerpt,
    };
  });
}
