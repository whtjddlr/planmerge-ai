/**
 * PlanMerge 프로토콜 v0.4의 타입과 섹션 정의.
 *
 * 값을 만들거나 검증하는 코드는 없다. 여기 있는 것은 "무엇이 결과인가"의 정의다.
 * 다른 모듈은 전부 이 파일을 import하고, 이 파일은 워크스페이스 타입만 import한다.
 */
import type { LocalDraftSubmission, ProjectSettings } from '../localWorkspace';

export const documentSectionDefinitions = [
  { key: 'overview', title: '개요', sortOrder: 1 },
  { key: 'problem', title: '문제 정의', sortOrder: 2 },
  { key: 'target_user', title: '타깃 사용자', sortOrder: 3 },
  { key: 'pain_points', title: '사용자 Pain Point', sortOrder: 4 },
  { key: 'solution', title: '솔루션', sortOrder: 5 },
  { key: 'core_features', title: '핵심 기능', sortOrder: 6 },
  { key: 'mvp_scope', title: 'MVP 범위', sortOrder: 7 },
  { key: 'user_flow', title: '사용자 플로우', sortOrder: 8 },
  { key: 'requirements', title: '요구사항', sortOrder: 9 },
  { key: 'success_metrics', title: '성공 지표', sortOrder: 10 },
  { key: 'risks', title: '리스크', sortOrder: 11 },
  { key: 'open_questions', title: '미결정 사항', sortOrder: 12 },
] as const;

export type DocumentSectionKey = typeof documentSectionDefinitions[number]['key'];

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
