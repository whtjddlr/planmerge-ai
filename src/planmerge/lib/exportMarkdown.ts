import type { DocumentSectionData } from '../data/mergeResult';
import type { LocalDraftSubmission, ProjectSettings } from './localWorkspace';
import {
  documentSectionDefinitions,
  type DocumentSectionKey,
  type PlanMergeAnalysisResult,
  type ProtocolDecisionOption,
} from '@/planmerge/lib/ai/planmergeProtocol';
import { evaluateAnalysisQuality, type AnalysisQualityReport, type QualityLevel } from './analysisQuality';
import { evaluatePublicationReadiness, type PublicationReadiness } from './publicationReadiness';

type BuildMarkdownExportInput = {
  project: ProjectSettings;
  drafts: LocalDraftSubmission[];
  sections: DocumentSectionData[];
  analysisResult?: PlanMergeAnalysisResult;
  approvedBlockIds?: string[];
};

const documentTypeLabels: Record<ProjectSettings['documentType'], string> = {
  service_plan: '서비스 기획서',
  prd: 'PRD',
  business_plan: '사업 계획서',
  feature_spec: '기능 명세서',
};

const sectionTitlesByKey = new Map<DocumentSectionKey, string>(
  documentSectionDefinitions.map((section) => [section.key, section.title] as const),
);

export function buildMarkdownExport({
  project,
  drafts,
  sections,
  analysisResult,
  approvedBlockIds = [],
}: BuildMarkdownExportInput) {
  const documentTitle = project.title.trim() || 'AI 공동 기획서 병합 도구';
  const normalizedAnalysisResult = analysisResult
    ? normalizeAnalysisForExport(analysisResult)
    : undefined;
  const qualityReport = normalizedAnalysisResult
    ? evaluateAnalysisQuality({ project, drafts }, normalizedAnalysisResult, approvedBlockIds)
    : undefined;
  const publicationReadiness = evaluatePublicationReadiness({
    analysisResult: normalizedAnalysisResult,
    approvedBlockIds,
    qualityLevel: qualityReport?.level ?? null,
  });

  return [
    `# ${documentTitle}`,
    '',
    'PlanMerge가 여러 AI 초안을 하나의 검토 가능한 기획 산출물로 병합한 결과입니다.',
    '',
    ...formatExecutiveSummary(
      project,
      drafts,
      sections,
      normalizedAnalysisResult,
      qualityReport,
      publicationReadiness,
    ),
    ...formatProjectCriteria(project),
    ...formatFinalDocument(sections),
    ...formatQualityGate(qualityReport, publicationReadiness),
    ...formatDraftSummary(drafts),
    ...formatDecisionEvidence(normalizedAnalysisResult, approvedBlockIds),
    ...formatFollowUpItems(normalizedAnalysisResult, qualityReport),
    '---',
    '',
    `생성 정보: PlanMerge export · ${new Date().toLocaleString('ko-KR')}`,
    '',
  ].join('\n');
}

function normalizeAnalysisForExport(analysisResult: PlanMergeAnalysisResult): PlanMergeAnalysisResult {
  return {
    ...analysisResult,
    warnings: normalizeWarningList(analysisResult.warnings as unknown),
  };
}

function normalizeWarningList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(formatWarningText);
}

function formatExecutiveSummary(
  project: ProjectSettings,
  drafts: LocalDraftSubmission[],
  sections: DocumentSectionData[],
  analysisResult: PlanMergeAnalysisResult | undefined,
  qualityReport: AnalysisQualityReport | undefined,
  publicationReadiness: PublicationReadiness,
) {
  const completedSections = sections.filter((section) => section.content.trim()).length;
  const qualityLine = qualityReport
    ? `${qualityReport.score}점 · ${qualityLevelLabel(qualityReport.level)}`
    : '분석 전';

  return [
    '## 1. 실행 요약',
    '',
    `- 문서 타입: ${documentTypeLabels[project.documentType]}`,
    `- 입력 초안: ${drafts.length}개`,
    `- 분석 출처: ${analysisResult ? analysisSourceLabel(analysisResult.source) : '분석 전'}`,
    `- 완성 섹션: ${completedSections}/${sections.length}`,
    `- 문서 품질: ${qualityLine}`,
    `- 공유 상태: ${publicationReadiness.label}`,
    `- 검토 완료: ${publicationReadiness.approvedCount}/${publicationReadiness.requiredCount}`,
    `- 남은 결정: ${publicationReadiness.unresolvedCount}개`,
    `- 결정 블록: ${analysisResult?.decisionBlocks.length ?? 0}개`,
    `- 다음 조치: ${publicationReadiness.canShare
      ? '최종본 내보내기 또는 공유'
      : qualityReport?.nextActions[0]?.title ?? publicationReadiness.detail}`,
    '',
  ];
}

function formatProjectCriteria(project: ProjectSettings) {
  return [
    '## 2. 프로젝트 기준',
    '',
    `- 목표: ${inlineOrFallback(project.goal, '입력 없음')}`,
    `- 공통 배경: ${inlineOrFallback(project.contextPack, '입력 없음')}`,
    `- 제외 범위: ${inlineOrFallback(project.forbiddenDirection, '입력 없음')}`,
    `- 출력 스타일: ${inlineOrFallback(project.outputStyle, '입력 없음')}`,
    '',
  ];
}

function formatFinalDocument(sections: DocumentSectionData[]) {
  const completedSections = sections.filter((section) => section.content.trim());
  const missingSections = sections.filter((section) => !section.content.trim());

  return [
    '## 3. 최종 기획서',
    '',
    ...(completedSections.length
      ? completedSections.flatMap((section) => [
      `### ${section.number}. ${section.title}`,
      '',
      sanitizeMultilineContent(section.content),
      '',
      ])
      : ['작성된 최종 문서 섹션이 없습니다.', '']),
    ...(missingSections.length
      ? [
        '### 보완 필요 섹션',
        '',
        ...missingSections.map((section) => `- ${section.number}. ${section.title}: ${sectionStatusFallback(section.status)}`),
        '',
      ]
      : []),
  ];
}

function formatQualityGate(
  qualityReport: AnalysisQualityReport | undefined,
  publicationReadiness: PublicationReadiness,
) {
  if (!qualityReport) {
    return [
      '## 4. 품질 및 공유 게이트',
      '',
      '아직 분석 결과가 없어 품질 점수를 계산하지 않았습니다.',
      '',
    ];
  }

  return [
    '## 4. 품질 및 공유 게이트',
    '',
    `- 문서 품질: ${qualityReport.score}점 · ${qualityLevelLabel(qualityReport.level)}`,
    `- 공유 상태: ${publicationReadiness.label}`,
    `- 결정 검토: ${publicationReadiness.approvedCount}/${publicationReadiness.requiredCount} 완료`,
    `- 남은 결정: ${publicationReadiness.unresolvedCount}개`,
    `- 요약: ${qualityReport.summary}`,
    '',
    '| 지표 | 점수 | 상태 | 설명 |',
    '| --- | ---: | --- | --- |',
    ...qualityReport.metrics.map((metric) =>
      `| ${tableCell(metric.label)} | ${metric.score}% | ${qualityLevelLabel(metric.status)} | ${tableCell(metric.helpText)} |`),
    '',
    '### 다음 조치',
    '',
    ...qualityReport.nextActions.map((action, index) => [
      `${index + 1}. ${action.title}`,
      `   - 우선순위: ${actionPriorityLabel(action.priority)}`,
      `   - 설명: ${action.detail}`,
      `   - 기대 효과: ${action.expectedImpact}`,
      ...(action.target ? [`   - 대상: ${action.target}`] : []),
    ].join('\n')),
    '',
  ];
}

function formatDraftSummary(drafts: LocalDraftSubmission[]) {
  if (!drafts.length) {
    return [
      '## 5. 입력 초안',
      '',
      '입력된 초안이 없습니다.',
      '',
    ];
  }

  return [
    '## 5. 입력 초안',
    '',
    '| 작성자 | 사용 AI | 주제 | 상태 |',
    '| --- | --- | --- | --- |',
    ...drafts.map((draft) =>
      `| ${tableCell(draft.authorName)} | ${tableCell(draft.aiModel)} | ${tableCell(draft.taskTitle)} | ${draftStatusLabel(draft.status)} |`),
    '',
  ];
}

function formatDecisionEvidence(
  analysisResult: PlanMergeAnalysisResult | undefined,
  approvedBlockIds: string[],
) {
  if (!analysisResult) {
    return [
      '## 6. 결정 근거',
      '',
      '아직 분석 결과가 없어 결정 근거가 없습니다.',
      '',
    ];
  }

  const ideasById = new Map(analysisResult.normalizedIdeas.map((idea) => [idea.id, idea] as const));
  const approvedBlockIdSet = new Set(approvedBlockIds);

  return [
    '## 6. 결정 근거',
    '',
    ...analysisResult.decisionBlocks.flatMap((block, index) => {
      const selectedOption = block.options.find((option) => option.id === block.selectedOptionId);
      const alternativeOptions = block.options.filter((option) =>
        option.optionType === 'alternative' || option.optionType === 'conflict',
      );

      return [
        `### ${index + 1}. ${sectionTitle(block.sectionKey)} · ${block.topic}`,
        '',
        `- 선택안: ${inlineOrFallback(selectedOption?.content, '선택안 없음')}`,
        `- 선택 이유: ${inlineOrFallback(block.selectionReason, '선택 이유 없음')}`,
        `- 신뢰도: ${Math.round(block.confidence * 100)}%`,
        `- 승인 상태: ${approvedBlockIdSet.has(block.id) ? '사람 승인 완료' : block.needsHumanReview ? '사람 검토 필요' : '자동 선택'}`,
        `- 충돌 수준: ${conflictLevelLabel(block.conflictLevel)}`,
        '',
        '#### 대안과 충돌 의견',
        '',
        ...formatAlternativeOptions(alternativeOptions),
        '',
        '#### 원문 근거',
        '',
        ...block.options.flatMap((option) => formatOptionSources(option, ideasById)),
        '',
      ];
    }),
  ];
}

function formatFollowUpItems(
  analysisResult: PlanMergeAnalysisResult | undefined,
  qualityReport: AnalysisQualityReport | undefined,
) {
  const missingSections = analysisResult?.missingSections ?? [];
  const warnings = (analysisResult?.warnings ?? []) as unknown[];
  const findings = qualityReport?.findings ?? [];

  if (!missingSections.length && !warnings.length && !findings.length) {
    return [
      '## 7. 보완 항목',
      '',
      '즉시 보완해야 할 항목이 없습니다.',
      '',
    ];
  }

  return [
    '## 7. 보완 항목',
    '',
    ...(missingSections.length
      ? [
        '### 누락 섹션',
        '',
        ...missingSections.map((sectionKey) => `- ${sectionTitle(sectionKey)}`),
        '',
      ]
      : []),
    ...(warnings.length
      ? [
        '### 분석 경고',
        '',
        ...warnings.map((warning) => `- ${formatWarningText(warning)}`),
        '',
      ]
      : []),
    ...(findings.length
      ? [
        '### 품질 점검 메모',
        '',
        ...findings.map((finding) => [
          `- ${finding.title}: ${finding.detail}`,
          ...(finding.target ? [`  - 대상: ${finding.target}`] : []),
        ].join('\n')),
        '',
      ]
      : []),
  ];
}

function formatAlternativeOptions(options: ProtocolDecisionOption[]) {
  if (!options.length) {
    return ['- 대안 또는 충돌 의견 없음'];
  }

  return options.flatMap((option) => [
    `- ${optionTypeLabel(option.optionType)}: ${inlineOrFallback(option.content, '내용 없음')}`,
    `  - 선택안과 차이: ${inlineOrFallback(option.differenceFromSelected, '차이 설명 없음')}`,
    ...(option.severity ? [`  - 심각도: ${severityLabel(option.severity)}`] : []),
  ]);
}

function formatOptionSources(
  option: ProtocolDecisionOption,
  ideasById: Map<string, PlanMergeAnalysisResult['normalizedIdeas'][number]>,
) {
  return [
    `- ${optionTypeLabel(option.optionType)}: ${truncateInlineText(option.content, 56)}`,
    ...option.sourceIdeaIds.map((ideaId) => {
      const idea = ideasById.get(ideaId);

      if (!idea) {
        return `  - ${ideaId}: 출처 아이디어를 찾지 못했습니다.`;
      }

      return `  - ${idea.sourceModel}: ${normalizeInlineText(idea.sourceExcerpt)}`;
    }),
  ];
}

function sectionTitle(sectionKey: DocumentSectionKey | string) {
  return sectionTitlesByKey.get(sectionKey as DocumentSectionKey) ?? sectionKey;
}

function optionTypeLabel(optionType: ProtocolDecisionOption['optionType']) {
  if (optionType === 'selected') {
    return '선택안';
  }

  if (optionType === 'conflict') {
    return '충돌 의견';
  }

  return '대안';
}

function conflictLevelLabel(level: PlanMergeAnalysisResult['decisionBlocks'][number]['conflictLevel']) {
  if (level === 'high') {
    return '높음';
  }

  if (level === 'medium') {
    return '보통';
  }

  if (level === 'low') {
    return '낮음';
  }

  return '없음';
}

function severityLabel(severity: NonNullable<ProtocolDecisionOption['severity']>) {
  if (severity === 'high') {
    return '높음';
  }

  if (severity === 'medium') {
    return '보통';
  }

  return '낮음';
}

function qualityLevelLabel(level: QualityLevel) {
  if (level === 'ready') {
    return '양호';
  }

  if (level === 'review') {
    return '보완 필요';
  }

  return '차단';
}

function analysisSourceLabel(source: PlanMergeAnalysisResult['source']) {
  if (source === 'gms') {
    return 'GMS';
  }

  if (source === 'gemini') {
    return 'Gemini';
  }

  if (source === 'solar') {
    return 'Solar';
  }

  return '로컬 검증';
}

function actionPriorityLabel(priority: AnalysisQualityReport['nextActions'][number]['priority']) {
  if (priority === 'now') {
    return '지금 처리';
  }

  if (priority === 'next') {
    return '다음 처리';
  }

  return '나중에';
}

function draftStatusLabel(status: LocalDraftSubmission['status']) {
  if (status === 'parsed') {
    return '분석 반영';
  }

  if (status === 'failed') {
    return '처리 실패';
  }

  return '저장됨';
}

function sectionStatusFallback(status: DocumentSectionData['status']) {
  if (status === 'pending') {
    return '이 섹션은 아직 작성되지 않았습니다.';
  }

  if (status === 'review') {
    return '이 섹션은 사람 검토가 필요합니다.';
  }

  if (status === 'conflict') {
    return '이 섹션에는 충돌 의견이 남아 있습니다.';
  }

  return '내용 없음';
}

function inlineOrFallback(text: string | undefined, fallback: string) {
  const normalized = normalizeInlineText(text ?? '');
  return normalized || fallback;
}

function formatWarningText(warning: unknown) {
  if (typeof warning === 'string') {
    return normalizeInlineText(warning);
  }

  if (typeof warning === 'object' && warning !== null && !Array.isArray(warning)) {
    const record = warning as Record<string, unknown>;
    const type = typeof record.type === 'string' && record.type.trim()
      ? `[${record.type.trim()}] `
      : '';
    const message = typeof record.message === 'string' && record.message.trim()
      ? record.message.trim()
      : JSON.stringify(record);

    return normalizeInlineText(`${type}${message}`);
  }

  return normalizeInlineText(String(warning));
}

function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function sanitizeMultilineContent(text: string) {
  return text
    .split('\n')
    .map((line) => {
      const lineContent = line.endsWith('\r') ? line.slice(0, -1) : line;
      const lineEnding = line.endsWith('\r') ? '\r' : '';

      if (lineContent.startsWith('#') || /^[-=_]{3,}$/.test(lineContent)) {
        return `\\${lineContent}${lineEnding}`;
      }

      return line;
    })
    .join('\n');
}

function tableCell(text: string) {
  return normalizeInlineText(text).replace(/\|/g, '\\|') || '-';
}

function truncateInlineText(text: string, maxLength: number) {
  const normalized = normalizeInlineText(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}
