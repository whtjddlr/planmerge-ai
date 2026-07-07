import {
  documentSectionDefinitions,
  runLocalPlanMergeHarness,
  validatePlanMergeAnalysis,
} from './ai/planmergeProtocol';
import type { PlanMergeAnalysisResult } from './ai/planmergeProtocol';

export type ProjectSettings = {
  title: string;
  goal: string;
  documentType: 'service_plan' | 'prd' | 'business_plan' | 'feature_spec';
  contextPack: string;
  forbiddenDirection: string;
  outputStyle: string;
};

export type LocalDraftStatus = 'submitted' | 'parsed' | 'failed';

export type LocalDraftSubmission = {
  id: string;
  authorName: string;
  authorRole: string;
  aiModel: 'ChatGPT' | 'Claude' | 'Gemini' | 'Cursor' | 'Other';
  taskTitle: string;
  rawText: string;
  status: LocalDraftStatus;
  createdAtLabel: string;
};

export type DraftFormInput = Omit<LocalDraftSubmission, 'id' | 'status' | 'createdAtLabel'>;

export type LocalDecisionLog = {
  id: string;
  analysisRunId: number;
  decisionBlockId: string;
  sectionKey: string;
  sectionTitle: string;
  topic: string;
  action: 'selected_option_overridden';
  beforeOptionId?: string;
  beforeValue?: string;
  afterOptionId: string;
  afterValue: string;
  reason: string;
  createdAtLabel: string;
};

export type LocalWorkspaceState = {
  analysisRunId: number;
  project: ProjectSettings;
  drafts: LocalDraftSubmission[];
  analysisResult?: PlanMergeAnalysisResult;
  approvedBlockIds?: string[];
  decisionLogs: LocalDecisionLog[];
};

export type LocalWorkspaceMetadata = {
  id: string;
  title: string;
  updatedAt: string;
};

export type LocalWorkspaceSession = {
  activeWorkspaceId: string;
  registry: LocalWorkspaceMetadata[];
  state: LocalWorkspaceState;
};

export type LocalWorkspaceWriteResult =
  | {
    saved: true;
    registry: LocalWorkspaceMetadata[];
  }
  | {
    saved: false;
    registry: LocalWorkspaceMetadata[];
    error: unknown;
  };

export type LocalWorkspaceCreateResult = LocalWorkspaceWriteResult & {
  workspaceId: string;
};

export const SAMPLE_WORKSPACE_ID = 'sample';

const LEGACY_WORKSPACE_STORAGE_KEY = 'planmerge_workspace_v1';
const WORKSPACE_BODY_STORAGE_PREFIX = `${LEGACY_WORKSPACE_STORAGE_KEY}:`;
const WORKSPACE_REGISTRY_STORAGE_KEY = 'planmerge_workspaces_v1';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'planmerge_active_workspace_v1';
const WORKSPACE_EXPORT_SCHEMA_VERSION = 'planmerge.workspace.v1';
const WORKSPACE_REGISTRY_CHANGE_EVENT = 'planmerge:workspace-registry-change';
const WORKSPACE_STORAGE_FAILURE_EVENT = 'planmerge:workspace-storage-failure';
const WORKSPACE_STORAGE_FAILURE_MESSAGE = '저장 공간이 부족해 변경 사항이 저장되지 않았습니다.';

const EMPTY_WORKSPACE_REGISTRY: LocalWorkspaceMetadata[] = [];
let workspaceRegistrySnapshotRaw = '';
let workspaceRegistrySnapshot = EMPTY_WORKSPACE_REGISTRY;
let workspaceStorageFailureNotice: string | null = null;
let workspaceStorageFailureTimer: number | null = null;

export const defaultProjectSettings: ProjectSettings = {
  title: '',
  goal: '',
  documentType: 'service_plan',
  contextPack: '',
  forbiddenDirection: '',
  outputStyle: '',
};

export const sampleProjectSettings: ProjectSettings = {
  title: '회의록 기반 액션아이템 정리 SaaS',
  goal: '회의록, 음성 요약, 메신저 대화에서 액션아이템을 추출해 담당자와 마감일 기준으로 정리하는 B2B SaaS 기획서를 만든다.',
  documentType: 'service_plan',
  contextPack: 'MVP는 4주 안에 검증 가능해야 한다. 초기에는 회의록 텍스트 붙여넣기, 액션아이템 추출, 담당자/마감일 확인, 내보내기까지 포함한다.',
  forbiddenDirection: '초기 MVP에 실시간 회의 녹음, 캘린더 양방향 동기화, Slack/Notion 연동까지 포함하지 않는다.',
  outputStyle: 'B2B SaaS 의사결정 문서처럼 간결하고 검증 기준이 분명한 톤',
};

export const sampleDrafts: LocalDraftSubmission[] = [
  {
    id: 'sample-draft-overview',
    authorName: '서연',
    authorRole: 'PM',
    aiModel: 'ChatGPT',
    taskTitle: '서비스 개요',
    rawText: '서비스 개요: 회의록 기반 액션아이템 정리 SaaS는 회의 후 흩어지는 할 일, 담당자, 마감일을 한 화면에서 정리해 후속 실행률을 높이는 업무 도구다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-problem',
    authorName: '민수',
    authorRole: 'PM',
    aiModel: 'Claude',
    taskTitle: '문제 정의',
    rawText: '문제 정의: 회의가 끝난 뒤 결정사항과 액션아이템이 회의록, 메신저, 개인 메모에 흩어져 누락된다. 특히 담당자와 마감일이 불명확하면 다음 회의에서 같은 논의를 반복한다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-target',
    authorName: '지현',
    authorRole: 'Designer',
    aiModel: 'Gemini',
    taskTitle: '타깃 사용자',
    rawText: '타깃 사용자: 주 5회 이상 회의를 진행하는 5~30인 규모 스타트업 팀의 PM, 팀 리드, 오퍼레이션 매니저를 초기 고객으로 둔다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-pain',
    authorName: '도윤',
    authorRole: 'Marketer',
    aiModel: 'Other',
    taskTitle: '사용자 Pain Point',
    rawText: '사용자 Pain Point: 회의록을 다시 읽는 시간이 길고, 누가 무엇을 해야 하는지 확인하기 어렵다. 액션아이템을 별도 툴에 옮기는 반복 작업 때문에 실행 관리가 늦어진다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-solution',
    authorName: '서연',
    authorRole: 'PM',
    aiModel: 'ChatGPT',
    taskTitle: '솔루션',
    rawText: '솔루션: 사용자가 회의록을 붙여넣으면 AI가 결정사항, 액션아이템, 담당자 후보, 마감일 후보를 추출하고 사용자가 확인한 뒤 공유 가능한 정리본으로 내보낸다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-features',
    authorName: '현우',
    authorRole: 'Developer',
    aiModel: 'Cursor',
    taskTitle: '핵심 기능',
    rawText: '핵심 기능: 회의록 텍스트 붙여넣기, 액션아이템 자동 추출, 담당자/마감일 후보 표시, 사람 검토 체크, Markdown 내보내기, 추출 근거 문장 하이라이트가 필요하다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-mvp-selected',
    authorName: '현우',
    authorRole: 'Developer',
    aiModel: 'Claude',
    taskTitle: 'MVP 범위',
    rawText: 'MVP 범위: 4주 안에는 텍스트 붙여넣기, 액션아이템 추출, 담당자/마감일 확인, 결과 내보내기까지만 포함한다. 인증, 결제, 외부 연동은 검증 이후로 미룬다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-mvp-conflict',
    authorName: '나연',
    authorRole: 'Sales',
    aiModel: 'Gemini',
    taskTitle: 'MVP 범위',
    rawText: 'MVP 범위: 고객 데모 설득력을 위해 Slack 연동과 Notion 연동까지 포함해야 한다. 회의 후 바로 쓰는 제품처럼 보이려면 외부 문서 도구 연동까지 필요하다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-flow',
    authorName: '지현',
    authorRole: 'Designer',
    aiModel: 'Claude',
    taskTitle: '사용자 플로우',
    rawText: '사용자 플로우: 프로젝트 생성 후 회의록 붙여넣기, AI 추출 실행, 액션아이템 후보 검토, 담당자/마감일 수정, 승인, Markdown 또는 CSV 내보내기 순서로 진행한다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-requirements',
    authorName: '현우',
    authorRole: 'Developer',
    aiModel: 'Cursor',
    taskTitle: '요구사항',
    rawText: '요구사항: 모든 액션아이템은 원문 근거 문장과 연결되어야 한다. 담당자와 마감일은 AI가 확정하지 않고 후보로 표시해야 하며, 사용자가 승인한 항목만 최종 결과에 포함해야 한다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-metrics',
    authorName: '도윤',
    authorRole: 'Marketer',
    aiModel: 'ChatGPT',
    taskTitle: '성공 지표',
    rawText: '성공 지표: 회의록 정리 시간이 50% 이상 줄어드는지, 추출된 액션아이템 중 사용자가 승인한 비율이 70% 이상인지, 다음 회의 전 완료율이 개선되는지 측정한다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-risks',
    authorName: '서연',
    authorRole: 'PM',
    aiModel: 'Claude',
    taskTitle: '리스크',
    rawText: '리스크: AI가 회의록에 없는 담당자나 마감일을 확정하면 신뢰가 깨진다. 따라서 출처 문장 연결, 후보 표시, 사용자 승인 로그가 반드시 필요하다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
  {
    id: 'sample-draft-open',
    authorName: '나연',
    authorRole: 'Sales',
    aiModel: 'Other',
    taskTitle: '미결정 사항',
    rawText: '미결정 사항: 초기 고객을 PM 조직으로 좁힐지, 세일즈/CS 팀까지 포함할지 논의가 필요하다. CSV 내보내기를 MVP에 넣을지도 고객 인터뷰 후 결정해야 한다.',
    status: 'parsed',
    createdAtLabel: '샘플',
  },
];

export const verifiedSampleSummary = {
  title: sampleProjectSettings.title,
  draftCount: sampleDrafts.length,
  sectionCount: documentSectionDefinitions.length,
  conflictCount: 1,
  qualityScore: 100,
} as const;

export function createEmptyWorkspaceState(): LocalWorkspaceState {
  return {
    analysisRunId: 0,
    project: { ...defaultProjectSettings },
    drafts: [],
    decisionLogs: [],
  };
}

export const defaultWorkspaceState: LocalWorkspaceState = createEmptyWorkspaceState();

export function createSampleWorkspaceState(): LocalWorkspaceState {
  const drafts = sampleDrafts.map((draft) => ({ ...draft }));

  return {
    analysisRunId: 1,
    project: sampleProjectSettings,
    drafts,
    analysisResult: runLocalPlanMergeHarness({
      project: sampleProjectSettings,
      drafts,
    }),
    decisionLogs: [],
  };
}

export function isSampleWorkspaceState(state: LocalWorkspaceState) {
  const sampleDraftIds = new Set(sampleDrafts.map((draft) => draft.id));

  return (
    state.project.title === sampleProjectSettings.title &&
    state.drafts.length === sampleDrafts.length &&
    state.drafts.every((draft) => sampleDraftIds.has(draft.id))
  );
}

type WorkspaceExportFile = {
  schemaVersion: typeof WORKSPACE_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  workspace: LocalWorkspaceState;
};

type WorkspaceImportResult =
  | {
    valid: true;
    state: LocalWorkspaceState;
    warnings: string[];
    errors: [];
  }
  | {
    valid: false;
    errors: string[];
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidProjectSettings(value: unknown): value is ProjectSettings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.title === 'string' &&
    typeof value.goal === 'string' &&
    typeof value.documentType === 'string' &&
    ['service_plan', 'prd', 'business_plan', 'feature_spec'].includes(value.documentType) &&
    typeof value.contextPack === 'string' &&
    typeof value.forbiddenDirection === 'string' &&
    typeof value.outputStyle === 'string'
  );
}

function isValidDraft(value: unknown): value is LocalDraftSubmission {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.authorName === 'string' &&
    typeof value.authorRole === 'string' &&
    ['ChatGPT', 'Claude', 'Gemini', 'Cursor', 'Other'].includes(String(value.aiModel)) &&
    typeof value.taskTitle === 'string' &&
    typeof value.rawText === 'string' &&
    ['submitted', 'parsed', 'failed'].includes(String(value.status)) &&
    typeof value.createdAtLabel === 'string'
  );
}

function isValidDecisionLog(value: unknown): value is LocalDecisionLog {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.decisionBlockId === 'string' &&
    typeof value.sectionKey === 'string' &&
    typeof value.sectionTitle === 'string' &&
    typeof value.topic === 'string' &&
    value.action === 'selected_option_overridden' &&
    typeof value.afterOptionId === 'string' &&
    typeof value.afterValue === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.createdAtLabel === 'string'
  );
}

function sanitizeProjectSettings(value: unknown): ProjectSettings {
  if (!isRecord(value)) {
    return defaultProjectSettings;
  }

  return {
    title: typeof value.title === 'string' ? value.title : defaultProjectSettings.title,
    goal: typeof value.goal === 'string' ? value.goal : defaultProjectSettings.goal,
    documentType: ['service_plan', 'prd', 'business_plan', 'feature_spec'].includes(String(value.documentType))
      ? value.documentType as ProjectSettings['documentType']
      : defaultProjectSettings.documentType,
    contextPack: typeof value.contextPack === 'string' ? value.contextPack : defaultProjectSettings.contextPack,
    forbiddenDirection: typeof value.forbiddenDirection === 'string'
      ? value.forbiddenDirection
      : defaultProjectSettings.forbiddenDirection,
    outputStyle: typeof value.outputStyle === 'string' ? value.outputStyle : defaultProjectSettings.outputStyle,
  };
}

// 손상된 analysisResult가 저장/가져오기 경로로 들어오면 렌더 크래시가 반복되므로
// 구조 검증을 통과한 경우에만 유지한다.
function sanitizeAnalysisResult(
  value: unknown,
  project: ProjectSettings,
  drafts: LocalDraftSubmission[],
): PlanMergeAnalysisResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const validation = validatePlanMergeAnalysis({ project, drafts }, value);

  return validation.valid ? value as unknown as PlanMergeAnalysisResult : undefined;
}

function sanitizeApprovedBlockIds(value: unknown, analysisResult?: PlanMergeAnalysisResult) {
  if (!Array.isArray(value) || !analysisResult) {
    return [];
  }

  const validBlockIds = new Set(analysisResult.decisionBlocks.map((block) => block.id));
  const approvedBlockIds = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .filter((blockId) => validBlockIds.has(blockId));

  return [...new Set(approvedBlockIds)];
}

export function createDraftSubmission(input: DraftFormInput, existingDraftCount: number): LocalDraftSubmission {
  return {
    ...input,
    // 개수 기반 ID는 삭제 후 추가 시 중복돼 다른 초안까지 함께 삭제된다.
    id: `local-draft-${crypto.randomUUID()}`,
    authorName: input.authorName.trim() || `작성자 ${existingDraftCount + 1}`,
    authorRole: input.authorRole.trim() || 'Other',
    taskTitle: input.taskTitle.trim() || '추가 초안',
    rawText: input.rawText.trim(),
    status: 'submitted',
    createdAtLabel: '방금',
  };
}

function workspaceBodyStorageKey(workspaceId: string) {
  return `${WORKSPACE_BODY_STORAGE_PREFIX}${workspaceId}`;
}

function createWorkspaceId() {
  return crypto.randomUUID();
}

function getWorkspaceTitle(state: LocalWorkspaceState, fallback = '새 워크스페이스') {
  return state.project.title.trim() || fallback;
}

function isValidWorkspaceMetadata(value: unknown): value is LocalWorkspaceMetadata {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function emitWorkspaceRegistryChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(WORKSPACE_REGISTRY_CHANGE_EVENT));
}

function emitWorkspaceStorageFailure() {
  if (typeof window === 'undefined') {
    return;
  }

  window.setTimeout(() => {
    workspaceStorageFailureNotice = WORKSPACE_STORAGE_FAILURE_MESSAGE;
    window.dispatchEvent(new Event(WORKSPACE_STORAGE_FAILURE_EVENT));

    if (workspaceStorageFailureTimer) {
      window.clearTimeout(workspaceStorageFailureTimer);
    }

    workspaceStorageFailureTimer = window.setTimeout(() => {
      workspaceStorageFailureNotice = null;
      workspaceStorageFailureTimer = null;
      window.dispatchEvent(new Event(WORKSPACE_STORAGE_FAILURE_EVENT));
    }, 2400);
  }, 0);
}

function persistWorkspaceRegistry(
  registry: LocalWorkspaceMetadata[],
  options: {
    emit?: boolean;
  } = {},
) {
  window.localStorage.setItem(WORKSPACE_REGISTRY_STORAGE_KEY, JSON.stringify(registry));

  if (options.emit !== false) {
    emitWorkspaceRegistryChange();
  }
}

function readWorkspaceRegistry({
  persistCleanup = false,
}: {
  persistCleanup?: boolean;
} = {}): LocalWorkspaceMetadata[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const rawRegistry = window.localStorage.getItem(WORKSPACE_REGISTRY_STORAGE_KEY);

  if (!rawRegistry) {
    return [];
  }

  try {
    const parsedRegistry = JSON.parse(rawRegistry) as unknown;

    if (!Array.isArray(parsedRegistry)) {
      return [];
    }

    const seenWorkspaceIds = new Set<string>();
    const registry: LocalWorkspaceMetadata[] = [];

    for (const item of parsedRegistry) {
      if (!isValidWorkspaceMetadata(item)) {
        continue;
      }

      const id = item.id.trim();

      if (seenWorkspaceIds.has(id)) {
        continue;
      }

      seenWorkspaceIds.add(id);

      if (window.localStorage.getItem(workspaceBodyStorageKey(id)) === null) {
        continue;
      }

      registry.push({
        id,
        title: item.title.trim() || '새 워크스페이스',
        updatedAt: item.updatedAt.trim() || new Date(0).toISOString(),
      });
    }

    if (persistCleanup && (registry.length !== parsedRegistry.length || JSON.stringify(registry) !== rawRegistry)) {
      try {
        persistWorkspaceRegistry(registry, { emit: false });
      } catch (error) {
        console.warn('워크스페이스 목록 정리에 실패했습니다:', error);
      }
    }

    return registry;
  } catch {
    return [];
  }
}

export function getWorkspaceRegistrySnapshot() {
  if (typeof window === 'undefined') {
    return workspaceRegistrySnapshot;
  }

  const registry = readWorkspaceRegistry();
  const rawRegistry = JSON.stringify(registry);

  if (rawRegistry !== workspaceRegistrySnapshotRaw) {
    workspaceRegistrySnapshotRaw = rawRegistry;
    workspaceRegistrySnapshot = registry;
  }

  return workspaceRegistrySnapshot;
}

export function getServerWorkspaceRegistrySnapshot(): LocalWorkspaceMetadata[] {
  return EMPTY_WORKSPACE_REGISTRY;
}

export function getWorkspaceStorageFailureNoticeSnapshot() {
  return workspaceStorageFailureNotice;
}

export function getServerWorkspaceStorageFailureNoticeSnapshot() {
  return null;
}

export function subscribeWorkspaceRegistry(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleRegistryChange = () => {
    listener();
  };
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === WORKSPACE_REGISTRY_STORAGE_KEY) {
      listener();
    }
  };

  window.addEventListener(WORKSPACE_REGISTRY_CHANGE_EVENT, handleRegistryChange);
  window.addEventListener('storage', handleStorageChange);

  return () => {
    window.removeEventListener(WORKSPACE_REGISTRY_CHANGE_EVENT, handleRegistryChange);
    window.removeEventListener('storage', handleStorageChange);
  };
}

export function subscribeWorkspaceStorageFailures(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorageFailure = () => {
    listener();
  };

  window.addEventListener(WORKSPACE_STORAGE_FAILURE_EVENT, handleStorageFailure);

  return () => {
    window.removeEventListener(WORKSPACE_STORAGE_FAILURE_EVENT, handleStorageFailure);
  };
}

function upsertWorkspaceMetadata(
  registry: LocalWorkspaceMetadata[],
  metadata: LocalWorkspaceMetadata,
) {
  return [
    metadata,
    ...registry.filter((entry) => entry.id !== metadata.id),
  ];
}

function createWorkspaceMetadata(
  workspaceId: string,
  state: LocalWorkspaceState,
  updatedAt: string,
  titleFallback?: string,
): LocalWorkspaceMetadata {
  return {
    id: workspaceId,
    title: getWorkspaceTitle(state, titleFallback),
    updatedAt,
  };
}

function sanitizeStoredWorkspaceState(value: unknown): LocalWorkspaceState {
  if (!isRecord(value)) {
    return createEmptyWorkspaceState();
  }

  const analysisRunId = typeof value.analysisRunId === 'number' && Number.isFinite(value.analysisRunId)
    ? value.analysisRunId
    : 0;
  const project = sanitizeProjectSettings(value.project);
  const storedDrafts = Array.isArray(value.drafts)
    ? value.drafts.filter(isValidDraft)
    : [];
  const analysisResult = sanitizeAnalysisResult(value.analysisResult, project, storedDrafts);

  return {
    analysisRunId,
    project,
    drafts: storedDrafts,
    analysisResult,
    approvedBlockIds: sanitizeApprovedBlockIds(value.approvedBlockIds, analysisResult),
    decisionLogs: (Array.isArray(value.decisionLogs) ? value.decisionLogs : [])
      .filter(isValidDecisionLog)
      .map((log) => ({
        ...log,
        analysisRunId: log.analysisRunId ?? analysisRunId,
      })),
  };
}

function parseStoredWorkspaceState(rawState: string): LocalWorkspaceState {
  try {
    return sanitizeStoredWorkspaceState(JSON.parse(rawState) as unknown);
  } catch {
    return createEmptyWorkspaceState();
  }
}

function migrateLegacyWorkspaceState(): LocalWorkspaceSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawLegacyState = window.localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);

  if (rawLegacyState === null) {
    return null;
  }

  const state = parseStoredWorkspaceState(rawLegacyState);
  const workspaceId = createWorkspaceId();
  const metadata = createWorkspaceMetadata(workspaceId, state, new Date().toISOString(), '기존 워크스페이스');
  const registry = upsertWorkspaceMetadata(readWorkspaceRegistry({ persistCleanup: true }), metadata);

  try {
    window.localStorage.setItem(workspaceBodyStorageKey(workspaceId), JSON.stringify(state));
    persistWorkspaceRegistry(registry);
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
    window.localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);

    return {
      activeWorkspaceId: workspaceId,
      registry,
      state,
    };
  } catch (error) {
    // 새 슬롯 저장에 실패하면 legacy 키를 남겨 다음 로드에서 다시 마이그레이션한다.
    console.warn('기존 워크스페이스 마이그레이션에 실패했습니다:', error);
    emitWorkspaceStorageFailure();

    return {
      activeWorkspaceId: workspaceId,
      registry,
      state,
    };
  }
}

function createDefaultWorkspaceSession(): LocalWorkspaceSession {
  const state = createEmptyWorkspaceState();
  const created = createWorkspaceEntry(state);

  return {
    activeWorkspaceId: created.workspaceId,
    registry: created.registry,
    state,
  };
}

export function loadWorkspaceState(workspaceId: string): LocalWorkspaceState | null {
  if (typeof window === 'undefined') {
    return createEmptyWorkspaceState();
  }

  const rawState = window.localStorage.getItem(workspaceBodyStorageKey(workspaceId));

  if (rawState === null) {
    return null;
  }

  return parseStoredWorkspaceState(rawState);
}

export function loadLocalWorkspaceSession({
  freshStart = false,
}: {
  freshStart?: boolean;
} = {}): LocalWorkspaceSession {
  if (typeof window === 'undefined') {
    return {
      activeWorkspaceId: 'server',
      registry: [],
      state: createEmptyWorkspaceState(),
    };
  }

  const migratedSession = migrateLegacyWorkspaceState();

  if (freshStart) {
    return createDefaultWorkspaceSession();
  }

  if (migratedSession) {
    return migratedSession;
  }

  let registry = readWorkspaceRegistry({ persistCleanup: true });
  let activeWorkspaceId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);

  if (activeWorkspaceId && !registry.some((entry) => entry.id === activeWorkspaceId)) {
    activeWorkspaceId = null;
  }

  activeWorkspaceId ??= registry[0]?.id ?? null;

  if (activeWorkspaceId) {
    const state = loadWorkspaceState(activeWorkspaceId);

    if (state) {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId);

      return {
        activeWorkspaceId,
        registry,
        state,
      };
    }

    registry = registry.filter((entry) => entry.id !== activeWorkspaceId);

    try {
      persistWorkspaceRegistry(registry);
    } catch {
      // 정리 실패는 다음 저장 시 다시 보정한다.
    }
  }

  return createDefaultWorkspaceSession();
}

export function saveWorkspaceState(workspaceId: string, state: LocalWorkspaceState): LocalWorkspaceWriteResult {
  if (typeof window === 'undefined') {
    return {
      saved: true,
      registry: [],
    };
  }

  const metadata = createWorkspaceMetadata(workspaceId, state, new Date().toISOString());
  const registry = upsertWorkspaceMetadata(readWorkspaceRegistry({ persistCleanup: true }), metadata);

  try {
    window.localStorage.setItem(workspaceBodyStorageKey(workspaceId), JSON.stringify(state));
    persistWorkspaceRegistry(registry);
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);

    return {
      saved: true,
      registry,
    };
  } catch (error) {
    // 대용량 초안으로 QuotaExceededError가 나도 앱은 계속 동작해야 한다.
    console.warn('워크스페이스 저장에 실패했습니다:', error);
    emitWorkspaceStorageFailure();

    return {
      saved: false,
      registry,
      error,
    };
  }
}

export function createWorkspaceEntry(
  state: LocalWorkspaceState,
  options: {
    workspaceId?: string;
    activate?: boolean;
    titleFallback?: string;
  } = {},
): LocalWorkspaceCreateResult {
  const workspaceId = options.workspaceId ?? createWorkspaceId();
  const metadata = createWorkspaceMetadata(workspaceId, state, new Date().toISOString(), options.titleFallback);
  const registry = typeof window === 'undefined'
    ? [metadata]
    : upsertWorkspaceMetadata(readWorkspaceRegistry({ persistCleanup: true }), metadata);

  if (typeof window === 'undefined') {
    return {
      saved: true,
      workspaceId,
      registry,
    };
  }

  try {
    window.localStorage.setItem(workspaceBodyStorageKey(workspaceId), JSON.stringify(state));
    persistWorkspaceRegistry(registry);

    if (options.activate !== false) {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
    }

    return {
      saved: true,
      workspaceId,
      registry,
    };
  } catch (error) {
    console.warn('워크스페이스 저장에 실패했습니다:', error);
    emitWorkspaceStorageFailure();

    return {
      saved: false,
      workspaceId,
      registry,
      error,
    };
  }
}

export function activateWorkspaceEntry(workspaceId: string): LocalWorkspaceSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const state = loadWorkspaceState(workspaceId);

  if (!state) {
    const registry = readWorkspaceRegistry({ persistCleanup: true }).filter((entry) => entry.id !== workspaceId);

    try {
      persistWorkspaceRegistry(registry);
    } catch {
      // 정리 실패는 다음 저장 시 다시 보정한다.
    }

    return null;
  }

  let registry = readWorkspaceRegistry({ persistCleanup: true });

  if (!registry.some((entry) => entry.id === workspaceId)) {
    registry = upsertWorkspaceMetadata(
      registry,
      createWorkspaceMetadata(workspaceId, state, new Date().toISOString()),
    );

    try {
      persistWorkspaceRegistry(registry);
    } catch {
      // 본문은 있으므로 목록 저장 실패만 무시하고 현재 세션은 유지한다.
    }
  }

  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);

  return {
    activeWorkspaceId: workspaceId,
    registry,
    state,
  };
}

export function deleteWorkspaceEntry(workspaceId: string): LocalWorkspaceSession {
  if (typeof window === 'undefined') {
    return createDefaultWorkspaceSession();
  }

  window.localStorage.removeItem(workspaceBodyStorageKey(workspaceId));

  let registry = readWorkspaceRegistry({ persistCleanup: true }).filter((entry) => entry.id !== workspaceId);

  try {
    persistWorkspaceRegistry(registry);
  } catch {
    // 삭제 대상 본문은 이미 지웠으므로 목록은 다음 저장 시 다시 보정한다.
  }

  const currentActiveId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  const nextActiveId = currentActiveId &&
    currentActiveId !== workspaceId &&
    registry.some((entry) => entry.id === currentActiveId)
    ? currentActiveId
    : registry[0]?.id;

  if (nextActiveId) {
    const state = loadWorkspaceState(nextActiveId) ?? createEmptyWorkspaceState();

    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, nextActiveId);

    return {
      activeWorkspaceId: nextActiveId,
      registry,
      state,
    };
  }

  const nextSession = createDefaultWorkspaceSession();
  registry = nextSession.registry;

  return {
    ...nextSession,
    registry,
  };
}

export function createWorkspaceExport(state: LocalWorkspaceState) {
  const exportFile: WorkspaceExportFile = {
    schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: state,
  };

  return JSON.stringify(exportFile, null, 2);
}

export function parseWorkspaceImport(rawText: string): WorkspaceImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      errors: ['파일이 올바른 JSON 형식이 아닙니다.'],
    };
  }

  if (!isRecord(parsed)) {
    return {
      valid: false,
      errors: ['가져오기 파일은 객체여야 합니다.'],
    };
  }

  const workspace = parsed.schemaVersion === WORKSPACE_EXPORT_SCHEMA_VERSION
    ? parsed.workspace
    : parsed;

  if (!isRecord(workspace)) {
    return {
      valid: false,
      errors: ['워크스페이스 데이터가 없습니다.'],
    };
  }

  const warnings: string[] = [];
  const project = isValidProjectSettings(workspace.project)
    ? workspace.project
    : defaultProjectSettings;
  const drafts = Array.isArray(workspace.drafts)
    ? workspace.drafts.filter(isValidDraft)
    : [];
  const decisionLogs = Array.isArray(workspace.decisionLogs)
    ? workspace.decisionLogs.filter(isValidDecisionLog)
    : [];
  const analysisRunId = typeof workspace.analysisRunId === 'number' && Number.isFinite(workspace.analysisRunId)
    ? workspace.analysisRunId
    : 0;

  if (!isValidProjectSettings(workspace.project)) {
    warnings.push('프로젝트 설정이 없거나 형식이 맞지 않아 기본값으로 대체했습니다.');
  }

  if (!Array.isArray(workspace.drafts)) {
    warnings.push('초안 목록이 없어 빈 초안 목록으로 대체했습니다.');
  } else if (drafts.length !== workspace.drafts.length) {
    warnings.push('형식이 맞지 않는 초안 일부를 제외했습니다.');
  }

  if (Array.isArray(workspace.decisionLogs) && decisionLogs.length !== workspace.decisionLogs.length) {
    warnings.push('형식이 맞지 않는 Decision Log 일부를 제외했습니다.');
  }

  const analysisResult = sanitizeAnalysisResult(workspace.analysisResult, project, drafts);
  const approvedBlockIds = sanitizeApprovedBlockIds(workspace.approvedBlockIds, analysisResult);

  if (workspace.analysisResult !== undefined && !analysisResult) {
    warnings.push('분석 결과가 형식 검증에 실패해 제외했습니다. 다시 분석을 실행해 주세요.');
  }

  return {
    valid: true,
    state: {
      analysisRunId,
      project,
      drafts,
      analysisResult,
      approvedBlockIds,
      decisionLogs: decisionLogs.map((log) => ({
        ...log,
        analysisRunId: log.analysisRunId ?? analysisRunId,
      })),
    },
    warnings,
    errors: [],
  };
}
