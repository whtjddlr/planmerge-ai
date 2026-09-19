/**
 * PlanMerge 프로토콜 v0.4의 타입과 섹션 정의.
 *
 * 값을 만들거나 검증하는 코드는 없다. 여기 있는 것은 "무엇이 결과인가"의 정의다.
 * 다른 모듈은 전부 이 파일을 import하고, 이 파일은 워크스페이스 타입만 import한다.
 */
import type { LocalDraftSubmission, ProjectSettings } from '../localWorkspace';

/**
 * 섹션 키 풀 — 모든 기획서 타입이 쓰는 키의 전체 집합.
 *
 * 여기 있는 제목은 **기본값**이다. 실제 문서의 섹션 목록과 제목은 기획서 타입이
 * 정한다(`documentSchemes`). 같은 키라도 PRD에서는 "출시 범위", 서비스 기획서에서는
 * "MVP 범위"로 부른다 — 다루는 내용이 같아서 키를 나누지 않는다.
 *
 * 한때 이 목록 12개가 전부였고 `documentType`은 분석 어디에도 들어가지 않았다. PRD를
 * 골라도 서비스 기획서용 12섹션으로 병합됐다 — 선택지가 있는데 아무 일도 하지 않는
 * 화면이었다.
 */
export const documentSectionDefinitions = [
  { key: 'overview', title: '개요', sortOrder: 1 },
  { key: 'problem', title: '문제 정의', sortOrder: 2 },
  { key: 'market', title: '시장·고객', sortOrder: 3 },
  { key: 'target_user', title: '타깃 사용자', sortOrder: 4 },
  { key: 'pain_points', title: '사용자 Pain Point', sortOrder: 5 },
  { key: 'solution', title: '솔루션', sortOrder: 6 },
  { key: 'competition', title: '경쟁·차별화', sortOrder: 7 },
  { key: 'business_model', title: '수익 모델', sortOrder: 8 },
  { key: 'go_to_market', title: '진입 전략', sortOrder: 9 },
  { key: 'core_features', title: '핵심 기능', sortOrder: 10 },
  { key: 'non_goals', title: '비목표', sortOrder: 11 },
  { key: 'mvp_scope', title: 'MVP 범위', sortOrder: 12 },
  { key: 'user_flow', title: '사용자 플로우', sortOrder: 13 },
  { key: 'edge_cases', title: '엣지 케이스·오류', sortOrder: 14 },
  { key: 'data_interface', title: '데이터·인터페이스', sortOrder: 15 },
  { key: 'requirements', title: '요구사항', sortOrder: 16 },
  { key: 'success_metrics', title: '성공 지표', sortOrder: 17 },
  { key: 'team_ops', title: '운영·팀', sortOrder: 18 },
  { key: 'milestones', title: '마일스톤', sortOrder: 19 },
  { key: 'risks', title: '리스크', sortOrder: 20 },
  { key: 'open_questions', title: '미결정 사항', sortOrder: 21 },
] as const;

export type DocumentSectionKey = typeof documentSectionDefinitions[number]['key'];

export type DocumentSectionDefinition = {
  key: DocumentSectionKey;
  title: string;
  sortOrder: number;
};

/**
 * 기획서 타입별 섹션 체계.
 *
 * 순서가 문서의 순서이고, 제목이 화면과 내보내기에 그대로 쓰인다. 키를 재사용하는
 * 이유는 같은 내용을 다루기 때문이다 — PRD의 "출시 범위"와 서비스 기획서의 "MVP 범위"를
 * 다른 키로 두면 정규화 모델이 둘을 구분할 근거가 없다.
 */
const documentSchemeDefinitions: Record<ProjectSettings['documentType'], { key: DocumentSectionKey; title: string }[]> = {
  service_plan: [
    { key: 'overview', title: '개요' },
    { key: 'problem', title: '문제 정의' },
    { key: 'target_user', title: '타깃 사용자' },
    { key: 'pain_points', title: '사용자 Pain Point' },
    { key: 'solution', title: '솔루션' },
    { key: 'core_features', title: '핵심 기능' },
    { key: 'mvp_scope', title: 'MVP 범위' },
    { key: 'user_flow', title: '사용자 플로우' },
    { key: 'requirements', title: '요구사항' },
    { key: 'success_metrics', title: '성공 지표' },
    { key: 'risks', title: '리스크' },
    { key: 'open_questions', title: '미결정 사항' },
  ],
  prd: [
    { key: 'overview', title: '배경과 목표' },
    { key: 'non_goals', title: '비목표' },
    { key: 'target_user', title: '사용자' },
    { key: 'user_flow', title: '사용자 스토리' },
    { key: 'core_features', title: '기능 요구사항' },
    { key: 'requirements', title: '비기능 요구사항' },
    { key: 'mvp_scope', title: '출시 범위' },
    { key: 'success_metrics', title: '성공 지표' },
    { key: 'risks', title: '리스크와 의존성' },
    { key: 'open_questions', title: '미결정 사항' },
  ],
  business_plan: [
    { key: 'overview', title: '요약' },
    { key: 'problem', title: '문제와 기회' },
    { key: 'market', title: '시장과 고객' },
    { key: 'solution', title: '제품' },
    { key: 'competition', title: '경쟁과 차별화' },
    { key: 'business_model', title: '수익 모델' },
    { key: 'go_to_market', title: '진입 전략' },
    { key: 'team_ops', title: '운영과 팀' },
    { key: 'success_metrics', title: '지표와 가정' },
    { key: 'milestones', title: '마일스톤' },
    { key: 'risks', title: '리스크' },
    { key: 'open_questions', title: '미결정 사항' },
  ],
  feature_spec: [
    { key: 'overview', title: '배경과 목적' },
    { key: 'mvp_scope', title: '범위(포함·제외)' },
    { key: 'non_goals', title: '비목표' },
    { key: 'user_flow', title: '사용자 시나리오' },
    { key: 'core_features', title: '상세 동작' },
    { key: 'edge_cases', title: '엣지 케이스와 오류' },
    { key: 'data_interface', title: '데이터와 인터페이스' },
    { key: 'requirements', title: '요구사항' },
    { key: 'success_metrics', title: '검증 방법' },
    { key: 'risks', title: '리스크와 의존성' },
    { key: 'open_questions', title: '미결정 사항' },
  ],
};

const documentSchemes = Object.fromEntries(
  Object.entries(documentSchemeDefinitions).map(([documentType, sections]) => [
    documentType,
    sections.map((section, index) => ({ ...section, sortOrder: index + 1 })),
  ]),
) as Record<ProjectSettings['documentType'], DocumentSectionDefinition[]>;

/** 이 기획서 타입의 섹션 목록. 순서와 제목이 문서에 그대로 쓰인다. */
export function getDocumentSections(
  documentType: ProjectSettings['documentType'],
): DocumentSectionDefinition[] {
  return documentSchemes[documentType] ?? documentSchemes.service_plan;
}

/** 이 타입이 쓰는 섹션 키인가. 검증기는 풀 전체가 아니라 이것으로 본다. */
export function isSectionKeyOfType(
  documentType: ProjectSettings['documentType'],
  sectionKey: unknown,
): sectionKey is DocumentSectionKey {
  return getDocumentSections(documentType).some((section) => section.key === sectionKey);
}

/** 풀 전체의 기본 제목. 타입을 모르는 자리(로그·마이그레이션)에서만 쓴다. */
export function defaultSectionTitle(sectionKey: DocumentSectionKey) {
  return documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? sectionKey;
}

/**
 * 한 번에 분석할 수 있는 초안 수 상한.
 *
 * 서버 검증과 화면 안내가 같은 값을 써야 한다. 따로 두면 한쪽만 바뀌어도
 * 사용자는 저장은 되는데 분석에서 거절되는 상태를 만나게 된다.
 */
export const MAX_ANALYSIS_DRAFT_COUNT = 30;

export type NormalizedIdeaType =
  | 'problem'
  | 'target_user'
  | 'feature'
  | 'scope'
  | 'requirement'
  | 'metric'
  | 'risk'
  | 'open_question'
  | 'flow'
  | 'solution';

export type NormalizedIdeaIntent = 'propose' | 'warn' | 'require' | 'assume' | 'question';

/**
 * 금지 방향 충돌 판정.
 *
 * v0.1에서는 이 판정을 서버가 한국어 키워드 교집합으로 내렸다. 키워드 목록에 없는
 * 금지 방향은 그대로 통과했고, 같은 아이디어가 병합·서버 복구·Decision Room 게이트에서
 * 제각각 분류될 수 있었다. v0.2부터는 정규화 단계에서 모델이 아이디어별로 한 번 판정하고,
 * 이후 모든 단계가 그 판정을 읽는다. 판정에는 근거가 따라붙어 사람이 검토할 수 있다.
 */
export type ForbiddenDirectionJudgement = {
  conflicts: boolean;
  /** 왜 충돌하는지 또는 왜 충돌하지 않는지. 사람이 검토할 수 있어야 한다. */
  reason: string;
  /** 판정 근거가 된 초안 원문 조각. conflicts가 false면 비어 있을 수 있다. */
  evidence: string;
};

export type NormalizedIdea = {
  id: string;
  sourceDraftId: string;
  sourceModel: LocalDraftSubmission['aiModel'];
  sourceExcerpt: string;
  sectionKey: DocumentSectionKey;
  topic: string;
  ideaType: NormalizedIdeaType;
  normalizedText: string;
  intent: NormalizedIdeaIntent;
  confidence: number;
  forbiddenDirectionConflict: ForbiddenDirectionJudgement;
};

export type ProtocolDecisionOption = {
  id: string;
  optionType: 'selected' | 'alternative' | 'conflict';
  content: string;
  differenceFromSelected?: string;
  severity?: 'low' | 'medium' | 'high';
  sourceIdeaIds: string[];
};

/**
 * 이 결정의 선택안을 누가 정했는가.
 *
 * - `merge`: 분석 파이프라인의 병합 모델이 정했다.
 * - `decision_room`: 검증된 Decision Room 제안을 사람이 승인해 적용했다.
 * - `human`: 사람이 선택 과정 패널에서 직접 다른 의견을 선택안으로 올렸다.
 *
 * **모델이 쓸 수 없는 필드다.** v0.2까지는 이 정보가 `selectionReason` 산문의
 * 접두사("GPT-5.6 consensus:", "사용자가 ")로 인코딩되고 렌더할 때마다 문자열
 * 매칭으로 복원됐다. 그래서 (1) 사용자 문구를 바꾸면 배지가 조용히 바뀌었고,
 * (2) 모델이 selectionReason을 "사용자가 "로 시작하면 사람이 결정한 것으로
 * 표시됐다. 출처 추적이 핵심인 도구에서 출처를 속일 수 있는 구멍이었다.
 * `normalizedIdeas`와 같은 원칙으로 서버와 앱만 이 값을 쓴다.
 */
export type DecisionSelectionSource = 'merge' | 'decision_room' | 'human';

export type ProtocolDecisionBlock = {
  id: string;
  sectionKey: DocumentSectionKey;
  topic: string;
  selectedOptionId: string;
  selectionReason: string;
  selectionSource: DecisionSelectionSource;
  confidence: number;
  conflictLevel: 'none' | 'low' | 'medium' | 'high';
  needsHumanReview: boolean;
  options: ProtocolDecisionOption[];
};

export type ProtocolFinalDocumentSection = {
  sectionKey: DocumentSectionKey;
  title: string;
  content: string;
  sourceDecisionBlockIds: string[];
  /**
   * 이 본문이 어떤 선택안을 보고 쓰였는가.
   *
   * 사람이 선택안을 바꾸거나 Decision Room이 결정을 고치면 본문은 이전 선택안을
   * 기준으로 쓰인 상태로 남는다. 서버는 본문을 고쳐 쓰지 않는다(산문은 판단이고,
   * 채택안 문장으로 덮어쓰면 같은 섹션의 다른 결정 내용이 사라진다). 대신 여기
   * 기록과 현재 `selectedOptionId`를 비교해 "본문 갱신 필요"를 파생한다.
   * v0.4에서 추가됐다. 없으면 알 수 없다는 뜻이며, 알 수 없는 것을 낡았다고
   * 표시하지는 않는다.
   */
  composedFrom?: { decisionBlockId: string; selectedOptionId: string }[];
};

export type PlanMergeAnalysisPayload = {
  project: ProjectSettings;
  drafts: LocalDraftSubmission[];
};

export type DraftNormalizeResult = {
  protocolVersion: '0.4';
  source: 'openai' | 'gms' | 'gemini' | 'solar' | 'local_harness';
  normalizedIdeas: NormalizedIdea[];
  warnings: string[];
};

export type PlanMergeAnalysisResult = {
  protocolVersion: '0.4';
  source: 'openai' | 'gms' | 'gemini' | 'solar' | 'local_harness';
  normalizedIdeas: NormalizedIdea[];
  decisionBlocks: ProtocolDecisionBlock[];
  finalDocumentSections: ProtocolFinalDocumentSection[];
  missingSections: DocumentSectionKey[];
  warnings: string[];
};

export type PlanMergeValidationResult = {
  valid: boolean;
  errors: string[];
};
