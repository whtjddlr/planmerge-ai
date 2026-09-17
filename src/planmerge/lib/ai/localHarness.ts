/**
 * 회귀 픽스처 전용 로컬 하네스.
 *
 * 제품 경로에서 호출하면 규칙 4 위반이다 — `scripts/`만 쓴다. 키워드 기반이라
 * 의미 판정을 못 하고, 그래서 픽스처를 만드는 데만 쓴다.
 */
import type { LocalDraftSubmission } from '../localWorkspace';
import { documentSectionDefinitions } from './protocolTypes';
import type {
  DocumentSectionKey,
  ForbiddenDirectionJudgement,
  NormalizedIdea,
  NormalizedIdeaIntent,
  NormalizedIdeaType,
  PlanMergeAnalysisPayload,
  PlanMergeAnalysisResult,
  ProtocolDecisionBlock,
  ProtocolDecisionOption,
} from './protocolTypes';
import { composedFromBlocks } from './protocolMigrations';
import { conflictsWithForbiddenDirection } from './protocolRepairs';

/**
 * 로컬 하네스 전용 키워드 휴리스틱.
 *
 * 회귀 케이스가 결정적인 입력을 만들 때만 쓴다. 제품 경로에서는 절대 호출하지 않는다.
 * 아래 그룹에 없는 금지 방향은 감지하지 못하며, 그것이 v0.2에서 이 판정을 모델로
 * 옮긴 이유다.
 */
export function judgeForbiddenDirectionByKeywords(
  forbiddenDirection: string,
  idea: Omit<NormalizedIdea, 'forbiddenDirectionConflict'>,
): ForbiddenDirectionJudgement {
  if (idea.intent === 'warn') {
    return {
      conflicts: false,
      reason: '리스크를 경고하는 의견이므로 금지 방향 제안으로 보지 않습니다.',
      evidence: '',
    };
  }

  const haystack = `${idea.topic} ${idea.normalizedText} ${idea.sourceExcerpt}`.toLowerCase();
  const forbidden = forbiddenDirection.toLowerCase();
  const reversesDeferral = [
    '포함하지 않으면 안',
    '제외하면 안',
    '미루면 안',
    '검증 이후가 아니라',
    '후속 단계가 아니라',
  ].some((phrase) => haystack.includes(phrase));
  const explicitlyDefersOrExcludes = !reversesDeferral && [
    '포함하지 않',
    '제외하',
    '지원하지 않',
    '연동하지 않',
    '검증 이후',
    '후속 단계',
    '나중에 추가',
    '범위 밖',
  ].some((phrase) => haystack.includes(phrase));

  // 금지 키워드를 언급하더라도 명시적으로 제외하거나 뒤로 미루는 제안은
  // 금지 방향을 지키는 근거다. 단순 키워드 교집합만으로 이를 충돌로 처리하면
  // 안전한 선택안조차 Decision Resolution에서 사용할 수 없게 된다.
  if (explicitlyDefersOrExcludes) {
    return {
      conflicts: false,
      reason: '금지 방향을 명시적으로 제외하거나 후속 단계로 미루는 제안입니다.',
      evidence: '',
    };
  }

  const keywordGroups = [
    ['실시간 공동 편집', '공동 편집'],
    ['외부 문서 연동', '문서 연동', 'notion'],
    // '공유'를 Slack의 동의어로 묶으면 "공유 가능한 정리본으로 내보낸다"가
    // Slack 연동 제안으로 오탐된다. 제품 코드가 아니라 픽스처라도 틀린 등가는 두지 않는다.
    ['slack'],
    ['notion'],
    ['팀 초대', '초대'],
    ['연동'],
  ];

  const conflicts = keywordGroups.some((keywords) =>
    keywords.some((keyword) => forbidden.includes(keyword.toLowerCase())) &&
    keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
  );

  return {
    conflicts,
    reason: conflicts
      ? '하네스 키워드 규칙이 금지 방향과 겹치는 제안으로 분류했습니다. 의미 기반 판정이 아니므로 사람 검토가 필요합니다.'
      : '하네스 키워드 규칙에서 금지 방향과 겹치는 표현을 찾지 못했습니다. 의미 기반 판정이 아니므로 사람 검토가 필요합니다.',
    evidence: conflicts ? idea.sourceExcerpt : '',
  };
}

export function runLocalPlanMergeHarness(payload: PlanMergeAnalysisPayload): PlanMergeAnalysisResult {
  const normalizedIdeas = payload.drafts
    .filter((draft) => draft.rawText.trim())
    .map((draft, index) => createLocalNormalizedIdea(payload.project.forbiddenDirection, draft, index));

  const decisionBlocks = createLocalDecisionBlocks(payload.project.forbiddenDirection, normalizedIdeas);
  const finalDocumentSections = documentSectionDefinitions
    .map((section) => {
      const relatedBlocks = decisionBlocks.filter((block) => block.sectionKey === section.key);
      const selectedContents = relatedBlocks
        .map((block) => block.options.find((option) => option.id === block.selectedOptionId)?.content)
        .filter((content): content is string => Boolean(content));

      return {
        sectionKey: section.key,
        title: section.title,
        content: selectedContents.join(' ') || '',
        sourceDecisionBlockIds: relatedBlocks.map((block) => block.id),
        composedFrom: composedFromBlocks(relatedBlocks),
      };
    })
    .filter((section) => section.content);

  const coveredSections = new Set(finalDocumentSections.map((section) => section.sectionKey));
  const missingSections = documentSectionDefinitions
    .map((section) => section.key)
    .filter((sectionKey) => !coveredSections.has(sectionKey));

  return {
    protocolVersion: '0.4',
    source: 'local_harness',
    normalizedIdeas,
    decisionBlocks,
    finalDocumentSections,
    missingSections,
    warnings: [
      '로컬 하네스 결과입니다. 실제 모델 호출 전 구조 검증과 화면 연결 확인에 사용합니다.',
    ],
  };
}

function createLocalNormalizedIdea(
  forbiddenDirection: string,
  draft: LocalDraftSubmission,
  index: number,
): NormalizedIdea {
  const sectionKey = inferSectionKey(`${draft.taskTitle} ${draft.rawText}`);
  const excerpt = draft.rawText.slice(0, 180);
  const trimmedRawText = draft.rawText.trim();
  // 원문 근거가 40자 미만이면 빈약한 증거로 보고 낮은 신뢰도를 부여한다.
  const confidence = trimmedRawText.length < 40 ? 0.58 : 0.72;

  const idea = {
    id: `idea_${index + 1}`,
    sourceDraftId: draft.id,
    sourceModel: draft.aiModel,
    sourceExcerpt: excerpt,
    sectionKey,
    topic: inferTopic(sectionKey),
    ideaType: inferIdeaType(sectionKey),
    normalizedText: normalizeSentence(excerpt),
    intent: inferIntent(sectionKey, draft.rawText),
    confidence,
  };

  return {
    ...idea,
    forbiddenDirectionConflict: judgeForbiddenDirectionByKeywords(forbiddenDirection, idea),
  };
}

function createLocalDecisionBlocks(forbiddenDirection: string, ideas: NormalizedIdea[]): ProtocolDecisionBlock[] {
  const ideasBySection = new Map<DocumentSectionKey, NormalizedIdea[]>();

  ideas.forEach((idea) => {
    ideasBySection.set(idea.sectionKey, [...(ideasBySection.get(idea.sectionKey) ?? []), idea]);
  });

  return Array.from(ideasBySection.entries()).map(([sectionKey, sectionIdeas], index) => {
    const selectedIdea = chooseSelectedIdea(sectionIdeas);
    const options = sectionIdeas.map((idea, optionIndex) => {
      const optionType = idea.id === selectedIdea.id
        ? 'selected'
        : conflictsWithForbiddenDirection(idea)
          ? 'conflict'
          : 'alternative';

      return {
        id: `option_${index + 1}_${optionIndex + 1}`,
        optionType,
        content: idea.normalizedText,
        differenceFromSelected: idea.id === selectedIdea.id ? undefined : `${selectedIdea.normalizedText}와 판단 방향이 다릅니다.`,
        severity: optionType === 'conflict' ? inferConflictSeverity(idea) : undefined,
        sourceIdeaIds: [idea.id],
      } satisfies ProtocolDecisionOption;
    });

    const conflictOptions = options.filter((option) => option.optionType === 'conflict');
    const confidence = clamp(selectedIdea.confidence, 0.55, conflictOptions.length ? 0.68 : 0.78);

    return {
      id: `decision_${index + 1}`,
      sectionKey,
      topic: inferTopic(sectionKey),
      selectedOptionId: options.find((option) => option.optionType === 'selected')?.id ?? options[0].id,
      selectionReason: '로컬 폴백 규칙으로 금지 방향과 충돌하지 않는 첫 번째 아이디어를 선택했습니다. 실제 기준 부합 여부는 사람이 확인해야 합니다.',
      // 하네스도 병합 단계를 대신하는 것이므로 출처는 merge다.
      selectionSource: 'merge',
      confidence,
      conflictLevel: conflictOptions.length ? 'medium' : 'none',
      // A lexical fallback cannot establish semantic agreement or preference.
      // Its first-option selection is provisional even when no conflict was detected.
      needsHumanReview: true,
      options,
    };
  });
}

function chooseSelectedIdea(ideas: NormalizedIdea[]) {
  return ideas.find((idea) => !conflictsWithForbiddenDirection(idea)) ?? ideas[0];
}

function inferSectionKey(text: string): DocumentSectionKey {
  const lowerText = text.toLowerCase();

  if (containsAny(lowerText, ['미결정 사항', 'open question', 'open questions'])) return 'open_questions';
  if (containsAny(lowerText, ['사용자 플로우', 'user flow'])) return 'user_flow';
  if (containsAny(lowerText, ['사용자 pain point', 'pain point', 'painpoint'])) return 'pain_points';
  if (containsAny(lowerText, ['성공 지표', 'success metric', 'success metrics'])) return 'success_metrics';
  if (containsAny(lowerText, ['요구사항', 'requirements'])) return 'requirements';
  if (containsAny(lowerText, ['핵심 기능', 'core feature', 'core features'])) return 'core_features';
  if (containsAny(lowerText, ['솔루션', 'solution'])) return 'solution';
  if (containsAny(lowerText, ['타깃 사용자', 'target user', 'target users'])) return 'target_user';
  if (containsAny(lowerText, ['문제 정의', 'problem definition'])) return 'problem';
  if (containsAny(lowerText, ['서비스 개요', '개요:', 'overview'])) return 'overview';
  if (containsAny(lowerText, ['mvp', '범위', 'scope', '연동', '공동 편집'])) return 'mvp_scope';
  if (containsAny(lowerText, ['플로우', '흐름', 'flow'])) return 'user_flow';
  if (containsAny(lowerText, ['지표', 'metric', '성공'])) return 'success_metrics';
  if (containsAny(lowerText, ['질문', '미정', '논의'])) return 'open_questions';
  if (containsAny(lowerText, ['요구', 'requirement'])) return 'requirements';
  if (containsAny(lowerText, ['리스크', '위험', '신뢰', 'hallucination', '출처'])) return 'risks';
  if (containsAny(lowerText, ['문제', '중복', '충돌', '누락'])) return 'problem';
  if (containsAny(lowerText, ['pain', '불편', '어렵', '시간'])) return 'pain_points';
  if (containsAny(lowerText, ['솔루션', '해결'])) return 'solution';
  if (containsAny(lowerText, ['기능', 'feature'])) return 'core_features';
  if (containsAny(lowerText, ['타깃', '사용자', '고객', '팀'])) return 'target_user';

  return 'overview';
}

function inferTopic(sectionKey: DocumentSectionKey) {
  switch (sectionKey) {
    case 'mvp_scope':
      return '초기 기능 범위';
    case 'risks':
      return 'AI 판단 신뢰성';
    case 'problem':
      return '초안 병합 문제';
    case 'target_user':
      return '초기 타깃 사용자';
    case 'core_features':
      return '핵심 기능 구성';
    default:
      return documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? '섹션 요약';
  }
}

function inferIdeaType(sectionKey: DocumentSectionKey): NormalizedIdeaType {
  switch (sectionKey) {
    case 'problem':
      return 'problem';
    case 'target_user':
      return 'target_user';
    case 'core_features':
      return 'feature';
    case 'mvp_scope':
      return 'scope';
    case 'requirements':
      return 'requirement';
    case 'success_metrics':
      return 'metric';
    case 'risks':
      return 'risk';
    case 'open_questions':
      return 'open_question';
    case 'user_flow':
      return 'flow';
    case 'solution':
      return 'solution';
    default:
      return 'requirement';
  }
}

function inferIntent(sectionKey: DocumentSectionKey, text: string): NormalizedIdeaIntent {
  if (sectionKey === 'risks') return 'warn';
  if (sectionKey === 'open_questions') return 'question';
  if (containsAny(text.toLowerCase(), ['필수', '반드시', '해야'])) return 'require';
  if (containsAny(text.toLowerCase(), ['가정', '전제'])) return 'assume';
  return 'propose';
}

function inferConflictSeverity(idea: NormalizedIdea): 'low' | 'medium' | 'high' {
  const lowerText = idea.normalizedText.toLowerCase();

  if (containsAny(lowerText, ['실시간 공동 편집', '나중에 하자'])) return 'high';
  if (containsAny(lowerText, ['notion', '노션', 'slack', '슬랙'])) return 'medium';
  return 'low';
}

function normalizeSentence(text: string) {
  const trimmed = text.replace(/\s+/g, ' ').trim();

  if (!trimmed) {
    return '초안에서 구체 내용이 충분히 확인되지 않았습니다.';
  }

  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
