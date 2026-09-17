'use client';

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { DocumentContent } from './components/DocumentContent';
import { DecisionPanel } from './components/DecisionPanel';
import { DraftSubmitPage } from './components/pages/DraftSubmitPage';
import { OpenQuestionsPage } from './components/pages/OpenQuestionsPage';
import { ProjectSetupPage } from './components/pages/ProjectSetupPage';
import { AnalysisInspectorPage } from './components/pages/AnalysisInspectorPage';
import { MySharedWorkspacesPage } from './components/pages/MySharedWorkspacesPage';
import type { AppView } from './types/navigation';
import {
  activateWorkspaceEntry,
  createEmptyWorkspaceState,
  createWorkspaceExport,
  createWorkspaceEntry,
  createDraftSubmission,
  createSampleWorkspaceState,
  deleteWorkspaceEntry,
  getServerWorkspaceRegistrySnapshot,
  getServerWorkspaceStorageFailureNoticeSnapshot,
  getWorkspaceRegistrySnapshot,
  getWorkspaceStorageFailureNoticeSnapshot,
  loadLocalWorkspaceSession,
  parseWorkspaceImport,
  SAMPLE_WORKSPACE_ID,
  saveWorkspaceState,
  subscribeWorkspaceRegistry,
  subscribeWorkspaceStorageFailures,
} from './lib/localWorkspace';
import type {
  DraftFormInput,
  LocalDecisionLog,
  LocalWorkspaceSession,
  ProjectSettings,
} from './lib/localWorkspace';
import { AnalysisFailureError, generatePlanMergeAnalysis } from './lib/ai/planmergeAnalysisClient';
import type { AnalysisProgressEvent, AnalysisStage } from './lib/ai/planmergeAnalysisClient';
import { analysisFailureHint } from './lib/ai/analysisFailureReason';
import { describeAnalysisCost } from './lib/analysisEstimate';
import { recomposeDocumentSection } from './lib/ai/documentCompositionClient';
import { replaceDocumentSection } from './lib/ai/documentComposition';
import { AnalysisKeySetup, type AnalysisKeyStatus } from './components/AnalysisKeySetup';
import {
  fetchServerAnalysisStatus,
  loadAnalysisCredentials,
  type StoredAnalysisCredentials,
} from './lib/analysisKeyStore';
import {
  createSharedWorkspace,
  fetchSharedWorkspace,
  revokeSharedWorkspace,
  SharedWorkspaceRequestError,
  updateSharedWorkspace,
} from './lib/sharedWorkspaceClient';
import {
  clearSharedWorkspaceOwnerAccess,
  loadLegacySharedWorkspaceOwnerAccess,
  loadSharedWorkspaceOwnerAccess,
  saveSharedWorkspaceOwnerAccess,
} from './lib/sharedWorkspaceOwnerStore';
import type { SharedWorkspaceOwnerAccess } from './lib/sharedWorkspaceOwnerStore';
import { createDocumentSectionsFromAnalysis } from './lib/analysisViewModel';
import { applyDecisionOptionOverride, applyDecisionResolutionProposal } from './lib/analysisOverride';
import type { DecisionResolutionResult } from './lib/ai/decisionResolution';
import { evaluateAnalysisQuality, type QualityLevel } from './lib/analysisQuality';
import { buildMarkdownExport } from './lib/exportMarkdown';
import {
  documentSectionDefinitions,
  MAX_ANALYSIS_DRAFT_COUNT,
  type ProtocolDecisionBlock,
  type ProtocolDecisionOption,
} from './lib/ai/planmergeProtocol';
import type { DocumentSectionData } from './data/mergeResult';

type AnalysisStatus = 'idle' | 'analyzing' | 'completed';

type AnalysisFailure = {
  message: string;
  detail?: string;
  retryable: boolean;
  code?: string;
  /** 서버가 분류한 사유. 있으면 사용자가 다음에 할 일을 안내한다. */
  reason?: string;
};

const SHARED_READ_ONLY_NOTICE = '공유 보기에서는 사용할 수 없습니다.';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('setup');
  const [activeSection, setActiveSection] = useState(7);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  // 분석 실패는 2.4초 토스트로 사라지면 안 된다. 사용자가 재시도할지 수동으로
  // 진행할지 정할 때까지 화면에 남긴다.
  const [analysisError, setAnalysisError] = useState<AnalysisFailure | null>(null);
  // 서버가 흘려보내는 진행 단계. JSON으로 답하는 서버(스텁, 옛 배포)면 비어 있고 정적 안내만 보인다.
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressEvent[]>([]);
  // 사용자 키로 돌아갈 수 있는 제품이므로 이번 분석이 얼마를 썼는지 보여준다.
  // 서버에 키가 있으면 묻지 않고, 없으면 이 브라우저에 저장된 사용자 키를 쓴다.
  const [analysisKeyStatus, setAnalysisKeyStatus] = useState<AnalysisKeyStatus>({
    serverConfigured: false,
    credentials: null,
    loaded: false,
  });
  const [workspaceState, setWorkspaceState] = useState(createEmptyWorkspaceState);
  // 직전 분석의 실측 사용량. 워크스페이스에 저장되므로 새로고침 뒤에도 남는다.
  const analysisUsage = workspaceState.lastAnalysisUsage ?? null;
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [hasLoadedWorkspace, setHasLoadedWorkspace] = useState(false);
  const [sharedWorkspaceId, setSharedWorkspaceId] = useState<string | null>(null);
  const [sharedWorkspaceSnapshotVersion, setSharedWorkspaceSnapshotVersion] = useState<number | null>(null);
  const [sharedWorkspaceLink, setSharedWorkspaceLink] = useState<string | null>(null);
  const [ownedShareAccess, setOwnedShareAccess] = useState<SharedWorkspaceOwnerAccess | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recomposingSectionKey, setRecomposingSectionKey] = useState<string | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);
  const workspaceImportInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRegistry = useSyncExternalStore(
    subscribeWorkspaceRegistry,
    getWorkspaceRegistrySnapshot,
    getServerWorkspaceRegistrySnapshot,
  );
  const storageFailureNotice = useSyncExternalStore(
    subscribeWorkspaceStorageFailures,
    getWorkspaceStorageFailureNoticeSnapshot,
    getServerWorkspaceStorageFailureNoticeSnapshot,
  );
  const displayedNotice = storageFailureNotice ?? notice;
  const mergeSections = useMemo(
    () => createDocumentSectionsFromAnalysis(workspaceState.analysisResult, workspaceState.drafts),
    [workspaceState.analysisResult, workspaceState.drafts],
  );
  const selectedSection = mergeSections.find((section) => section.number === activeSection) ?? mergeSections[0];
  // 실행 전 비용 안내. 토큰은 추정하지 않고, 호출 수·직전 실측·키 출처만 말한다.
  const analysisCostLines = describeAnalysisCost({
    draftCount: workspaceState.drafts.length,
    lastUsage: workspaceState.lastAnalysisUsage,
    keySource: analysisKeyStatus.serverConfigured
      ? 'server'
      : analysisKeyStatus.credentials
        ? 'request'
        : 'none',
  });
  const activeSectionBlockIds = useMemo(() => getSectionDecisionBlockIds(selectedSection), [selectedSection]);
  const approvalStatus = useMemo(() => {
    const approvedBlockIds = new Set(workspaceState.approvedBlockIds ?? []);

    return activeSectionBlockIds.length > 0 &&
      activeSectionBlockIds.every((blockId) => approvedBlockIds.has(blockId))
      ? 'approved'
      : 'pending';
  }, [activeSectionBlockIds, workspaceState.approvedBlockIds]);
  const displayedIdeaCount = workspaceState.analysisResult?.normalizedIdeas.length
    ?? mergeSections.filter((section) => section.content.trim()).length;
  const workspaceScopeKey = sharedWorkspaceId
    ? `shared:${sharedWorkspaceId}:${sharedWorkspaceSnapshotVersion ?? 1}`
    : `local:${activeWorkspaceId ?? 'pending'}`;
  const sharedMode = Boolean(sharedWorkspaceId);
  const effectiveActiveView = sharedMode && isSharedRestrictedView(activeView) ? 'merge' : activeView;
  const qualityLevel = useMemo<QualityLevel | null>(() => {
    if (!workspaceState.analysisResult) {
      return null;
    }

    return evaluateAnalysisQuality(
      { project: workspaceState.project, drafts: workspaceState.drafts },
      workspaceState.analysisResult,
    ).level;
  }, [workspaceState.analysisResult, workspaceState.drafts, workspaceState.project]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const serverStatus = await fetchServerAnalysisStatus();

      if (cancelled) {
        return;
      }

      setAnalysisKeyStatus({
        serverConfigured: serverStatus.serverConfigured,
        credentials: loadAnalysisCredentials(),
        loaded: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAnalysisCredentialsChange = useCallback((credentials: StoredAnalysisCredentials | null) => {
    setAnalysisKeyStatus((current) => ({ ...current, credentials }));

    // 키를 막 등록했다면 직전의 "키 없음" 오류는 더 이상 유효하지 않다.
    if (credentials) {
      setAnalysisError((current) => (
        current?.code === 'analysis_provider_unconfigured' ? null : current
      ));
    }
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);

    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }

    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 2400);
  }, []);

  const applyLocalWorkspaceSession = useCallback((session: LocalWorkspaceSession) => {
    setActiveWorkspaceId(session.activeWorkspaceId);
    setWorkspaceState(session.state);
    setAnalysisStatus(session.state.analysisResult ? 'completed' : 'idle');

    // 저장된 병합 결과를 프로토콜 불일치로 버렸다면 사라진 이유를 알려준다.
    // 토스트는 2.4초 뒤 없어져 놓치기 쉬우므로 재시도 버튼이 있는 배너를 쓴다.
    setAnalysisError(session.warnings?.length
      ? { message: session.warnings[0], retryable: true, code: 'stored_result_dropped' }
      : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const searchParams = new URLSearchParams(window.location.search);
    const wsId = searchParams.get('ws');
    const freshStart = searchParams.get('fresh') === '1';

    const loadLocal = () => {
      const session = loadLocalWorkspaceSession({ freshStart });

      applyLocalWorkspaceSession(session);
      setSharedWorkspaceSnapshotVersion(null);
      setOwnedShareAccess(freshStart ? null : loadOwnerAccessForLocalWorkspace(session.activeWorkspaceId));
      setHasLoadedWorkspace(true);
    };

    if (!wsId) {
      const loadTimer = window.setTimeout(loadLocal, 0);

      return () => {
        window.clearTimeout(loadTimer);
      };
    }

    void (async () => {
      try {
        const shared = await fetchSharedWorkspace(wsId);

        if (cancelled) {
          return;
        }

        if (shared) {
          setSharedWorkspaceId(wsId);
          setSharedWorkspaceSnapshotVersion(shared.snapshotVersion);
          setActiveWorkspaceId(null);
          setSharedWorkspaceLink(null);
          setOwnedShareAccess(loadSharedWorkspaceOwnerAccess(wsId));
          setWorkspaceState(shared.state);
          setAnalysisStatus(shared.state.analysisResult ? 'completed' : 'idle');
          setActiveView('merge');
          setHasLoadedWorkspace(true);

          if (shared.warnings.length > 0) {
            showNotice(`공유 워크스페이스를 불러왔습니다. ${shared.warnings.length}개 항목은 보정했습니다.`);
          }

          return;
        }

        showNotice('공유 워크스페이스를 불러오지 못해 로컬 데이터를 표시합니다.');
        loadLocal();
      } catch (error) {
        if (cancelled) {
          return;
        }

        showNotice(error instanceof Error ? error.message : '공유 워크스페이스를 불러오지 못해 로컬 데이터를 표시합니다.');
        loadLocal();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLocalWorkspaceSession, showNotice]);

  useEffect(() => {
    // 공유 모드에서는 남의 워크스페이스로 내 로컬 데이터를 덮어쓰지 않는다.
    if (!hasLoadedWorkspace || sharedWorkspaceId || !activeWorkspaceId) {
      return;
    }

    saveWorkspaceState(activeWorkspaceId, workspaceState);
  }, [activeWorkspaceId, hasLoadedWorkspace, sharedWorkspaceId, workspaceState]);

  useEffect(() => () => {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
  }, []);

  const leaveSharedMode = () => {
    setSharedWorkspaceId(null);
    setSharedWorkspaceSnapshotVersion(null);
    setSharedWorkspaceLink(null);
    setOwnedShareAccess(null);
    removeSharedWorkspaceIdFromUrl();
  };

  const persistActiveWorkspace = () => {
    if (!activeWorkspaceId || sharedWorkspaceId) {
      return true;
    }

    const saveResult = saveWorkspaceState(activeWorkspaceId, workspaceState);

    if (!saveResult.saved) {
      return false;
    }

    return true;
  };

  const createNewWorkspace = () => {
    if (!persistActiveWorkspace()) {
      return;
    }

    const state = createEmptyWorkspaceState();
    const created = createWorkspaceEntry(state);

    leaveSharedMode();
    applyLocalWorkspaceSession({
      activeWorkspaceId: created.workspaceId,
      registry: created.registry,
      state,
    });
    setActiveSection(7);
    setActiveView('setup');

    if (created.saved) {
      showNotice('새 워크스페이스를 만들었습니다.');
    }
  };

  const switchWorkspace = (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) {
      return;
    }

    if (!persistActiveWorkspace()) {
      return;
    }

    const session = activateWorkspaceEntry(workspaceId);

    if (!session) {
      showNotice('워크스페이스 데이터를 찾지 못해 목록에서 제외했습니다.');
      return;
    }

    leaveSharedMode();
    applyLocalWorkspaceSession(session);
    setOwnedShareAccess(loadOwnerAccessForLocalWorkspace(workspaceId));
    setActiveSection(7);
    showNotice('워크스페이스를 전환했습니다.');
  };

  const deleteWorkspace = (workspaceId: string) => {
    const metadata = workspaceRegistry.find((entry) => entry.id === workspaceId);
    const title = workspaceId === SAMPLE_WORKSPACE_ID
      ? '예시 초안'
      : metadata?.title.trim() || '워크스페이스';

    if (!window.confirm(`${title} 워크스페이스를 삭제할까요? 이 브라우저의 저장 데이터에서만 삭제됩니다.`)) {
      return;
    }

    const session = deleteWorkspaceEntry(workspaceId);

    leaveSharedMode();

    if (workspaceId === activeWorkspaceId) {
      applyLocalWorkspaceSession(session);
      setActiveSection(7);
    }

    showNotice('워크스페이스를 삭제했습니다.');
  };

  const copyShareLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showNotice('공유 링크를 클립보드에 복사했습니다.');
    } catch {
      showNotice('클립보드 권한이 없어 링크를 직접 복사해 주세요.');
    }
  };

  const selectSectionFromAnyView = (sectionNumber: number) => {
    setActiveSection(sectionNumber);
    setActiveView('merge');
  };

  const changeView = (view: AppView) => {
    if (sharedWorkspaceId && isSharedRestrictedView(view)) {
      setActiveView('merge');
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    setActiveView(view);
  };

  const approveDecision = () => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    if (analysisStatus === 'analyzing') {
      return;
    }

    if (qualityLevel === 'blocked') {
      showNotice('품질 게이트가 차단되어 선택안을 승인할 수 없습니다.');
      return;
    }

    if (!activeSectionBlockIds.length) {
      showNotice('승인할 선택안을 찾지 못했습니다.');
      return;
    }

    setWorkspaceState((current) => ({
      ...current,
      approvedBlockIds: mergeApprovedBlockIds(current.approvedBlockIds, activeSectionBlockIds),
    }));
    showNotice(`${selectedSection.title} 선택안을 승인했습니다.`);
  };

  const saveProject = (project: ProjectSettings) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    setWorkspaceState((current) => ({
      ...current,
      project,
    }));
    setActiveView('drafts');
    showNotice('프로젝트 설정을 저장했습니다.');
  };

  const loadSampleWorkspace = () => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    if (activeWorkspaceId !== SAMPLE_WORKSPACE_ID && !persistActiveWorkspace()) {
      return;
    }

    const sampleWorkspace = createSampleWorkspaceState();
    const created = createWorkspaceEntry(sampleWorkspace, {
      workspaceId: SAMPLE_WORKSPACE_ID,
      titleFallback: '예시 초안',
    });

    leaveSharedMode();
    applyLocalWorkspaceSession({
      activeWorkspaceId: SAMPLE_WORKSPACE_ID,
      registry: created.registry,
      state: sampleWorkspace,
    });
    setOwnedShareAccess(loadOwnerAccessForLocalWorkspace(SAMPLE_WORKSPACE_ID));
    setActiveSection(7);
    setActiveView('drafts');

    if (created.saved) {
      showNotice(`예시 초안 ${sampleWorkspace.drafts.length}개를 불러왔습니다. 분석을 실행하면 병합 결과가 만들어집니다.`);
    }
  };

  const submitDraft = (draft: DraftFormInput) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    setWorkspaceState((current) => ({
      ...current,
      approvedBlockIds: [],
      drafts: [
        ...current.drafts,
        createDraftSubmission(draft, current.drafts.length),
      ],
    }));
    showNotice('초안을 저장했습니다. 다시 분석을 실행할 수 있습니다.');
  };

  const importSharedDraft = (draft: DraftFormInput) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return false;
    }

    if (workspaceState.drafts.length >= MAX_ANALYSIS_DRAFT_COUNT) {
      showNotice(`초안은 최대 ${MAX_ANALYSIS_DRAFT_COUNT}개까지 저장할 수 있습니다. 기존 초안을 삭제한 뒤 가져오세요.`);
      return false;
    }

    setWorkspaceState((current) => ({
      ...current,
      approvedBlockIds: [],
      drafts: [
        ...current.drafts,
        createDraftSubmission(draft, current.drafts.length),
      ],
    }));
    showNotice('공유 초안을 로컬 초안으로 가져왔습니다. 다시 분석을 실행할 수 있습니다.');

    return true;
  };

  const deleteDraft = (draftId: string) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    setWorkspaceState((current) => ({
      ...current,
      approvedBlockIds: [],
      drafts: current.drafts.filter((draft) => draft.id !== draftId),
    }));
    showNotice('초안을 삭제했습니다. 다시 분석을 실행할 수 있습니다.');
  };

  const reanalyze = async () => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    if (analysisStatus === 'analyzing') {
      return;
    }

    if (!workspaceState.drafts.length) {
      setActiveView('drafts');
      showNotice('분석하려면 AI 초안을 하나 이상 입력해 주세요.');
      return;
    }

    const payload = {
      project: workspaceState.project,
      drafts: workspaceState.drafts,
    };

    setAnalysisStatus('analyzing');
    setAnalysisError(null);
    setAnalysisProgress([]);
    showNotice('병합 분석을 실행합니다.');

    let analysisRun;

    try {
      [analysisRun] = await Promise.all([
        generatePlanMergeAnalysis(payload, {
          onProgress: (event) => setAnalysisProgress((current) => [...current, event]),
        }),
        waitForLoadingTime(900),
      ]);
    } catch (error) {
      const failure: AnalysisFailure = error instanceof AnalysisFailureError
        ? {
          message: error.message,
          detail: error.detail,
          retryable: error.retryable,
          code: error.code,
          reason: error.reason,
        }
        : {
          message: '분석 중 알 수 없는 오류가 발생했습니다.',
          detail: error instanceof Error ? error.message : undefined,
          retryable: true,
        };

      setAnalysisError(failure);
      // 실패했으므로 직전 결과가 있으면 그대로 두고, 없으면 분석 전 상태로 돌린다.
      setAnalysisStatus(workspaceState.analysisResult ? 'completed' : 'idle');
      showNotice(failure.message);
      return;
    }

    setWorkspaceState((current) => ({
      ...current,
      analysisRunId: current.analysisRunId + 1,
      drafts: current.drafts.map((draft) => ({
        ...draft,
        status: draft.rawText.trim() ? 'parsed' : draft.status,
      })),
      analysisResult: analysisRun.result,
      lastAnalysisUsage: analysisRun.usage,
      approvedBlockIds: [],
      decisionLogs: [],
    }));
    setAnalysisStatus('completed');
    showNotice(`${payload.drafts.length}개 초안을 기준으로 병합 결과를 갱신했습니다.`);
  };

  const exportMarkdown = () => {
    const markdown = buildMarkdownExport({
      projectTitle: workspaceState.project.title,
      sections: mergeSections,
      analysisResult: workspaceState.analysisResult,
    });
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'planmerge-result.md';
    link.click();
    URL.revokeObjectURL(url);
    showNotice('Markdown 파일을 내보냈습니다.');
  };

  const exportWorkspace = () => {
    const blob = new Blob([createWorkspaceExport(workspaceState)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'planmerge-workspace.json';
    link.click();
    URL.revokeObjectURL(url);
    showNotice('워크스페이스 JSON을 내보냈습니다.');
  };

  const importWorkspace = () => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    workspaceImportInputRef.current?.click();
  };

  const shareWorkspace = async () => {
    if (!workspaceState.analysisResult) {
      showNotice('분석 결과가 있어야 팀 공유 링크를 만들 수 있습니다.');
      return;
    }

    if (qualityLevel === 'blocked') {
      showNotice('품질 게이트가 차단되어 공유 링크를 만들 수 없습니다.');
      return;
    }

    try {
      const exportJson = createWorkspaceExport(workspaceState);
      const savedOwnerAccess = activeWorkspaceId
        ? loadOwnerAccessForLocalWorkspace(activeWorkspaceId)
        : ownedShareAccess;

      if (savedOwnerAccess?.manageToken) {
        try {
          const updated = await updateSharedWorkspace(
            savedOwnerAccess.workspaceId,
            savedOwnerAccess.manageToken,
            exportJson,
          );
          const ownerAccess: SharedWorkspaceOwnerAccess = {
            ...savedOwnerAccess,
            workspaceId: updated.id,
            expiresAt: updated.expiresAt,
            snapshotVersion: updated.snapshotVersion,
            sharedAnalysisRunId: workspaceState.analysisRunId,
          };
          const nextShareUrl = `${window.location.origin}${window.location.pathname}?ws=${updated.id}`;

          saveSharedWorkspaceOwnerAccess(ownerAccess, activeWorkspaceId);
          setOwnedShareAccess(ownerAccess);
          setSharedWorkspaceLink(nextShareUrl);
          showNotice('공유 링크를 새 분석으로 갱신했습니다. 기존 링크가 계속 유효합니다.');
          return;
        } catch (error) {
          if (!(error instanceof SharedWorkspaceRequestError) || !shouldCreateFreshShareAfterUpdateError(error.status)) {
            showNotice(error instanceof Error ? error.message : '공유 링크 갱신에 실패했습니다.');
            return;
          }

          clearSharedWorkspaceOwnerAccess(savedOwnerAccess.workspaceId, activeWorkspaceId);
        }
      }

      const shared = await createSharedWorkspace(exportJson);
      const nextShareUrl = `${window.location.origin}${window.location.pathname}?ws=${shared.id}`;
      const ownerAccess: SharedWorkspaceOwnerAccess = {
        workspaceId: shared.id,
        manageToken: shared.manageToken,
        expiresAt: shared.expiresAt,
        snapshotVersion: shared.snapshotVersion,
        sharedAnalysisRunId: workspaceState.analysisRunId,
      };

      saveSharedWorkspaceOwnerAccess(ownerAccess, activeWorkspaceId);
      setOwnedShareAccess(ownerAccess);
      setSharedWorkspaceLink(nextShareUrl);

      try {
        await navigator.clipboard.writeText(nextShareUrl);
        showNotice(savedOwnerAccess
          ? '기존 공유 링크를 갱신할 수 없어 새 링크를 만들었습니다. 30일 후 만료됩니다.'
          : '공유 링크를 만들었습니다. 30일 후 만료됩니다.');
      } catch {
        showNotice(savedOwnerAccess
          ? '기존 공유 링크를 갱신할 수 없어 새 링크를 만들었습니다. 클립보드 권한이 없어 링크를 직접 복사해 주세요.'
          : '공유 링크를 만들었습니다. 30일 후 만료됩니다. 클립보드 권한이 없어 링크를 직접 복사해 주세요.');
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '공유 링크 생성에 실패했습니다.');
    }
  };

  const clearRevokedSharedWorkspace = (workspaceId: string) => {
    clearSharedWorkspaceOwnerAccess(workspaceId, activeWorkspaceId);
    setOwnedShareAccess((current) => current?.workspaceId === workspaceId ? null : current);
    setSharedWorkspaceLink((current) =>
      current && getShareUrlWorkspaceId(current) === workspaceId ? null : current,
    );

    if (sharedWorkspaceId === workspaceId) {
      setSharedWorkspaceId(null);
      setSharedWorkspaceSnapshotVersion(null);
      removeSharedWorkspaceIdFromUrl();
    }
  };

  const revokeCurrentSharedWorkspace = async () => {
    if (!ownedShareAccess) {
      showNotice('회수할 공유 링크를 찾지 못했습니다.');
      return;
    }

    try {
      await revokeSharedWorkspace(ownedShareAccess.workspaceId, ownedShareAccess.manageToken);
      clearRevokedSharedWorkspace(ownedShareAccess.workspaceId);
      showNotice('공유 링크를 회수했습니다.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '공유 링크 회수에 실패했습니다.');
    }
  };

  const importWorkspaceFile = async (event: ChangeEvent<HTMLInputElement>) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      event.currentTarget.value = '';
      return;
    }

    const file = event.currentTarget.files?.[0];

    event.currentTarget.value = '';

    if (!file) {
      return;
    }

    let text: string;

    try {
      text = await file.text();
    } catch {
      showNotice('파일을 읽지 못했습니다. 다시 시도해 주세요.');
      return;
    }

    const result = parseWorkspaceImport(text);

    if (!result.valid) {
      showNotice(`가져오기 실패: ${result.errors[0] ?? '파일 형식이 맞지 않습니다.'}`);
      return;
    }

    if (!persistActiveWorkspace()) {
      return;
    }

    const created = createWorkspaceEntry(result.state, {
      titleFallback: '가져온 워크스페이스',
    });

    leaveSharedMode();
    applyLocalWorkspaceSession({
      activeWorkspaceId: created.workspaceId,
      registry: created.registry,
      state: result.state,
    });
    setActiveView('merge');
    setActiveSection(7);

    if (!created.saved) {
      return;
    }

    showNotice(
      result.warnings.length
        ? `워크스페이스를 가져왔습니다. ${result.warnings.length}개 항목은 보정했습니다.`
        : '워크스페이스를 가져왔습니다.',
    );
  };

  const applyDecisionOption = (decisionBlockId: string, optionId: string) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    const currentBlock = workspaceState.analysisResult?.decisionBlocks.find((block) => block.id === decisionBlockId);
    const currentOption = currentBlock?.options.find((option) => option.id === optionId);

    if (!currentBlock || !currentOption) {
      showNotice('적용할 선택지를 찾지 못했습니다.');
      return;
    }

    if (currentBlock.selectedOptionId === optionId) {
      showNotice('이미 적용된 선택안입니다.');
      return;
    }

    setWorkspaceState((current) => {
      if (!current.analysisResult) {
        return current;
      }

      const block = current.analysisResult.decisionBlocks.find((item) => item.id === decisionBlockId);
      const targetOption = block?.options.find((option) => option.id === optionId);

      if (!block || !targetOption || block.selectedOptionId === optionId) {
        return current;
      }

      const beforeOption = block.options.find((option) => option.id === block.selectedOptionId);

      return {
        ...current,
        analysisResult: applyDecisionOptionOverride(current.analysisResult, decisionBlockId, optionId),
        approvedBlockIds: (current.approvedBlockIds ?? []).filter((blockId) => blockId !== decisionBlockId),
        decisionLogs: [
          ...current.decisionLogs,
          createDecisionOverrideLog(current.analysisRunId, block, beforeOption, targetOption),
        ],
      };
    });
    showNotice('선택안을 변경했습니다. 섹션 본문은 "본문 다시 쓰기"로 갱신할 수 있습니다.');
  };

  const applyDecisionResolution = (result: DecisionResolutionResult) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    if (
      !result.applicable ||
      result.proposal.status !== 'ready'
    ) {
      showNotice('검증된 합의안만 적용할 수 있습니다.');
      return;
    }

    const currentBlock = workspaceState.analysisResult?.decisionBlocks.find(
      (block) => block.id === result.proposal.decisionBlockId,
    );

    if (!currentBlock) {
      showNotice('적용할 Decision Block을 찾지 못했습니다.');
      return;
    }

    setWorkspaceState((current) => {
      if (!current.analysisResult) {
        return current;
      }

      const block = current.analysisResult.decisionBlocks.find(
        (item) => item.id === result.proposal.decisionBlockId,
      );

      if (!block) {
        return current;
      }

      const beforeOption = block.options.find((option) => option.id === block.selectedOptionId);
      const nextAnalysisResult = applyDecisionResolutionProposal(current.analysisResult, result);
      const nextBlock = nextAnalysisResult.decisionBlocks.find((item) => item.id === block.id);
      const nextOption = nextBlock?.options.find((option) => option.id === nextBlock.selectedOptionId);

      if (nextAnalysisResult === current.analysisResult || !nextBlock || !nextOption) {
        return current;
      }

      return {
        ...current,
        analysisResult: nextAnalysisResult,
        approvedBlockIds: (current.approvedBlockIds ?? []).filter((blockId) => blockId !== block.id),
        decisionLogs: [
          ...current.decisionLogs,
          createDecisionConsensusLog(
            current.analysisRunId,
            block,
            beforeOption,
            nextOption,
            result,
          ),
        ],
      };
    });
    showNotice('합의 패치를 적용했습니다. 변경 내용과 근거를 Decision Log에 기록했습니다.');
  };

  const recomposeSection = async (sectionKey: string) => {
    if (sharedWorkspaceId) {
      showNotice(SHARED_READ_ONLY_NOTICE);
      return;
    }

    const analysisResult = workspaceState.analysisResult;

    if (!analysisResult) {
      showNotice('다시 쓸 분석 결과가 없습니다.');
      return;
    }

    setRecomposingSectionKey(sectionKey);

    try {
      const section = await recomposeDocumentSection({
        project: workspaceState.project,
        drafts: workspaceState.drafts,
        analysisResult,
        sectionKey,
      });

      setWorkspaceState((current) => (
        current.analysisResult
          ? { ...current, analysisResult: replaceDocumentSection(current.analysisResult, section) }
          : current
      ));
      showNotice('바뀐 결정을 기준으로 섹션 본문을 다시 썼습니다.');
    } catch (error) {
      showNotice(error instanceof AnalysisFailureError ? error.message : '섹션 본문을 다시 쓰지 못했습니다.');
    } finally {
      setRecomposingSectionKey(null);
    }
  };

  const renderContent = () => {
    if (effectiveActiveView === 'setup') {
      return (
        <ProjectSetupPage
          key={createProjectSettingsKey(workspaceState.project)}
          project={workspaceState.project}
          onLoadSample={loadSampleWorkspace}
          onSave={saveProject}
          analysisKeyStatus={analysisKeyStatus}
          onAnalysisCredentialsChange={handleAnalysisCredentialsChange}
        />
      );
    }

    if (effectiveActiveView === 'drafts') {
      return (
        <DraftSubmitPage
          analysisStatus={analysisStatus}
          costNotice={analysisCostLines}
          drafts={workspaceState.drafts}
          mode={sharedMode ? 'shared' : 'local'}
          ownerShareAccess={sharedMode ? null : ownedShareAccess}
          sharedWorkspaceId={sharedWorkspaceId}
          onDeleteDraft={deleteDraft}
          onImportSharedDraft={importSharedDraft}
          onRunAnalysis={reanalyze}
          onSubmitDraft={submitDraft}
        />
      );
    }

    if (effectiveActiveView === 'openQuestions') {
      return (
        <OpenQuestionsPage
          documentSections={mergeSections}
          onSelectSection={selectSectionFromAnyView}
        />
      );
    }

    if (effectiveActiveView === 'inspector') {
      return (
        <AnalysisInspectorPage
          project={workspaceState.project}
          drafts={workspaceState.drafts}
          analysisResult={workspaceState.analysisResult}
          analysisStatus={analysisStatus}
          decisionLogs={workspaceState.decisionLogs}
          onRunAnalysis={reanalyze}
          readOnly={sharedMode}
        />
      );
    }

    if (effectiveActiveView === 'myShares') {
      return <MySharedWorkspacesPage onNotice={showNotice} onShareRevoked={clearRevokedSharedWorkspace} />;
    }

    if (analysisStatus === 'analyzing') {
      return (
        <AnalysisLoadingView
          draftCount={workspaceState.drafts.length}
          costNotice={analysisCostLines}
          progress={analysisProgress}
        />
      );
    }

    if (!workspaceState.analysisResult) {
      return (
        <MergePreparationView
          draftCount={workspaceState.drafts.length}
          costNotice={analysisCostLines}
          onAddDraft={() => changeView('drafts')}
          onRunAnalysis={reanalyze}
          readOnly={sharedMode}
        />
      );
    }

    return (
      <>
        <DocumentContent
          activeSection={activeSection}
          analysisResult={workspaceState.analysisResult}
          documentSections={mergeSections}
          drafts={workspaceState.drafts}
          onSectionSelect={setActiveSection}
          project={workspaceState.project}
          onRecomposeSection={sharedMode ? undefined : recomposeSection}
          recomposingSectionKey={recomposingSectionKey}
        />
        {/* 워크스페이스 로드 전에 마운트하면 runId 0 기준의 빈 참여 상태가
            localStorage에 저장돼 기존 투표/의견을 덮어쓴다. */}
        {hasLoadedWorkspace && (
          <DecisionPanel
            key={`${workspaceScopeKey}:${workspaceState.analysisRunId}`}
            selectedSection={selectedSection}
            analysisRunId={workspaceState.analysisRunId}
            localWorkspaceId={activeWorkspaceId}
            sharedWorkspaceId={sharedWorkspaceId}
            sharedSnapshotVersion={sharedWorkspaceSnapshotVersion}
            ownerShareAccess={sharedMode ? null : ownedShareAccess}
            projectSettings={workspaceState.project}
            analysisResult={workspaceState.analysisResult}
            drafts={workspaceState.drafts}
            onApplyDecisionOption={sharedMode ? undefined : applyDecisionOption}
            onApplyDecisionResolution={sharedMode ? undefined : applyDecisionResolution}
          />
        )}
      </>
    );
  };

  return (
    <div className="flex h-dvh w-full min-w-0 flex-col bg-white md:flex-row">
      <Sidebar
        activeView={effectiveActiveView}
        activeWorkspaceId={activeWorkspaceId}
        analysisStatus={analysisStatus}
        sharedMode={sharedMode}
        workspaces={workspaceRegistry}
        onCreateWorkspace={createNewWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onSwitchWorkspace={switchWorkspace}
        onViewChange={changeView}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <Toolbar
          analysisUsage={analysisUsage}
          activeView={effectiveActiveView}
          approvalStatus={approvalStatus}
          analysisStatus={analysisStatus}
          draftCount={workspaceState.drafts.length}
          hasMergeResult={Boolean(workspaceState.analysisResult)}
          normalizedIdeaCount={displayedIdeaCount}
          onApprove={approveDecision}
          onExportMarkdown={exportMarkdown}
          onExportWorkspace={exportWorkspace}
          onImportWorkspace={importWorkspace}
          onReanalyze={reanalyze}
          onRevokeSharedWorkspace={revokeCurrentSharedWorkspace}
          onShareWorkspace={shareWorkspace}
          onViewChange={changeView}
          projectTitle={workspaceState.project.title}
          qualityLevel={qualityLevel}
          canRevokeSharedWorkspace={Boolean(ownedShareAccess?.manageToken)}
          sharedMode={sharedMode}
        />
        <input
          ref={workspaceImportInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={importWorkspaceFile}
        />
        {displayedNotice && (
          <div
            data-testid="app-notice"
            className="border-b border-emerald-100 bg-emerald-50 px-8 py-2 text-sm text-emerald-800"
          >
            {displayedNotice}
          </div>
        )}
        {sharedWorkspaceLink && (
          <ShareWorkspaceBanner
            shareUrl={sharedWorkspaceLink}
            onCopy={() => copyShareLink(sharedWorkspaceLink)}
            onDismiss={() => setSharedWorkspaceLink(null)}
          />
        )}
        {sharedWorkspaceId && (
          <div className="border-b border-blue-100 bg-blue-50 px-8 py-2 text-sm text-blue-800">
            공유된 워크스페이스를 보고 있습니다. 투표·의견·초안 제출만 반영됩니다.
          </div>
        )}
        <AnalysisKeySetup
          status={analysisKeyStatus}
          onCredentialsChange={handleAnalysisCredentialsChange}
          variant="banner"
        />
        {analysisError && (
          <div
            data-testid="analysis-error-banner"
            className="flex items-start justify-between gap-4 border-b border-red-100 bg-red-50 px-8 py-3 text-sm text-red-800"
          >
            <div className="min-w-0">
              <div className="font-medium">분석에 실패했습니다.</div>
              <div className="mt-0.5">{analysisError.message}</div>
              {analysisFailureHint(analysisError.reason) && (
                <div data-testid="analysis-error-hint" className="mt-1 text-xs text-red-900">
                  {analysisFailureHint(analysisError.reason)}
                </div>
              )}
              {analysisError.detail && (
                <div className="mt-1 break-words text-xs text-red-700/80">{analysisError.detail}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {analysisError.retryable && !sharedWorkspaceId && (
                <button
                  type="button"
                  onClick={reanalyze}
                  className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  다시 시도
                </button>
              )}
              <button
                type="button"
                onClick={() => setAnalysisError(null)}
                className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-100"
              >
                닫기
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

function AnalysisCostNotice({ lines }: { lines: string[] }) {
  return (
    <ul
      data-testid="analysis-cost-notice"
      className="mt-4 space-y-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600"
    >
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
}

function MergePreparationView({
  draftCount,
  costNotice,
  onAddDraft,
  onRunAnalysis,
  readOnly,
}: {
  draftCount: number;
  costNotice: string[];
  onAddDraft: () => void;
  onRunAnalysis: () => void;
  readOnly: boolean;
}) {
  const hasDrafts = draftCount > 0;

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-2xl rounded-md border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-xs text-gray-500">Merge Result</div>
        <h2 className="mt-2 text-2xl text-gray-900">아직 병합 결과가 없습니다.</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {readOnly
            ? '이 공유 워크스페이스에는 표시할 병합 결과가 없습니다.'
            : '프로젝트 기준을 저장하고 AI 초안을 붙여넣은 뒤 분석을 실행하면, 최종 기획서와 섹션별 선택 근거가 생성됩니다.'}
        </p>

        {!readOnly && (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-gray-200 p-4">
                <div className="text-sm text-gray-900">1. 프로젝트 설정</div>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">목표, 공통 기준, 제외 범위를 먼저 고정합니다.</p>
              </div>
              <div className="rounded-md border border-gray-200 p-4">
                <div className="text-sm text-gray-900">2. 초안 입력</div>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">팀원이 AI로 만든 초안을 여러 개 붙여넣습니다.</p>
              </div>
              <div className="rounded-md border border-gray-200 p-4">
                <div className="text-sm text-gray-900">3. 병합 분석</div>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">선택안, 대안, 충돌 의견을 Decision Block으로 정리합니다.</p>
              </div>
            </div>

            {hasDrafts && <AnalysisCostNotice lines={costNotice} />}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
                onClick={hasDrafts ? onRunAnalysis : onAddDraft}
              >
                {hasDrafts ? `${draftCount}개 초안으로 분석 실행` : '초안 입력하기'}
              </button>
              {hasDrafts && (
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  onClick={onAddDraft}
                >
                  초안 더 추가
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ShareWorkspaceBanner({
  shareUrl,
  onCopy,
  onDismiss,
}: {
  shareUrl: string;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="border-b border-blue-100 bg-blue-50 px-4 py-3 sm:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-blue-950">팀 공유 링크가 생성되었습니다.</div>
          <p className="mt-1 text-xs leading-relaxed text-blue-700">
            현재 워크스페이스의 스냅샷 링크입니다. 이후 수정한 내용까지 공유하려면 공유를 다시 갱신하세요.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            readOnly
            value={shareUrl}
            aria-label="팀 공유 링크"
            className="h-9 min-w-0 rounded-md border border-blue-200 bg-white px-3 text-xs text-blue-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:w-96"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="h-9 rounded-md bg-blue-600 px-3 text-sm text-white transition-colors hover:bg-blue-700"
            onClick={onCopy}
          >
            복사
          </button>
          <button
            type="button"
            className="h-9 rounded-md px-3 text-sm text-blue-700 transition-colors hover:bg-blue-100"
            onClick={onDismiss}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function waitForLoadingTime(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getShareUrlWorkspaceId(url: string) {
  try {
    return new URL(url).searchParams.get('ws');
  } catch {
    return null;
  }
}

function removeSharedWorkspaceIdFromUrl() {
  const url = new URL(window.location.href);

  url.searchParams.delete('ws');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function isSharedRestrictedView(view: AppView) {
  return view === 'setup';
}

function shouldCreateFreshShareAfterUpdateError(status: number | undefined) {
  return status === 401 || status === 404 || status === 410;
}

function loadOwnerAccessForLocalWorkspace(localWorkspaceId: string) {
  return loadSharedWorkspaceOwnerAccess(localWorkspaceId) ?? loadLegacySharedWorkspaceOwnerAccess();
}

function createDecisionOverrideLog(
  analysisRunId: number,
  block: ProtocolDecisionBlock,
  beforeOption: ProtocolDecisionOption | undefined,
  afterOption: ProtocolDecisionOption,
): LocalDecisionLog {
  return {
    id: `decision-log-${crypto.randomUUID()}`,
    analysisRunId,
    decisionBlockId: block.id,
    sectionKey: block.sectionKey,
    sectionTitle: getProtocolSectionTitle(block.sectionKey),
    topic: block.topic,
    action: 'selected_option_overridden',
    beforeOptionId: beforeOption?.id,
    beforeValue: beforeOption?.content,
    afterOptionId: afterOption.id,
    afterValue: afterOption.content,
    reason: '선택 과정 패널에서 사용자가 대안 또는 충돌 의견을 최종 선택안으로 적용했습니다.',
    createdAtLabel: '방금',
  };
}

function createDecisionConsensusLog(
  analysisRunId: number,
  block: ProtocolDecisionBlock,
  beforeOption: ProtocolDecisionOption | undefined,
  afterOption: ProtocolDecisionOption,
  result: DecisionResolutionResult,
): LocalDecisionLog {
  return {
    id: `decision-log-${crypto.randomUUID()}`,
    analysisRunId,
    decisionBlockId: block.id,
    sectionKey: block.sectionKey,
    sectionTitle: getProtocolSectionTitle(block.sectionKey),
    topic: block.topic,
    action: 'ai_consensus_applied',
    beforeOptionId: beforeOption?.id,
    beforeValue: beforeOption?.content,
    afterOptionId: afterOption.id,
    afterValue: afterOption.content,
    reason: result.proposal.selectionReason,
    model: result.model,
    responseId: result.responseId,
    generatedAt: result.generatedAt,
    supportingOptionIds: result.proposal.supportingOptionIds,
    addressedOpinionIds: result.proposal.addressedOpinionIds,
    createdAtLabel: '방금',
  };
}

function getProtocolSectionTitle(sectionKey: string) {
  return documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? sectionKey;
}

function createProjectSettingsKey(project: ProjectSettings) {
  return [
    project.title,
    project.documentType,
    project.goal,
    project.contextPack,
    project.forbiddenDirection,
    project.outputStyle,
  ].join('|');
}

function getSectionDecisionBlockIds(section: DocumentSectionData | undefined) {
  if (!section) {
    return [];
  }

  const traces = section.decisionTraces?.length
    ? section.decisionTraces
    : section.decisionTrace
      ? [section.decisionTrace]
      : [];

  return traces.map((trace) => trace.decisionBlockId);
}

function mergeApprovedBlockIds(currentBlockIds: string[] | undefined, nextBlockIds: string[]) {
  return [...new Set([...(currentBlockIds ?? []), ...nextBlockIds])];
}

type StageView = { stage: AnalysisStage; title: string; optional?: boolean };

const analysisStageViews: StageView[] = [
  { stage: 'normalize', title: '초안마다 아이디어를 뽑고 금지 방향 여부를 판정합니다 (정규화, 초안 수만큼 병렬)' },
  { stage: 'merge', title: '아이디어를 결정 블록으로 묶고 채택안·대안·충돌을 정합니다 (병합)' },
  { stage: 'placement', title: '병합이 빠뜨린 아이디어가 있으면 어디에 둘지 다시 묻습니다 (배치 판정)', optional: true },
  { stage: 'compose', title: '확정된 결정으로 섹션 본문을 씁니다 (문서 작성)' },
  { stage: 'repair', title: '검증에 걸리면 한 번 복구를 시도하고, 그래도 실패하면 실패로 알립니다', optional: true },
];

/**
 * 단계별 상태를 서버 이벤트에서 유도한다. 이벤트가 하나도 없으면 전부 pending —
 * 그때는 시간이나 순서로 "진행 중"을 꾸며 내지 않는다(규칙 8).
 */
function deriveStageStates(progress: AnalysisProgressEvent[]) {
  const states = new Map<AnalysisStage, { status: 'pending' | 'running' | 'done'; completed?: number; total?: number }>();

  progress.forEach((event) => {
    states.set(event.stage, {
      status: event.status === 'done' ? 'done' : 'running',
      ...(event.completed !== undefined ? { completed: event.completed } : {}),
      ...(event.total !== undefined ? { total: event.total } : {}),
    });
  });

  return states;
}

function AnalysisLoadingView({
  draftCount,
  costNotice,
  progress,
}: {
  draftCount: number;
  costNotice: string[];
  progress: AnalysisProgressEvent[];
}) {
  const stageStates = deriveStageStates(progress);
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-white px-6 py-10">
      <div className="w-full max-w-xl rounded-md border border-blue-100 bg-blue-50/40 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          <div>
            <h2 className="text-base text-gray-900">병합 분석 중</h2>
            <p className="mt-1 text-sm text-gray-600">
              {draftCount}개 초안을 기준으로 섹션, 선택안, 대안, 충돌 의견을 정리합니다.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-2 w-full animate-pulse rounded-full bg-blue-100" />
          <div className="h-2 w-5/6 animate-pulse rounded-full bg-blue-100" />
          <div className="h-2 w-2/3 animate-pulse rounded-full bg-blue-100" />
        </div>
        {/* 서버가 흘려보낸 단계만 상태를 바꾼다. 이벤트가 없으면 전부 대기 표시다. */}
        <ol data-testid="analysis-progress" className="mt-4 space-y-1 text-xs leading-relaxed text-gray-500">
          {analysisStageViews.map((view, index) => {
            const state = stageStates.get(view.stage);
            const marker = state?.status === 'done'
              ? '✓'
              : state?.status === 'running'
                ? '…'
                : view.optional
                  ? '○'
                  : '·';
            const counter = view.stage === 'normalize' && state?.total
              ? ` ${state.completed ?? 0}/${state.total}`
              : '';

            return (
              <li
                key={view.stage}
                data-stage={view.stage}
                data-status={state?.status ?? 'pending'}
                className={state?.status === 'running' ? 'text-blue-700' : state?.status === 'done' ? 'text-gray-700' : undefined}
              >
                {marker} {index + 1}. {view.title}{counter}
                {view.optional && !state ? ' — 필요할 때만' : ''}
              </li>
            );
          })}
        </ol>
        <AnalysisCostNotice lines={costNotice} />
      </div>
    </main>
  );
}
