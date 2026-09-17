import type { DecisionSource, DecisionTrace, DocumentSectionData, SectionStatus } from '../data/mergeResult';
import type { LocalDraftSubmission } from './localWorkspace';
import {
  documentSectionDefinitions,
  sectionIsStale,
  type DecisionSelectionSource,
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
    const violatesForbiddenDirection = sectionSelectsForbiddenDirection(
      definition.key,
      analysisResult,
      ideasById,
    );
    const status = violatesForbiddenDirection
      ? 'conflict'
      : getSectionStatus(definition.key, analysisResult);
    const decisionTraces = decisionBlocks.map((block) =>
      createDecisionTraceFromBlock(
        definition.key,
        definition.title,
        definition.sortOrder,
        block,
        ideasById,
        draftsById,
      ));

    const stale = finalSection ? sectionIsStale(finalSection, decisionBlocks) : false;

    return {
      number: definition.sortOrder,
      sectionKey: definition.key,
      title: definition.title,
      content: finalSection?.content ?? '',
      status,
      decisionTrace: decisionTraces[0],
      decisionTraces: decisionTraces.length ? decisionTraces : undefined,
      ...(violatesForbiddenDirection ? { violatesForbiddenDirection } : {}),
      ...(stale ? { stale } : {}),
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

/**
 * 선택안이 금지 방향 아이디어에 근거하는가.
 *
 * `conflictLevel`로는 알 수 없다. 사람이 충돌 의견을 선택안으로 올리면 그 옵션은
 * `selected`가 되고 severity가 사라져 conflictLevel이 none으로 내려간다. 그래서
 * 옵션 타입이 아니라 근거 아이디어의 판정을 읽는다.
 */
function sectionSelectsForbiddenDirection(
  sectionKey: DocumentSectionKey,
  analysisResult: PlanMergeAnalysisResult,
  ideasById: Map<string, NormalizedIdea>,
) {
  return analysisResult.decisionBlocks
    .filter((block) => block.sectionKey === sectionKey)
    .some((block) => {
      const selected = block.options.find((option) => option.id === block.selectedOptionId);

      return (selected?.sourceIdeaIds ?? []).some((ideaId) => {
        const idea = ideasById.get(ideaId);

        // 리스크 경고는 금지 방향 제안이 아니다.
        return idea?.forbiddenDirectionConflict?.conflicts === true && idea.intent !== 'warn';
      });
    });
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
          label: selectionSourceLabel(primaryBlock.selectionSource),
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

/** 누가 정했는지는 타입 있는 필드에서 읽는다. 산문을 파싱하지 않는다. */
function selectionSourceLabel(source: DecisionSelectionSource) {
  if (source === 'decision_room') {
    return 'AI 합의';
  }

  if (source === 'human') {
    return '사용자 선택';
  }

  return '자동 선택';
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
