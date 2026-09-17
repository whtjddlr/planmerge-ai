/**
 * 수기 검증기 — 입력 페이로드, 정규화 결과, 병합 결과.
 *
 * Zod 같은 스키마 라이브러리를 쓰지 않는 것은 의도된 설계다(AGENTS.md 규칙 5).
 * 검증 규칙을 바꾸면 `run-planmerge-quality-cases.ts`에 케이스를 넣는다.
 */
import type { LocalDraftSubmission, ProjectSettings } from '../localWorkspace';
import { MAX_ANALYSIS_DRAFT_COUNT } from './protocolTypes';
import type {
  DecisionSelectionSource,
  DocumentSectionKey,
  DraftNormalizeResult,
  NormalizedIdea,
  PlanMergeAnalysisPayload,
  PlanMergeValidationResult,
  ProtocolDecisionBlock,
  ProtocolFinalDocumentSection,
} from './protocolTypes';
import {
  aiModels,
  conflictLevels,
  conflictSeverities,
  documentTypes,
  draftStatuses,
  hasText,
  ideaIntents,
  ideaTypes,
  isNumberInRange,
  isRecord,
  optionTypes,
  readString,
  sectionKeys,
  selectionSources,
} from './protocolInternals';
import type { PayloadParseResult } from './protocolInternals';

export function parsePlanMergeAnalysisPayload(input: unknown): PayloadParseResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: ['payload must be an object'],
    };
  }

  const projectInput = input.project;
  const draftsInput = input.drafts;

  if (!isRecord(projectInput)) {
    errors.push('project must be an object');
  }

  if (!Array.isArray(draftsInput)) {
    errors.push('drafts must be an array');
  }

  const projectRecord = isRecord(projectInput) ? projectInput : {};
  const documentType = readString(projectRecord, 'documentType', errors, {
    required: true,
    maxLength: 40,
    fallback: 'service_plan',
  });

  if (!documentTypes.has(documentType as ProjectSettings['documentType'])) {
    errors.push('project.documentType is invalid');
  }

  const project: ProjectSettings = {
    title: readString(projectRecord, 'title', errors, { required: true, maxLength: 120 }),
    goal: readString(projectRecord, 'goal', errors, { required: true, maxLength: 2000 }),
    documentType: documentTypes.has(documentType as ProjectSettings['documentType'])
      ? documentType as ProjectSettings['documentType']
      : 'service_plan',
    contextPack: readString(projectRecord, 'contextPack', errors, { maxLength: 4000 }),
    forbiddenDirection: readString(projectRecord, 'forbiddenDirection', errors, { maxLength: 2000 }),
    outputStyle: readString(projectRecord, 'outputStyle', errors, { maxLength: 1000 }),
  };

  const drafts: LocalDraftSubmission[] = [];

  if (Array.isArray(draftsInput)) {
    if (draftsInput.length > MAX_ANALYSIS_DRAFT_COUNT) {
      errors.push(`drafts must include ${MAX_ANALYSIS_DRAFT_COUNT} items or fewer`);
    }

    draftsInput.forEach((draftInput, index) => {
      if (!isRecord(draftInput)) {
        errors.push(`drafts[${index}] must be an object`);
        return;
      }

      const aiModel = readString(draftInput, 'aiModel', errors, {
        required: true,
        maxLength: 40,
        fallback: 'Other',
      });
      const status = readString(draftInput, 'status', errors, {
        required: true,
        maxLength: 20,
        fallback: 'submitted',
      });

      if (!aiModels.has(aiModel as LocalDraftSubmission['aiModel'])) {
        errors.push(`drafts[${index}].aiModel is invalid`);
      }

      if (!draftStatuses.has(status as LocalDraftSubmission['status'])) {
        errors.push(`drafts[${index}].status is invalid`);
      }

      drafts.push({
        id: readString(draftInput, 'id', errors, { required: true, maxLength: 100 }),
        authorName: readString(draftInput, 'authorName', errors, { required: true, maxLength: 80 }),
        authorRole: readString(draftInput, 'authorRole', errors, { maxLength: 80 }),
        aiModel: aiModels.has(aiModel as LocalDraftSubmission['aiModel'])
          ? aiModel as LocalDraftSubmission['aiModel']
          : 'Other',
        taskTitle: readString(draftInput, 'taskTitle', errors, { required: true, maxLength: 160 }),
        rawText: readString(draftInput, 'rawText', errors, { required: true, maxLength: 50000 }),
        status: draftStatuses.has(status as LocalDraftSubmission['status'])
          ? status as LocalDraftSubmission['status']
          : 'submitted',
        createdAtLabel: readString(draftInput, 'createdAtLabel', errors, { maxLength: 40 }),
      });
    });
  }

  const draftIds = new Set<string>();
  drafts.forEach((draft, index) => {
    if (draftIds.has(draft.id)) {
      errors.push(`drafts[${index}] has duplicated id ${draft.id}`);
    }
    draftIds.add(draft.id);
  });

  if (errors.length) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    payload: {
      project,
      drafts,
    },
    errors: [],
  };
}

export function validateDraftNormalizeResult(
  draft: LocalDraftSubmission,
  result: DraftNormalizeResult,
): PlanMergeValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (result.protocolVersion !== '0.4') {
    errors.push('protocolVersion must be 0.4');
  }

  result.normalizedIdeas.forEach((idea, index) => {
    if (!idea.id) errors.push(`normalizedIdeas[${index}] is missing id`);
    if (ids.has(idea.id)) errors.push(`normalizedIdeas[${index}] has duplicated id ${idea.id}`);
    ids.add(idea.id);
    if (idea.sourceDraftId !== draft.id) {
      errors.push(`normalizedIdeas[${index}] must use sourceDraftId ${draft.id}`);
    }
    if (idea.sourceModel !== draft.aiModel) {
      errors.push(`normalizedIdeas[${index}] must use sourceModel ${draft.aiModel}`);
    }
    if (!sectionKeys.has(idea.sectionKey)) {
      errors.push(`normalizedIdeas[${index}] has invalid sectionKey`);
    }
    if (!idea.sourceExcerpt.trim()) {
      errors.push(`normalizedIdeas[${index}] is missing sourceExcerpt`);
    }
    if (!idea.normalizedText.trim()) {
      errors.push(`normalizedIdeas[${index}] is missing normalizedText`);
    }
    if (idea.confidence < 0 || idea.confidence > 1) {
      errors.push(`normalizedIdeas[${index}] confidence must be between 0 and 1`);
    }
    errors.push(
      ...forbiddenDirectionJudgementErrors(idea.forbiddenDirectionConflict, `normalizedIdeas[${index}]`),
    );
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 안전 게이트가 읽는 값이므로 누락 시 기본값으로 메우지 않는다.
 * 판정이 없으면 검증을 실패시켜 repair 또는 실패 응답으로 보낸다.
 */
function forbiddenDirectionJudgementErrors(judgement: unknown, path: string) {
  if (!isRecord(judgement)) {
    return [`${path} is missing forbiddenDirectionConflict`];
  }

  const errors: string[] = [];

  if (typeof judgement.conflicts !== 'boolean') {
    errors.push(`${path} forbiddenDirectionConflict.conflicts must be a boolean`);
  }
  if (!hasText(judgement.reason)) {
    errors.push(`${path} forbiddenDirectionConflict.reason is required`);
  }
  if (typeof judgement.evidence !== 'string') {
    errors.push(`${path} forbiddenDirectionConflict.evidence must be a string`);
  } else if (judgement.conflicts === true && !judgement.evidence.trim()) {
    // 충돌이라고 판정했으면 어디를 보고 그렇게 판정했는지 남겨야 한다.
    errors.push(`${path} forbiddenDirectionConflict.evidence is required when conflicts is true`);
  }

  return errors;
}

export function validatePlanMergeAnalysis(
  payload: PlanMergeAnalysisPayload,
  result: unknown,
): PlanMergeValidationResult {
  const errors: string[] = [];

  if (!isRecord(result)) {
    return {
      valid: false,
      errors: ['analysis result must be an object'],
    };
  }

  const draftIds = new Set(payload.drafts.map((draft) => draft.id));
  const draftsById = new Map(payload.drafts.map((draft) => [draft.id, draft]));
  const normalizedIdeas = Array.isArray(result.normalizedIdeas)
    ? result.normalizedIdeas as NormalizedIdea[]
    : [];
  const decisionBlocks = Array.isArray(result.decisionBlocks)
    ? result.decisionBlocks as ProtocolDecisionBlock[]
    : [];
  const finalDocumentSections = Array.isArray(result.finalDocumentSections)
    ? result.finalDocumentSections as ProtocolFinalDocumentSection[]
    : [];
  const missingSections = Array.isArray(result.missingSections)
    ? result.missingSections as DocumentSectionKey[]
    : [];
  const ideaIds = new Set<string>();
  const decisionBlockIds = new Set(
    decisionBlocks
      .filter(isRecord)
      .map((block) => block.id)
      .filter((id): id is string => typeof id === 'string'),
  );

  if (result.protocolVersion !== '0.4') {
    errors.push('protocolVersion must be 0.4');
  }

  if (
    result.source !== 'openai' && result.source !== 'gms' &&
    result.source !== 'gemini' &&
    result.source !== 'solar' &&
    result.source !== 'local_harness'
  ) {
    errors.push('source must be openai, gms, gemini, solar, or local_harness');
  }

  if (!Array.isArray(result.normalizedIdeas)) {
    errors.push('normalizedIdeas must be an array');
  }
  if (!Array.isArray(result.decisionBlocks)) {
    errors.push('decisionBlocks must be an array');
  }
  if (!Array.isArray(result.finalDocumentSections)) {
    errors.push('finalDocumentSections must be an array');
  }
  if (!Array.isArray(result.missingSections)) {
    errors.push('missingSections must be an array');
  }
  if (!Array.isArray(result.warnings)) {
    errors.push('warnings must be an array');
  }

  normalizedIdeas.forEach((idea, index) => {
    if (!isRecord(idea)) {
      errors.push(`normalizedIdeas[${index}] must be an object`);
      return;
    }

    if (!hasText(idea.id)) errors.push(`normalizedIdeas[${index}] is missing id`);
    if (ideaIds.has(idea.id)) errors.push(`normalizedIdeas[${index}] has duplicated id ${idea.id}`);
    ideaIds.add(idea.id);
    if (!draftIds.has(idea.sourceDraftId)) {
      errors.push(`normalizedIdeas[${index}] has invalid sourceDraftId`);
    } else if (draftsById.get(idea.sourceDraftId)?.aiModel !== idea.sourceModel) {
      errors.push(`normalizedIdeas[${index}] sourceModel does not match source draft`);
    }
    if (!sectionKeys.has(idea.sectionKey)) {
      errors.push(`normalizedIdeas[${index}] has invalid sectionKey`);
    }
    if (!ideaTypes.has(idea.ideaType)) {
      errors.push(`normalizedIdeas[${index}] has invalid ideaType`);
    }
    if (!ideaIntents.has(idea.intent)) {
      errors.push(`normalizedIdeas[${index}] has invalid intent`);
    }
    if (!hasText(idea.topic)) {
      errors.push(`normalizedIdeas[${index}] is missing topic`);
    }
    if (!hasText(idea.sourceExcerpt)) {
      errors.push(`normalizedIdeas[${index}] is missing sourceExcerpt`);
    }
    if (!hasText(idea.normalizedText)) {
      errors.push(`normalizedIdeas[${index}] is missing normalizedText`);
    }
    if (typeof idea.confidence !== 'number' || idea.confidence < 0 || idea.confidence > 1) {
      errors.push(`normalizedIdeas[${index}] confidence must be between 0 and 1`);
    }
    errors.push(
      ...forbiddenDirectionJudgementErrors(idea.forbiddenDirectionConflict, `normalizedIdeas[${index}]`),
    );
  });

  const seenDecisionBlockIds = new Set<string>();

  decisionBlocks.forEach((block, blockIndex) => {
    if (!isRecord(block)) {
      errors.push(`decisionBlocks[${blockIndex}] must be an object`);
      return;
    }

    if (!hasText(block.id)) {
      errors.push(`decisionBlocks[${blockIndex}] is missing id`);
    }
    if (seenDecisionBlockIds.has(block.id)) {
      errors.push(`decisionBlocks[${blockIndex}] has duplicated id ${block.id}`);
    }
    seenDecisionBlockIds.add(block.id);
    if (!sectionKeys.has(block.sectionKey)) {
      errors.push(`decisionBlocks[${blockIndex}] has invalid sectionKey`);
    }
    if (!hasText(block.topic)) {
      errors.push(`decisionBlocks[${blockIndex}] is missing topic`);
    }
    if (!hasText(block.selectionReason)) {
      errors.push(`decisionBlocks[${blockIndex}] is missing selectionReason`);
    }
    if (!selectionSources.has(block.selectionSource as DecisionSelectionSource)) {
      errors.push(`decisionBlocks[${blockIndex}] selectionSource must be merge, decision_room, or human`);
    }
    if (!isNumberInRange(block.confidence, 0, 1)) {
      errors.push(`decisionBlocks[${blockIndex}] confidence must be between 0 and 1`);
    }
    if (!conflictLevels.has(block.conflictLevel)) {
      errors.push(`decisionBlocks[${blockIndex}] has invalid conflictLevel`);
    }
    if (typeof block.needsHumanReview !== 'boolean') {
      errors.push(`decisionBlocks[${blockIndex}] needsHumanReview must be boolean`);
    }
    if (!Array.isArray(block.options)) {
      errors.push(`decisionBlocks[${blockIndex}].options must be an array`);
      return;
    }
    const options = block.options;
    const selectedOption = options.find((option) => isRecord(option) && option.id === block.selectedOptionId);
    if (!selectedOption) {
      errors.push(`decisionBlocks[${blockIndex}] selectedOptionId does not match options`);
    } else if (selectedOption.optionType !== 'selected') {
      errors.push(`decisionBlocks[${blockIndex}] selectedOptionId must point to a selected option`);
    }
    if (!options.length) {
      errors.push(`decisionBlocks[${blockIndex}] must include at least one option`);
    }
    const selectedOptionCount = options.filter((option) => isRecord(option) && option.optionType === 'selected').length;
    if (selectedOptionCount !== 1) {
      errors.push(`decisionBlocks[${blockIndex}] must include exactly one selected option`);
    }
    const optionIds = new Set<string>();
    options.forEach((option, optionIndex) => {
      if (!isRecord(option)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] must be an object`);
        return;
      }
      if (!hasText(option.id)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] is missing id`);
      }
      if (optionIds.has(option.id)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] has duplicated id ${option.id}`);
      }
      optionIds.add(option.id);
      if (!optionTypes.has(option.optionType)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] has invalid optionType`);
      }
      if (!hasText(option.content)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] is missing content`);
      }
      if (!Array.isArray(option.sourceIdeaIds)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}].sourceIdeaIds must be an array`);
        return;
      }
      if (!option.sourceIdeaIds.length) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] is missing sourceIdeaIds`);
      }
      option.sourceIdeaIds.forEach((ideaId) => {
        if (!ideaIds.has(ideaId)) {
          errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] has invalid sourceIdeaId ${ideaId}`);
        }
      });
      if (option.optionType === 'conflict' && !option.severity) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] conflict option is missing severity`);
      }
      if (option.severity && !conflictSeverities.has(option.severity)) {
        errors.push(`decisionBlocks[${blockIndex}].options[${optionIndex}] has invalid severity`);
      }
    });
  });

  const finalSectionKeys = new Set<DocumentSectionKey>();

  finalDocumentSections.forEach((section, index) => {
    if (!isRecord(section)) {
      errors.push(`finalDocumentSections[${index}] must be an object`);
      return;
    }

    if (!sectionKeys.has(section.sectionKey)) {
      errors.push(`finalDocumentSections[${index}] has invalid sectionKey`);
    }
    if (finalSectionKeys.has(section.sectionKey)) {
      errors.push(`finalDocumentSections[${index}] has duplicated sectionKey ${section.sectionKey}`);
    }
    finalSectionKeys.add(section.sectionKey);
    if (!hasText(section.title)) {
      errors.push(`finalDocumentSections[${index}] is missing title`);
    }
    if (!hasText(section.content)) {
      errors.push(`finalDocumentSections[${index}] is missing content`);
    }
    if (!Array.isArray(section.sourceDecisionBlockIds)) {
      errors.push(`finalDocumentSections[${index}].sourceDecisionBlockIds must be an array`);
      return;
    }
    if (!section.sourceDecisionBlockIds.length) {
      errors.push(`finalDocumentSections[${index}] is missing sourceDecisionBlockIds`);
    }
    section.sourceDecisionBlockIds.forEach((blockId) => {
      if (!decisionBlockIds.has(blockId)) {
        errors.push(`finalDocumentSections[${index}] has invalid sourceDecisionBlockId ${blockId}`);
      }
    });

    const composedFrom = (section as { composedFrom?: unknown }).composedFrom;

    if (composedFrom !== undefined) {
      if (!Array.isArray(composedFrom)) {
        errors.push(`finalDocumentSections[${index}].composedFrom must be an array`);
      } else {
        composedFrom.forEach((entry, entryIndex) => {
          if (
            !isRecord(entry)
            || typeof entry.decisionBlockId !== 'string'
            || typeof entry.selectedOptionId !== 'string'
          ) {
            errors.push(`finalDocumentSections[${index}].composedFrom[${entryIndex}] must name a decisionBlockId and selectedOptionId`);
            return;
          }

          if (!section.sourceDecisionBlockIds.includes(entry.decisionBlockId)) {
            errors.push(`finalDocumentSections[${index}].composedFrom[${entryIndex}] cites ${entry.decisionBlockId}, which is not a source of this section`);
          }
        });
      }
    }
  });

  const seenMissingSections = new Set<DocumentSectionKey>();
  missingSections.forEach((sectionKey) => {
    if (!sectionKeys.has(sectionKey)) {
      errors.push(`missingSections includes invalid sectionKey ${sectionKey}`);
    }
    if (seenMissingSections.has(sectionKey)) {
      errors.push(`missingSections includes duplicated sectionKey ${sectionKey}`);
    }
    if (finalSectionKeys.has(sectionKey)) {
      errors.push(`missingSections includes section already present in finalDocumentSections ${sectionKey}`);
    }
    seenMissingSections.add(sectionKey);
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
