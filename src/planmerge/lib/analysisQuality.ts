import {
  documentSectionDefinitions,
  validatePlanMergeAnalysis,
} from './ai/planmergeProtocol';
import type {
  DocumentSectionKey,
  PlanMergeAnalysisPayload,
  PlanMergeAnalysisResult,
} from './ai/planmergeProtocol';

export type QualityLevel = 'ready' | 'review' | 'blocked';
export type QualityActionPriority = 'now' | 'next' | 'later';
export type QualityDecisionFilter = 'all' | 'needs_review' | 'conflicts' | 'low_confidence';
export type QualityValidationFocus = 'errors' | 'warnings' | 'missing_sections';

export type QualityActionDestination = {
  tab: 'quality' | 'ideas' | 'decisions' | 'validation';
  decisionBlockId?: string;
  decisionFilter?: QualityDecisionFilter;
  validationFocus?: QualityValidationFocus;
};

export type QualityMetric = {
  id: string;
  label: string;
  value: number;
  total: number;
  score: number;
  status: QualityLevel;
  helpText: string;
};

export type QualityFinding = {
  id: string;
  severity: QualityLevel;
  title: string;
  detail: string;
  target?: string;
};

export type QualityAction = {
  id: string;
  priority: QualityActionPriority;
  title: string;
  detail: string;
  expectedImpact: string;
  target?: string;
  destination?: QualityActionDestination;
};

export type AnalysisQualityReport = {
  score: number;
  level: QualityLevel;
  summary: string;
  metrics: QualityMetric[];
  findings: QualityFinding[];
  nextActions: QualityAction[];
  sourceCoverageByDraft: {
    draftId: string;
    ideaCount: number;
  }[];
  sectionCoverage: {
    sectionKey: DocumentSectionKey;
    title: string;
    hasFinalSection: boolean;
    ideaCount: number;
    decisionBlockCount: number;
  }[];
};

function levelFromScore(score: number): QualityLevel {
  if (score >= 80) {
    return 'ready';
  }

  if (score >= 55) {
    return 'review';
  }

  return 'blocked';
}

function levelRank(level: QualityLevel) {
  if (level === 'ready') return 2;
  if (level === 'review') return 1;
  return 0;
}

function minLevel(left: QualityLevel, right: QualityLevel): QualityLevel {
  return levelRank(left) <= levelRank(right) ? left : right;
}

function metric(
  id: string,
  label: string,
  value: number,
  total: number,
  helpText: string,
  blockedBelow = 50,
): QualityMetric {
  const score = total > 0 ? Math.round((value / total) * 100) : 100;
  const status = score < blockedBelow ? 'blocked' : levelFromScore(score);

  return {
    id,
    label,
    value,
    total,
    score,
    status,
    helpText,
  };
}

export function evaluateAnalysisQuality(
  payload: PlanMergeAnalysisPayload,
  result: PlanMergeAnalysisResult,
): AnalysisQualityReport {
  const validation = validatePlanMergeAnalysis(payload, result);
  const sectionKeys = documentSectionDefinitions.map((section) => section.key);
  const finalSectionKeys = new Set(result.finalDocumentSections.map((section) => section.sectionKey));
  const ideasBySection = groupBySection(result.normalizedIdeas);
  const blocksBySection = groupBySection(result.decisionBlocks);
  const ideasByDraft = new Map<string, number>();
  const findings: QualityFinding[] = [];

  payload.drafts.forEach((draft) => {
    ideasByDraft.set(draft.id, 0);
  });
  result.normalizedIdeas.forEach((idea) => {
    ideasByDraft.set(idea.sourceDraftId, (ideasByDraft.get(idea.sourceDraftId) ?? 0) + 1);
  });

  // 금지 방향을 위반하는 선택안이 하나라도 있으면 그 기획서는 "준비됨"이 아니다.
  // 사람이 의도적으로 충돌 의견을 선택안으로 덮어쓸 수 있는데(그건 사람의 권한이다),
  // 그 순간 위반이 화면에서 사라지면 안 된다. 선택안이 바뀌어도 근거 아이디어의
  // 판정은 남아 있으므로 그것으로 측정한다.
  const ideasById = new Map(result.normalizedIdeas.map((idea) => [idea.id, idea]));
  const forbiddenSelections = result.decisionBlocks.filter((block) => {
    const selected = block.options.find((option) => option.id === block.selectedOptionId);

    return (selected?.sourceIdeaIds ?? []).some((ideaId) => {
      const idea = ideasById.get(ideaId);

      // 리스크 경고는 금지 방향 제안이 아니다.
      return idea?.forbiddenDirectionConflict.conflicts === true && idea.intent !== 'warn';
    });
  });

  const decisionOptions = result.decisionBlocks.flatMap((block) => block.options);
  const optionsWithSources = decisionOptions.filter((option) => option.sourceIdeaIds.length > 0);
  const blocksWithSelectedOption = result.decisionBlocks.filter((block) =>
    block.options.some((option) => option.id === block.selectedOptionId && option.optionType === 'selected'),
  );
  const blocksWithReason = result.decisionBlocks.filter((block) => block.selectionReason.trim().length >= 20);
  const reviewBlocks = result.decisionBlocks.filter((block) => block.needsHumanReview);
  const conflictBlocks = result.decisionBlocks.filter((block) => block.conflictLevel !== 'none');
  const lowConfidenceBlocks = result.decisionBlocks.filter((block) => block.confidence < 0.65);
  const sourceDraftsUsed = [...ideasByDraft.values()].filter((count) => count > 0).length;
  const finalSectionsWithContent = result.finalDocumentSections.filter((section) => section.content.trim().length >= 20);
  const missingSectionTitles = result.missingSections.map(sectionTitle);
  const inputDraftCount = payload.drafts.filter((draft) => draft.rawText.trim().length > 0).length;
  const hasAnalysisContent =
    result.normalizedIdeas.length > 0 &&
    result.decisionBlocks.length > 0 &&
    result.finalDocumentSections.length > 0;

  const metrics = [
    metric(
      'schema_validity',
      'Schema Validity',
      validation.valid ? 1 : 0,
      1,
      'AI 응답이 PlanMerge 프로토콜을 지키는지 확인합니다.',
      100,
    ),
    metric(
      'section_coverage',
      'Section Coverage',
      finalSectionKeys.size,
      sectionKeys.length,
      `기본 기획서 ${sectionKeys.length}개 섹션 중 최종 문서가 채운 비율입니다.`,
    ),
    metric(
      'source_coverage',
      'Source Coverage',
      sourceDraftsUsed,
      Math.max(payload.drafts.length, 1),
      '입력 초안들이 분석 결과에 실제로 반영됐는지 봅니다.',
    ),
    metric(
      'option_traceability',
      'Option Traceability',
      optionsWithSources.length,
      Math.max(decisionOptions.length, 1),
      '선택지마다 원본 아이디어 근거가 연결되어 있는지 봅니다.',
    ),
    metric(
      'decision_integrity',
      'Decision Integrity',
      Math.min(blocksWithSelectedOption.length, blocksWithReason.length),
      Math.max(result.decisionBlocks.length, 1),
      'Decision Block에 선택안과 선택 이유가 충분히 있는지 봅니다.',
    ),
    metric(
      'document_completeness',
      'Document Completeness',
      finalSectionsWithContent.length,
      Math.max(result.finalDocumentSections.length, 1),
      '최종 문서 섹션이 빈 문장이나 너무 짧은 문장으로 끝나지 않는지 봅니다.',
    ),
    metric(
      'forbidden_direction_compliance',
      'Forbidden Direction',
      result.decisionBlocks.length - forbiddenSelections.length,
      Math.max(result.decisionBlocks.length, 1),
      '선택안이 프로젝트가 금지한 방향을 제안하고 있지 않은지 봅니다.',
      // 한 건이라도 위반이면 즉시 blocked가 되도록 임계값을 올린다.
      100,
    ),
  ];

  if (forbiddenSelections.length) {
    findings.push({
      id: 'forbidden_direction_selected',
      severity: 'blocked',
      title: '금지 방향이 선택안에 포함됨',
      detail: `${forbiddenSelections.length}개 결정의 선택안이 프로젝트가 금지한 방향을 제안합니다: ${
        forbiddenSelections.map((block) => block.topic).join(', ')
      }. 사람이 직접 선택한 경우라도 기준을 바꿀지 선택안을 바꿀지 확정해야 합니다.`,
    });
  }

  if (!validation.valid) {
    findings.push({
      id: 'schema_invalid',
      severity: 'blocked',
      title: '구조 검증 실패',
      detail: `${validation.errors.length}개 오류가 있습니다. 결과를 그대로 사용하지 말고 재분석해야 합니다.`,
    });
  }

  if (inputDraftCount === 0) {
    findings.push({
      id: 'no_input_drafts',
      severity: 'blocked',
      title: '분석할 초안 없음',
      detail: '사용 가능한 초안이 없어 Decision Block과 최종 문서를 만들 수 없습니다.',
    });
  }

  if (inputDraftCount > 0 && !hasAnalysisContent) {
    findings.push({
      id: 'no_analysis_content',
      severity: 'blocked',
      title: '분석 결과 비어 있음',
      detail: '초안은 있지만 추출 아이디어, Decision Block, 최종 문서 섹션 중 하나 이상이 비어 있습니다.',
    });
  }

  if (sourceDraftsUsed < payload.drafts.length) {
    findings.push({
      id: 'unused_drafts',
      severity: 'review',
      title: '반영되지 않은 초안 있음',
      detail: `${payload.drafts.length - sourceDraftsUsed}개 초안에서 추출된 아이디어가 없습니다.`,
    });
  }

  if (result.missingSections.length > 0) {
    findings.push({
      id: 'missing_sections',
      severity: 'review',
      title: '누락 섹션 있음',
      detail: `${missingSectionTitles.join(', ')} 섹션은 추가 작성이 필요합니다.`,
    });
  }

  conflictBlocks.forEach((block) => {
    findings.push({
      id: `conflict_${block.id}`,
      severity: 'review',
      title: `${conflictLevelLabel(block.conflictLevel)} 충돌 의견`,
      detail: '이 주제는 자동 선택안을 그대로 승인하기 전에 사람이 판단해야 합니다.',
      target: `${sectionTitle(block.sectionKey)} · ${block.topic}`,
    });
  });

  lowConfidenceBlocks.forEach((block) => {
    findings.push({
      id: `low_confidence_${block.id}`,
      severity: 'review',
      title: '낮은 선택 신뢰도',
      detail: `AI confidence가 ${Math.round(block.confidence * 100)}%입니다.`,
      target: `${sectionTitle(block.sectionKey)} · ${block.topic}`,
    });
  });

  const reviewRatio = result.decisionBlocks.length > 0
    ? reviewBlocks.length / result.decisionBlocks.length
    : 0;
  if (reviewRatio >= 0.5) {
    findings.push({
      id: 'review_pressure',
      severity: 'review',
      title: '검토 필요 항목이 많음',
      detail: 'Decision Block 절반 이상이 사람 검토를 요구합니다. 공통 기준을 더 구체화한 뒤 재분석하는 것이 좋습니다.',
    });
  }

  const weightedScore = Math.round(
    metrics.reduce((sum, item) => sum + item.score, 0) / metrics.length,
  );
  const sectionCoverageRatio = finalSectionKeys.size / sectionKeys.length;
  let score = weightedScore;
  let level = validation.valid ? levelFromScore(score) : 'blocked';

  // 금지 방향 위반은 평균에 희석되면 안 된다. 기획서가 자기 제약을 어기고 있다는 것은
  // 이 도구가 막아야 하는 단 하나의 상태이므로 스키마 오류와 같은 등급으로 막는다.
  if (
    !validation.valid
    || inputDraftCount === 0
    || !hasAnalysisContent
    || forbiddenSelections.length > 0
  ) {
    score = Math.min(score, 45);
    level = 'blocked';
  } else {
    if (result.missingSections.length > 0 || finalSectionKeys.size < sectionKeys.length) {
      score = Math.min(score, 79);
      level = minLevel(levelFromScore(score), 'review');
    }

    if (sectionCoverageRatio < 0.5) {
      score = Math.min(score, 68);
      level = minLevel(levelFromScore(score), 'review');
    }

    if (sourceDraftsUsed < payload.drafts.length) {
      score = Math.min(score, 74);
      level = minLevel(levelFromScore(score), 'review');
    }
  }

  const nextActions = buildNextActions({
    conflictBlocks,
    finalSectionsWithContentCount: finalSectionsWithContent.length,
    lowConfidenceBlocks,
    missingSectionTitles,
    payloadDraftCount: payload.drafts.length,
    result,
    sourceDraftsUsed,
    inputDraftCount,
    validationErrorCount: validation.errors.length,
  });

  return {
    score,
    level,
    summary: qualitySummary(level, forbiddenSelections.length),
    metrics,
    findings,
    nextActions,
    sourceCoverageByDraft: [...ideasByDraft.entries()].map(([draftId, ideaCount]) => ({
      draftId,
      ideaCount,
    })),
    sectionCoverage: documentSectionDefinitions.map((section) => ({
      sectionKey: section.key,
      title: section.title,
      hasFinalSection: finalSectionKeys.has(section.key),
      ideaCount: ideasBySection.get(section.key)?.length ?? 0,
      decisionBlockCount: blocksBySection.get(section.key)?.length ?? 0,
    })),
  };
}

function buildNextActions({
  conflictBlocks,
  finalSectionsWithContentCount,
  lowConfidenceBlocks,
  missingSectionTitles,
  payloadDraftCount,
  result,
  sourceDraftsUsed,
  inputDraftCount,
  validationErrorCount,
}: {
  conflictBlocks: PlanMergeAnalysisResult['decisionBlocks'];
  finalSectionsWithContentCount: number;
  lowConfidenceBlocks: PlanMergeAnalysisResult['decisionBlocks'];
  missingSectionTitles: string[];
  payloadDraftCount: number;
  result: PlanMergeAnalysisResult;
  sourceDraftsUsed: number;
  inputDraftCount: number;
  validationErrorCount: number;
}) {
  const actions: QualityAction[] = [];
  const reviewBlocks = result.decisionBlocks.filter((block) => block.needsHumanReview);
  const reviewRatio = result.decisionBlocks.length > 0
    ? reviewBlocks.length / result.decisionBlocks.length
    : 0;
  const decisionOptions = result.decisionBlocks.flatMap((block) => block.options);
  const optionsMissingSources = decisionOptions.filter((option) => option.sourceIdeaIds.length === 0);

  if (validationErrorCount > 0) {
    actions.push({
      id: 'fix_schema_before_use',
      priority: 'now',
      title: '구조 오류를 먼저 해결',
      detail: `${validationErrorCount}개 검증 오류가 있습니다. 이 상태에서는 최종 문서 승인보다 재분석 또는 repair prompt 확인이 우선입니다.`,
      expectedImpact: '결과 신뢰도와 저장 안정성 회복',
      destination: {
        tab: 'validation',
        validationFocus: 'errors',
      },
    });
  }

  if (inputDraftCount === 0) {
    actions.push({
      id: 'add_drafts_before_analysis',
      priority: 'now',
      title: '초안 먼저 추가',
      detail: '분석 가능한 초안이 없습니다. 최소 2개 이상의 AI 초안을 입력해야 선택안과 대안을 비교할 수 있습니다.',
      expectedImpact: 'Decision Block 생성 가능',
      destination: {
        tab: 'ideas',
      },
    });
  }

  if (sourceDraftsUsed < payloadDraftCount) {
    actions.push({
      id: 'recover_unused_drafts',
      priority: 'now',
      title: '반영되지 않은 초안 확인',
      detail: `${payloadDraftCount - sourceDraftsUsed}개 초안에서 아이디어가 추출되지 않았습니다. 초안 내용이 너무 짧거나 섹션 기준과 맞지 않는지 확인해야 합니다.`,
      expectedImpact: 'Source Coverage 개선',
      destination: {
        tab: 'quality',
      },
    });
  }

  if (reviewRatio >= 0.5) {
    actions.push({
      id: 'tighten_project_criteria',
      priority: 'now',
      title: '공통 기준을 더 구체화',
      detail: '검토 필요 Decision Block이 절반 이상입니다. MVP 범위, 제외 기능, 우선순위 기준을 더 명확히 적고 다시 분석하는 편이 좋습니다.',
      expectedImpact: '재분석 시 confidence와 자동 선택률 개선',
      destination: {
        tab: 'decisions',
        decisionFilter: 'needs_review',
      },
    });
  }

  sortByConflictLevel(conflictBlocks).slice(0, 3).forEach((block) => {
    const isHighConflict = block.conflictLevel === 'high';

    actions.push({
      id: `review_conflict_${block.id}`,
      priority: isHighConflict ? 'now' : 'next',
      title: isHighConflict ? '충돌 높은 결정 검토' : '충돌 있는 결정 확인',
      detail: '선택안과 대안이 동시에 성립하기 어렵습니다. 투표나 의견 요약을 먼저 보고 사람이 최종 선택해야 합니다.',
      expectedImpact: '잘못된 MVP 범위 확장 방지',
      target: `${sectionTitle(block.sectionKey)} · ${block.topic}`,
      destination: {
        tab: 'decisions',
        decisionBlockId: block.id,
        decisionFilter: 'conflicts',
      },
    });
  });

  if (missingSectionTitles.length > 0) {
    actions.push({
      id: 'fill_missing_sections',
      priority: 'next',
      title: '누락 섹션 보강',
      detail: `${missingSectionTitles.length}개 섹션 누락: ${missingSectionTitles.slice(0, 5).join(', ')}${missingSectionTitles.length > 5 ? ' 외' : ''}. 추가 작성이 필요합니다.`,
      expectedImpact: 'Section Coverage와 Document Completeness 개선',
      destination: {
        tab: 'validation',
        validationFocus: 'missing_sections',
      },
    });
  }

  lowConfidenceBlocks.slice(0, 3).forEach((block) => {
    actions.push({
      id: `review_low_confidence_${block.id}`,
      priority: 'next',
      title: '낮은 신뢰도 선택 재검토',
      detail: `AI confidence가 ${Math.round(block.confidence * 100)}%입니다. 출처 초안과 선택 이유가 실제 기준에 맞는지 확인하세요.`,
      expectedImpact: '선택 근거 품질 개선',
      target: `${sectionTitle(block.sectionKey)} · ${block.topic}`,
      destination: {
        tab: 'decisions',
        decisionBlockId: block.id,
        decisionFilter: 'low_confidence',
      },
    });
  });

  if (optionsMissingSources.length > 0) {
    actions.push({
      id: 'repair_option_sources',
      priority: 'next',
      title: '선택지 출처 연결 보강',
      detail: `${optionsMissingSources.length}개 선택지가 sourceIdeaIds를 갖지 않습니다. 출처 추적이 약하면 사용자 신뢰가 떨어집니다.`,
      expectedImpact: 'Option Traceability 개선',
      destination: {
        tab: 'decisions',
        decisionFilter: 'all',
      },
    });
  }

  if (finalSectionsWithContentCount === result.finalDocumentSections.length && actions.length === 0) {
    actions.push({
      id: 'approve_and_export',
      priority: 'later',
      title: '승인 후 공유',
      detail: '품질 지표가 안정적입니다. 충돌 항목만 최종 확인한 뒤 Markdown 또는 워크스페이스로 내보내면 됩니다.',
      expectedImpact: '사용자 테스트 가능한 산출물 확보',
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'manual_review_pass',
      priority: 'later',
      title: '사람 검토로 마무리',
      detail: '자동으로 감지된 큰 이슈는 없습니다. 최종 문장 톤과 실제 팀 합의 여부만 확인하면 됩니다.',
      expectedImpact: '최종 문서 품질 안정화',
    });
  }

  return actions;
}

function groupBySection<T extends { sectionKey: DocumentSectionKey }>(items: T[]) {
  const result = new Map<DocumentSectionKey, T[]>();

  items.forEach((item) => {
    const current = result.get(item.sectionKey) ?? [];
    current.push(item);
    result.set(item.sectionKey, current);
  });

  return result;
}

function sectionTitle(sectionKey: DocumentSectionKey) {
  return documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? sectionKey;
}

function sortByConflictLevel(blocks: PlanMergeAnalysisResult['decisionBlocks']) {
  const weight = {
    high: 3,
    medium: 2,
    low: 1,
    none: 0,
  };

  return [...blocks].sort((left, right) => weight[right.conflictLevel] - weight[left.conflictLevel]);
}

function conflictLevelLabel(level: PlanMergeAnalysisResult['decisionBlocks'][number]['conflictLevel']) {
  if (level === 'high') {
    return '높은';
  }

  if (level === 'medium') {
    return '중간';
  }

  if (level === 'low') {
    return '낮은';
  }

  return '없음';
}

// 차단 사유를 뭉뚱그리면 사용자는 엉뚱한 곳을 고치러 간다. 금지 방향 위반은
// 구조 오류와 성격이 달라서 따로 말해 준다.
function qualitySummary(level: QualityLevel, forbiddenSelectionCount: number) {
  if (forbiddenSelectionCount > 0) {
    return `선택안 ${forbiddenSelectionCount}건이 프로젝트가 금지한 방향을 제안하고 있어 내보낼 수 없습니다. 선택안을 바꾸거나 금지 방향 기준을 고쳐 주세요.`;
  }

  if (level === 'ready') {
    return '기본 구조, 근거 추적, 문서 완성도가 충분합니다. 충돌 항목만 확인하면 공유 가능한 상태입니다.';
  }

  if (level === 'review') {
    return '결과는 사용할 수 있지만 누락 섹션, 낮은 신뢰도, 충돌 항목을 먼저 검토해야 합니다.';
  }

  return '구조 오류 또는 근거 부족이 커서 실무 문서로 쓰기 전에 재분석이 필요합니다.';
}
