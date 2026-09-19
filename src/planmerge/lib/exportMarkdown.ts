import type { DocumentSectionData } from '../data/mergeResult';
import {
  documentSectionDefinitions,
  type DocumentSectionKey,
  type PlanMergeAnalysisResult,
  type ProtocolDecisionOption,
} from '@/planmerge/lib/ai/planmergeProtocol';

type BuildMarkdownExportInput = {
  projectTitle: string;
  sections: DocumentSectionData[];
  analysisResult?: PlanMergeAnalysisResult;
};

// 화면에 보이는 섹션은 이미 타입별 제목을 들고 있다. 여기서는 그 목록에 없는 키
// (저장된 옛 결과 등)만 기본 제목으로 메운다.
const defaultSectionTitlesByKey = new Map<DocumentSectionKey, string>(
  documentSectionDefinitions.map((section) => [section.key, section.title] as const),
);

export function buildMarkdownExport({
  projectTitle,
  sections,
  analysisResult,
}: BuildMarkdownExportInput) {
  const documentTitle = projectTitle.trim() || 'AI 공동 기획서 병합 도구';
  const finalDocument = [
    `# ${documentTitle} 기획서`,
    '',
    ...sections.map((section) => [
      `## ${section.number}. ${section.title}`,
      '',
      sanitizeMultilineContent(section.content || '내용 없음'),
      '',
    ].join('\n')),
  ].join('\n');

  if (!analysisResult) {
    return finalDocument;
  }

  const ideasById = new Map(analysisResult.normalizedIdeas.map((idea) => [idea.id, idea] as const));
  const decisionBlocks = analysisResult.decisionBlocks.flatMap((block) => {
    const selectedOption = block.options.find((option) => option.id === block.selectedOptionId);
    const alternativeOptions = block.options.filter((option) =>
      option.optionType === 'alternative' || option.optionType === 'conflict',
    );

    return [
      `### ${sectionTitle(block.sectionKey)} · ${block.topic}`,
      '',
      '- 선택안: ' + sanitizeMultilineContent(selectedOption?.content ?? '선택안 없음'),
      `- 선택 이유: ${block.selectionReason}`,
      `- 신뢰도: ${Math.round(block.confidence * 100)}%`,
      ...(block.conflictLevel !== 'none' ? [`- 충돌 수준: ${conflictLevelLabel(block.conflictLevel)}`] : []),
      ...(block.needsHumanReview ? ['- ⚠ 사람 검토 필요'] : []),
      '',
      '#### 대안/충돌 옵션',
      '',
      ...formatAlternativeOptions(alternativeOptions),
      '',
      '#### 출처',
      '',
      ...block.options.flatMap((option) => formatOptionSources(option, ideasById)),
      '',
    ];
  });
  const warningSection = analysisResult.warnings.length
    ? [
      '## 분석 경고',
      '',
      ...analysisResult.warnings.map((warning) => `- ${warning}`),
      '',
    ]
    : [];

  return [
    finalDocument,
    '',
    '---',
    '',
    '## 의사결정 기록',
    '',
    ...decisionBlocks,
    ...warningSection,
  ].join('\n');
}

function formatAlternativeOptions(options: ProtocolDecisionOption[]) {
  if (!options.length) {
    return ['- 없음'];
  }

  return options.flatMap((option) => [
    `- ${optionTypeLabel(option.optionType)}: ${sanitizeMultilineContent(option.content)}`,
    `  - 선택안과 차이: ${option.differenceFromSelected ?? '차이 설명 없음'}`,
    ...(option.severity ? [`  - 심각도: ${severityLabel(option.severity)}`] : []),
  ]);
}

function formatOptionSources(
  option: ProtocolDecisionOption,
  ideasById: Map<string, PlanMergeAnalysisResult['normalizedIdeas'][number]>,
) {
  return [
    `- ${optionTypeLabel(option.optionType)}: ${truncateInlineText(option.content, 40)}`,
    ...option.sourceIdeaIds.map((ideaId) => {
      const idea = ideasById.get(ideaId);

      if (!idea) {
        return `  - ${ideaId}: 출처 아이디어를 찾지 못했습니다.`;
      }

      return `  - ${idea.sourceModel}: ${normalizeInlineText(idea.sourceExcerpt)}`;
    }),
  ];
}

function sectionTitle(sectionKey: DocumentSectionKey) {
  return defaultSectionTitlesByKey.get(sectionKey) ?? sectionKey;
}

function optionTypeLabel(optionType: ProtocolDecisionOption['optionType']) {
  if (optionType === 'selected') {
    return '선택안';
  }

  if (optionType === 'conflict') {
    return '충돌';
  }

  return '대안';
}

function conflictLevelLabel(level: PlanMergeAnalysisResult['decisionBlocks'][number]['conflictLevel']) {
  if (level === 'high') {
    return '높음';
  }

  if (level === 'medium') {
    return '중간';
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
    return '중간';
  }

  return '낮음';
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

function truncateInlineText(text: string, maxLength: number) {
  const normalized = normalizeInlineText(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
}
