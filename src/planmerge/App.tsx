'use client';

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { DocumentContent } from './components/DocumentContent';
import { DecisionPanel } from './components/DecisionPanel';
import { DraftSubmitPage } from './components/pages/DraftSubmitPage';
import { OpenQuestionsPage } from './components/pages/OpenQuestionsPage';
import { ProjectSetupPage } from './components/pages/ProjectSetupPage';
import { AnalysisInspectorPage } from './components/pages/AnalysisInspectorPage';
import type { AppView } from './types/navigation';
import {
  createWorkspaceExport,
  createDraftSubmission,
  defaultWorkspaceState,
  loadWorkspaceState,
  parseWorkspaceImport,
  saveWorkspaceState,
} from './lib/localWorkspace';
import type { DraftFormInput, LocalDecisionLog, ProjectSettings } from './lib/localWorkspace';
import { generatePlanMergeAnalysis } from './lib/ai/planmergeAnalysisClient';
import { createSharedWorkspace, fetchSharedWorkspace } from './lib/sharedWorkspaceClient';
import { createDocumentSectionsFromAnalysis } from './lib/analysisViewModel';
import { applyDecisionOptionOverride } from './lib/analysisOverride';
import {
  documentSectionDefinitions,
  type ProtocolDecisionBlock,
  type ProtocolDecisionOption,
} from './lib/ai/planmergeProtocol';

type AnalysisStatus = 'idle' | 'analyzing' | 'completed';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('merge');
  const [activeSection, setActiveSection] = useState(7);
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved'>('pending');
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('completed');
  const [workspaceState, setWorkspaceState] = useState(defaultWorkspaceState);
  const [hasLoadedWorkspace, setHasLoadedWorkspace] = useState(false);
  const [sharedWorkspaceId, setSharedWorkspaceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);
  const workspaceImportInputRef = useRef<HTMLInputElement | null>(null);
  const mergeSections = useMemo(
    () => createDocumentSectionsFromAnalysis(workspaceState.analysisResult, workspaceState.drafts),
    [workspaceState.analysisResult, workspaceState.drafts],
  );
  const selectedSection = mergeSections.find((section) => section.number === activeSection) ?? mergeSections[0];

  useEffect(() => {
    let cancelled = false;
    const wsId = new URLSearchParams(window.location.search).get('ws');

    const loadLocal = () => {
      setWorkspaceState(loadWorkspaceState());
      setHasLoadedWorkspace(true);
    };

    if (!wsId) {
      const loadTimer = window.setTimeout(loadLocal, 0);

      return () => {
        window.clearTimeout(loadTimer);
      };
    }

    void (async () => {
      const shared = await fetchSharedWorkspace(wsId);

      if (cancelled) {
        return;
      }

      if (shared) {
        setSharedWorkspaceId(wsId);
        setWorkspaceState(shared);
        setHasLoadedWorkspace(true);
      } else {
        setNotice('공유 워크스페이스를 불러오지 못해 로컬 데이터를 표시합니다.');
        loadLocal();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 공유 모드에서는 남의 워크스페이스로 내 로컬 데이터를 덮어쓰지 않는다.
    if (!hasLoadedWorkspace || sharedWorkspaceId) {
      return;
    }

    saveWorkspaceState(workspaceState);
  }, [hasLoadedWorkspace, sharedWorkspaceId, workspaceState]);

  useEffect(() => () => {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);

    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }

    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 2400);
  };

  const selectSectionFromAnyView = (sectionNumber: number) => {
    setActiveSection(sectionNumber);
    setActiveView('merge');
  };

  const approveDecision = () => {
    if (analysisStatus === 'analyzing') {
      return;
    }

    setApprovalStatus('approved');
    showNotice(`${selectedSection.title} 선택안을 승인했습니다.`);
  };

  const saveProject = (project: ProjectSettings) => {
    setWorkspaceState((current) => ({
      ...current,
      project,
    }));
    showNotice('프로젝트 설정을 저장했습니다.');
  };

  const submitDraft = (draft: DraftFormInput) => {
    setWorkspaceState((current) => ({
      ...current,
      drafts: [
        ...current.drafts,
        createDraftSubmission(draft, current.drafts.length),
      ],
    }));
    setApprovalStatus('pending');
    showNotice('초안을 저장했습니다. 다시 분석을 실행할 수 있습니다.');
  };

  const deleteDraft = (draftId: string) => {
    setWorkspaceState((current) => ({
      ...current,
      drafts: current.drafts.filter((draft) => draft.id !== draftId),
    }));
    setApprovalStatus('pending');
    showNotice('초안을 삭제했습니다. 다시 분석을 실행할 수 있습니다.');
  };

  const reanalyze = async () => {
    if (analysisStatus === 'analyzing') {
      return;
    }

    const payload = {
      project: workspaceState.project,
      drafts: workspaceState.drafts,
    };

    setApprovalStatus('pending');
    setAnalysisStatus('analyzing');
    showNotice('병합 분석을 실행합니다.');

    const [analysisResult] = await Promise.all([
      generatePlanMergeAnalysis(payload),
      waitForLoadingTime(900),
    ]);

    setWorkspaceState((current) => ({
      ...current,
      analysisRunId: current.analysisRunId + 1,
      drafts: current.drafts.map((draft) => ({
        ...draft,
        status: draft.rawText.trim() ? 'parsed' : draft.status,
      })),
      analysisResult,
      decisionLogs: [],
    }));
    setAnalysisStatus('completed');
    showNotice(`${payload.drafts.length}개 초안을 기준으로 병합 결과를 갱신했습니다.`);
  };

  const exportMarkdown = () => {
    const markdown = [
      '# AI 공동 기획서 병합 도구 기획서',
      '',
      ...mergeSections.map((section) => [
        `## ${section.number}. ${section.title}`,
        '',
        section.content || '내용 없음',
        '',
      ].join('\n')),
    ].join('\n');
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
    workspaceImportInputRef.current?.click();
  };

  const shareWorkspace = async () => {
    try {
      const { id } = await createSharedWorkspace(createWorkspaceExport(workspaceState));
      const shareUrl = `${window.location.origin}${window.location.pathname}?ws=${id}`;

      try {
        await navigator.clipboard.writeText(shareUrl);
        showNotice('팀 공유 링크를 클립보드에 복사했습니다. 링크를 연 사람의 투표와 의견이 함께 집계됩니다.');
      } catch {
        window.prompt('아래 공유 링크를 복사하세요.', shareUrl);
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '공유 링크 생성에 실패했습니다.');
    }
  };

  const importWorkspaceFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];

    event.currentTarget.value = '';

    if (!file) {
      return;
    }

    const text = await file.text();
    const result = parseWorkspaceImport(text);

    if (!result.valid) {
      showNotice(`가져오기 실패: ${result.errors[0] ?? '파일 형식이 맞지 않습니다.'}`);
      return;
    }

    setWorkspaceState(result.state);
    setApprovalStatus('pending');
    setAnalysisStatus('completed');
    setActiveView('merge');
    setActiveSection(7);
    showNotice(
      result.warnings.length
        ? `워크스페이스를 가져왔습니다. ${result.warnings.length}개 항목은 보정했습니다.`
        : '워크스페이스를 가져왔습니다.',
    );
  };

  const applyDecisionOption = (decisionBlockId: string, optionId: string) => {
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
        decisionLogs: [
          ...current.decisionLogs,
          createDecisionOverrideLog(current.decisionLogs.length, current.analysisRunId, block, beforeOption, targetOption),
        ],
      };
    });
    setApprovalStatus('pending');
    showNotice('선택안을 변경하고 최종 문서 섹션에 반영했습니다.');
  };

  const renderContent = () => {
    if (activeView === 'setup') {
      return (
        <ProjectSetupPage
          key={createProjectSettingsKey(workspaceState.project)}
          project={workspaceState.project}
          onSave={saveProject}
        />
      );
    }

    if (activeView === 'drafts') {
      return (
        <DraftSubmitPage
          drafts={workspaceState.drafts}
          onDeleteDraft={deleteDraft}
          onSubmitDraft={submitDraft}
        />
      );
    }

    if (activeView === 'openQuestions') {
      return (
        <OpenQuestionsPage
          documentSections={mergeSections}
          onSelectSection={selectSectionFromAnyView}
        />
      );
    }

    if (activeView === 'inspector') {
      return (
        <AnalysisInspectorPage
          project={workspaceState.project}
          drafts={workspaceState.drafts}
          analysisResult={workspaceState.analysisResult}
          analysisStatus={analysisStatus}
          decisionLogs={workspaceState.decisionLogs}
          onRunAnalysis={reanalyze}
        />
      );
    }

    if (analysisStatus === 'analyzing') {
      return <AnalysisLoadingView draftCount={workspaceState.drafts.length} />;
    }

    return (
      <>
        <DocumentContent
          activeSection={activeSection}
          analysisResult={workspaceState.analysisResult}
          documentSections={mergeSections}
          onSectionSelect={setActiveSection}
          project={workspaceState.project}
        />
        {/* 워크스페이스 로드 전에 마운트하면 runId 0 기준의 빈 참여 상태가
            localStorage에 저장돼 기존 투표/의견을 덮어쓴다. */}
        {hasLoadedWorkspace && (
          <DecisionPanel
            key={workspaceState.analysisRunId}
            selectedSection={selectedSection}
            analysisRunId={workspaceState.analysisRunId}
            sharedWorkspaceId={sharedWorkspaceId}
            onApplyDecisionOption={applyDecisionOption}
          />
        )}
      </>
    );
  };

  return (
    <div className="flex h-dvh w-full min-w-0 flex-col bg-white md:flex-row">
      <Sidebar activeView={activeView} analysisStatus={analysisStatus} onViewChange={setActiveView} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Toolbar
          key={activeView}
          activeView={activeView}
          approvalStatus={approvalStatus}
          analysisStatus={analysisStatus}
          draftCount={workspaceState.drafts.length}
          normalizedIdeaCount={workspaceState.analysisResult?.normalizedIdeas.length ?? 0}
          onApprove={approveDecision}
          onExportMarkdown={exportMarkdown}
          onExportWorkspace={exportWorkspace}
          onImportWorkspace={importWorkspace}
          onReanalyze={reanalyze}
          onShareWorkspace={shareWorkspace}
          onViewChange={setActiveView}
          projectTitle={workspaceState.project.title}
          sharedMode={Boolean(sharedWorkspaceId)}
        />
        <input
          ref={workspaceImportInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={importWorkspaceFile}
        />
        {notice && (
          <div className="border-b border-emerald-100 bg-emerald-50 px-8 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        {sharedWorkspaceId && (
          <div className="border-b border-blue-100 bg-blue-50 px-8 py-2 text-sm text-blue-800">
            팀 공유 워크스페이스입니다. 투표와 익명 의견이 참여자 전체 기준으로 집계됩니다. 문서 편집은 이 브라우저에만 유지됩니다.
          </div>
        )}
        {activeView === 'merge' && workspaceState.analysisResult?.source === 'local_harness' && (
          <div className="border-b border-amber-100 bg-amber-50 px-8 py-2 text-sm text-amber-800">
            로컬 하네스 결과입니다. 실제 모델 호출 전 구조 검증과 화면 연결 확인에 사용합니다.
          </div>
        )}
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
          {renderContent()}
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

function createDecisionOverrideLog(
  logIndex: number,
  analysisRunId: number,
  block: ProtocolDecisionBlock,
  beforeOption: ProtocolDecisionOption | undefined,
  afterOption: ProtocolDecisionOption,
): LocalDecisionLog {
  return {
    id: `decision-log-${logIndex + 1}`,
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

function AnalysisLoadingView({ draftCount }: { draftCount: number }) {
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
        <div className="mt-4 space-y-1 text-xs leading-relaxed text-gray-500">
          <div>1. 초안을 섹션별 아이디어 후보로 나눕니다.</div>
          <div>2. 유사 의견과 충돌 의견을 묶습니다.</div>
          <div>3. Decision Block 기준으로 결과 화면을 갱신합니다.</div>
        </div>
      </div>
    </main>
  );
}
