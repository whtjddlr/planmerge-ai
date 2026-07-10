import {
  AlertCircle,
  Bot,
  Check,
  Database,
  FileScan,
  FileText,
  Inbox,
  Play,
  RefreshCw,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { StatusBadge } from '../StatusBadge';
import { getAnonymousClientId } from '../../lib/anonymousClient';
import type { DraftFormInput, LocalDraftSubmission, ProjectSettings } from '../../lib/localWorkspace';
import {
  fetchSharedDrafts,
  SharedWorkspaceRequestError,
  SHARED_DRAFT_FAILED_MESSAGE,
  SHARED_LINK_UNAVAILABLE_MESSAGE,
  SHARED_RATE_LIMIT_MESSAGE,
  submitSharedDraft,
  updateSharedDraftStatus,
} from '../../lib/sharedWorkspaceClient';
import type { SharedWorkspaceDraft } from '../../lib/sharedWorkspaceClient';
import type { SharedWorkspaceOwnerAccess } from '../../lib/sharedWorkspaceOwnerStore';

type DraftSubmitPageProps = {
  analysisStatus: 'idle' | 'analyzing' | 'completed';
  drafts: LocalDraftSubmission[];
  mode?: 'local' | 'shared';
  ownerShareAccess?: SharedWorkspaceOwnerAccess | null;
  project: ProjectSettings;
  sharedWorkspaceId?: string | null;
  onDeleteDraft: (draftId: string) => void;
  onImportSharedDraft?: (draft: DraftFormInput) => boolean;
  onRunAnalysis: () => void;
  onSubmitDraft: (draft: DraftFormInput) => void;
};

type RemoteDraftsState = {
  sourceKey: string;
  status: 'loaded' | 'error';
  drafts: SharedWorkspaceDraft[];
  message?: string;
};

type FileExtractResponse = {
  fileName?: string;
  pageCount?: number | null;
  text?: string;
  truncated?: boolean;
  errors?: string[];
};

const initialForm: DraftFormInput = {
  authorName: '',
  authorRole: '',
  aiModel: 'ChatGPT',
  taskTitle: '',
  rawText: '',
};

const MAX_DRAFT_COUNT = 30;
const MAX_DRAFT_RAW_TEXT_LENGTH = 50000;
const DRAFT_RAW_TEXT_COUNTER_THRESHOLD = 45000;
const MAX_AUTHOR_NAME_LENGTH = 80;
const MAX_AUTHOR_ROLE_LENGTH = 80;
const MAX_TASK_TITLE_LENGTH = 160;
const SHARED_DRAFT_PREVIEW_LENGTH = 220;

export function DraftSubmitPage({
  analysisStatus,
  drafts,
  mode = 'local',
  ownerShareAccess,
  project,
  sharedWorkspaceId,
  onDeleteDraft,
  onImportSharedDraft,
  onRunAnalysis,
  onSubmitDraft,
}: DraftSubmitPageProps) {
  const [form, setForm] = useState<DraftFormInput>(initialForm);
  const [anonymousClientId] = useState(() => getAnonymousClientId());
  const [remoteDraftsState, setRemoteDraftsState] = useState<RemoteDraftsState | null>(null);
  const [remoteDraftRefreshCounter, setRemoteDraftRefreshCounter] = useState(0);
  const [sharedSubmitPending, setSharedSubmitPending] = useState(false);
  const [sharedDraftActionId, setSharedDraftActionId] = useState<string | null>(null);
  const [sharedDraftMessage, setSharedDraftMessage] = useState<string | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [fileExtractPending, setFileExtractPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSharedSubmitMode = mode === 'shared' && Boolean(sharedWorkspaceId);
  const canAnalyze = drafts.length > 0 && analysisStatus !== 'analyzing';
  const draftLimitReached = drafts.length >= MAX_DRAFT_COUNT;
  const rawTextLength = form.rawText.length;
  const remoteDraftWorkspaceId = isSharedSubmitMode
    ? sharedWorkspaceId ?? null
    : ownerShareAccess?.workspaceId ?? null;
  const shouldLoadRemoteDrafts = Boolean(remoteDraftWorkspaceId) &&
    (isSharedSubmitMode || Boolean(ownerShareAccess?.manageToken));
  const remoteDraftSourceKey = shouldLoadRemoteDrafts && remoteDraftWorkspaceId
    ? `${remoteDraftWorkspaceId}:${remoteDraftRefreshCounter}`
    : null;
  const currentRemoteDraftsState = remoteDraftSourceKey && remoteDraftsState?.sourceKey === remoteDraftSourceKey
    ? remoteDraftsState
    : null;
  const visiblePendingSharedDrafts = currentRemoteDraftsState?.status === 'loaded'
    ? currentRemoteDraftsState.drafts
    : [];
  const sharedDraftsLoading = Boolean(remoteDraftSourceKey && remoteDraftsState?.sourceKey !== remoteDraftSourceKey);
  const remoteDraftErrorMessage = currentRemoteDraftsState?.status === 'error'
    ? currentRemoteDraftsState.message ?? '제출된 초안 목록을 불러오지 못했습니다.'
    : null;
  const displayedSharedDraftMessage = sharedDraftMessage ?? remoteDraftErrorMessage;
  const canSubmitDraft = isSharedSubmitMode
    ? Boolean(form.authorName.trim() && form.taskTitle.trim() && form.rawText.trim()) && !sharedSubmitPending
    : Boolean(form.rawText.trim()) && !draftLimitReached;

  const refreshSharedDrafts = () => {
    setSharedDraftMessage(null);
    setRemoteDraftRefreshCounter((current) => current + 1);
  };

  useEffect(() => {
    if (!remoteDraftWorkspaceId || !remoteDraftSourceKey) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const sharedDrafts = await fetchSharedDrafts(remoteDraftWorkspaceId);

        if (!cancelled) {
          setRemoteDraftsState({
            sourceKey: remoteDraftSourceKey,
            status: 'loaded',
            drafts: sharedDrafts,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteDraftsState({
            sourceKey: remoteDraftSourceKey,
            status: 'error',
            drafts: [],
            message: getSharedDraftErrorMessage(error, '제출된 초안 목록을 불러오지 못했습니다.'),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remoteDraftSourceKey, remoteDraftWorkspaceId]);

  const updateForm = (field: keyof DraftFormInput, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const submitLocalDraft = () => {
    if (!canSubmitDraft) {
      return;
    }

    onSubmitDraft(form);
    setForm(initialForm);
    setFileMessage(null);
  };

  const submitRemoteDraft = async () => {
    if (!sharedWorkspaceId || !canSubmitDraft) {
      return;
    }

    setSharedSubmitPending(true);
    setSharedDraftMessage(null);

    try {
      await submitSharedDraft(sharedWorkspaceId, {
        authorName: form.authorName,
        aiModel: form.aiModel,
        taskTitle: form.taskTitle,
        rawText: form.rawText,
        anonymousKey: anonymousClientId,
      });
      setForm(initialForm);
      setFileMessage(null);
      setSharedDraftMessage('초안이 제출됐습니다. 소유자가 가져오면 분석에 반영됩니다.');
      setRemoteDraftRefreshCounter((current) => current + 1);
    } catch (error) {
      setSharedDraftMessage(getSharedDraftErrorMessage(error, '초안 제출에 실패했습니다.'));
    } finally {
      setSharedSubmitPending(false);
    }
  };

  const submitDraft = () => {
    if (isSharedSubmitMode) {
      void submitRemoteDraft();
      return;
    }

    submitLocalDraft();
  };

  const submitDraftForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  const handleDraftFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];

    event.currentTarget.value = '';

    if (!file) {
      return;
    }

    setFileExtractPending(true);
    setFileMessage(`${file.name} 텍스트를 추출하는 중입니다.`);

    try {
      const extraction = await extractFileText(file);
      const text = extraction.text.trim();

      if (!text) {
        throw new Error('추출된 텍스트가 없습니다.');
      }

      setForm((current) => ({
        ...current,
        authorName: current.authorName || '파일 업로드',
        taskTitle: current.taskTitle || fileNameToTitle(extraction.fileName || file.name),
        rawText: text.slice(0, MAX_DRAFT_RAW_TEXT_LENGTH),
      }));
      setFileMessage(
        `${extraction.fileName || file.name}에서 ${text.length.toLocaleString('ko-KR')}자를 가져왔습니다.` +
        `${extraction.pageCount ? ` PDF ${extraction.pageCount}쪽` : ''}` +
        `${extraction.truncated ? ' 길이가 길어 일부만 입력했습니다.' : ''}`,
      );
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : '파일을 읽지 못했습니다.');
    } finally {
      setFileExtractPending(false);
    }
  };

  const importSharedDraft = async (draft: SharedWorkspaceDraft) => {
    if (!ownerShareAccess?.manageToken || !onImportSharedDraft || draftLimitReached) {
      return;
    }

    setSharedDraftActionId(draft.id);
    setSharedDraftMessage(null);

    try {
      const imported = onImportSharedDraft({
        authorName: draft.authorName,
        authorRole: '',
        aiModel: draft.aiModel,
        taskTitle: draft.taskTitle,
        rawText: draft.rawText,
      });

      if (!imported) {
        return;
      }

      await updateSharedDraftStatus(ownerShareAccess.workspaceId, draft.id, {
        status: 'imported',
        manageToken: ownerShareAccess.manageToken,
      });

      setRemoteDraftsState((current) => removeDraftFromRemoteState(current, remoteDraftSourceKey, draft.id));
      setSharedDraftMessage('공유 초안을 로컬 초안으로 가져왔습니다.');
    } catch (error) {
      setSharedDraftMessage(getSharedDraftErrorMessage(error, '공유 초안 상태 변경에 실패했습니다.'));
    } finally {
      setSharedDraftActionId(null);
    }
  };

  const dismissSharedDraft = async (draft: SharedWorkspaceDraft) => {
    if (!ownerShareAccess?.manageToken) {
      return;
    }

    setSharedDraftActionId(draft.id);
    setSharedDraftMessage(null);

    try {
      await updateSharedDraftStatus(ownerShareAccess.workspaceId, draft.id, {
        status: 'dismissed',
        manageToken: ownerShareAccess.manageToken,
      });
      setRemoteDraftsState((current) => removeDraftFromRemoteState(current, remoteDraftSourceKey, draft.id));
      setSharedDraftMessage('공유 초안을 무시했습니다.');
    } catch (error) {
      setSharedDraftMessage(getSharedDraftErrorMessage(error, '공유 초안 상태 변경에 실패했습니다.'));
    } finally {
      setSharedDraftActionId(null);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:py-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
        <section className="space-y-5">
          <ProjectBriefPanel project={project} />

          <form
            data-testid="draft-intake-form"
            className="motion-panel overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
            onSubmit={submitDraftForm}
          >
            <div className="border-b border-slate-100 bg-slate-950 p-5 text-white sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-md border border-white/14 bg-white/8 px-3 py-1 text-xs font-medium text-slate-200">
                    <UploadCloud className="h-3.5 w-3.5 text-emerald-300" />
                    {isSharedSubmitMode ? '참여자 초안' : '초안 수집'}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold">
                    {isSharedSubmitMode ? '초안 제출' : 'AI 초안과 PDF를 한곳에 모으기'}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
                    직접 붙여넣거나 PDF, TXT, MD 파일을 업로드하세요. 저장된 초안은 위 기획 기준과 함께 병합 분석에 들어갑니다.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <IntakeStat label="현재 초안" value={`${drafts.length}/${MAX_DRAFT_COUNT}`} />
                  <IntakeStat label="본문 길이" value={rawTextLength ? rawTextLength.toLocaleString('ko-KR') : '0'} />
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-5 sm:p-6">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                className="hidden"
                onChange={handleDraftFileChange}
              />
              <button
                type="button"
                className="lift-card group rounded-lg border border-dashed border-blue-300 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-4 text-left transition-colors hover:border-blue-400 disabled:cursor-wait disabled:opacity-70"
                disabled={fileExtractPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/18">
                      {fileExtractPending ? <RefreshCw className="h-5 w-5 animate-spin" /> : <FileScan className="h-5 w-5" />}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-950">
                        {fileExtractPending ? '파일 텍스트 추출 중' : 'PDF/TXT/MD 업로드'}
                      </span>
                      <span className="mt-1 block max-w-2xl text-xs leading-6 text-slate-600">
                        PDF는 서버에서 텍스트를 추출하고, TXT/MD는 바로 본문에 채웁니다.
                        스캔 이미지 PDF는 OCR 전에는 읽을 수 없습니다.
                      </span>
                    </span>
                  </div>
                  <span className="inline-flex min-h-9 items-center justify-center rounded-lg bg-white px-3 text-xs font-semibold text-blue-700 shadow-sm group-hover:text-blue-800">
                    파일 선택
                  </span>
                </div>
              </button>

              {fileMessage && (
                <p className="flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm text-white" aria-live="polite">
                  <Check className="h-4 w-4 text-emerald-300" />
                  {fileMessage}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TextField
                  icon={<UserRound className="h-4 w-4" />}
                  label="작성자"
                  maxLength={MAX_AUTHOR_NAME_LENGTH}
                  onChange={(value) => updateForm('authorName', value)}
                  placeholder="예: 수진"
                  value={form.authorName}
                />
                {!isSharedSubmitMode && (
                  <TextField
                    icon={<Database className="h-4 w-4" />}
                    label="작성자 역할"
                    maxLength={MAX_AUTHOR_ROLE_LENGTH}
                    onChange={(value) => updateForm('authorRole', value)}
                    placeholder="예: PM"
                    value={form.authorRole}
                  />
                )}
                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Bot className="h-4 w-4 text-slate-400" />
                    사용한 AI
                  </span>
                  <select
                    value={form.aiModel}
                    onChange={(event) => updateForm('aiModel', event.target.value)}
                    className="focus-ring h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="ChatGPT">ChatGPT</option>
                    <option value="Claude">Claude</option>
                    <option value="Gemini">Gemini</option>
                    <option value="Cursor">Cursor</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
              </div>

              <TextField
                icon={<FileText className="h-4 w-4" />}
                label="작업 주제"
                maxLength={MAX_TASK_TITLE_LENGTH}
                onChange={(value) => updateForm('taskTitle', value)}
                placeholder="예: MVP 범위, 온보딩 기능, 리스크"
                value={form.taskTitle}
              />

              <label className="block">
                <span className="mb-2 flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
                  <span>AI 초안 원문</span>
                  <span className="text-xs font-normal text-slate-400">
                    {rawTextLength.toLocaleString('ko-KR')} / {MAX_DRAFT_RAW_TEXT_LENGTH.toLocaleString('ko-KR')}
                  </span>
                </span>
                <textarea
                  data-testid="draft-raw-text-input"
                  value={form.rawText}
                  maxLength={MAX_DRAFT_RAW_TEXT_LENGTH}
                  onChange={(event) => updateForm('rawText', event.target.value)}
                  placeholder="AI로 생성한 기획 초안, 회의 요약, 또는 PDF에서 추출한 텍스트가 여기에 들어갑니다."
                  className="focus-ring min-h-72 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm leading-7 text-slate-900 placeholder:text-slate-400"
                />
                {rawTextLength >= DRAFT_RAW_TEXT_COUNTER_THRESHOLD && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5" />
                    입력 길이가 제한에 가까워지고 있습니다.
                  </div>
                )}
              </label>

              {draftLimitReached && !isSharedSubmitMode && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  초안은 최대 {MAX_DRAFT_COUNT}개까지 저장할 수 있습니다. 기존 초안을 삭제한 뒤 추가해 주세요.
                </p>
              )}

              {displayedSharedDraftMessage && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  {displayedSharedDraftMessage}
                </p>
              )}

              <button
                data-testid="draft-submit-button"
                type="submit"
                className={`inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white transition-colors ${
                  canSubmitDraft
                    ? 'bg-slate-950 hover:bg-blue-700'
                    : 'cursor-not-allowed bg-slate-300'
                }`}
                disabled={!canSubmitDraft}
              >
                {isSharedSubmitMode
                  ? sharedSubmitPending ? '제출 중' : '초안 제출'
                  : '초안 저장'}
                <Check className="h-4 w-4" />
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          {isSharedSubmitMode ? (
            <SharedDraftList
              drafts={visiblePendingSharedDrafts}
              loading={sharedDraftsLoading}
              title="제출 대기 초안"
            />
          ) : (
            <>
              {ownerShareAccess?.manageToken && (
                <OwnerSharedDraftPanel
                  actionDraftId={sharedDraftActionId}
                  draftLimitReached={draftLimitReached}
                  drafts={visiblePendingSharedDrafts}
                  loading={sharedDraftsLoading}
                  onDismiss={dismissSharedDraft}
                  onImport={importSharedDraft}
                  onRefresh={refreshSharedDrafts}
                />
              )}

              <DraftList drafts={drafts} onDeleteDraft={onDeleteDraft} />

              <button
                type="button"
                data-testid="run-analysis-button"
                className={`pulse-border inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
                  canAnalyze
                    ? 'bg-slate-950 text-white hover:bg-emerald-700'
                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                }`}
                disabled={!canAnalyze}
                onClick={onRunAnalysis}
              >
                <Play className="h-4 w-4" />
                {analysisStatus === 'analyzing' ? '분석 중' : `${drafts.length}개 초안으로 병합 분석 실행`}
              </button>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function ProjectBriefPanel({ project }: { project: ProjectSettings }) {
  const briefItems = [
    { label: '목표', value: project.goal },
    { label: '공통 배경', value: project.contextPack },
    { label: '금지 방향', value: project.forbiddenDirection },
    { label: '출력 스타일', value: project.outputStyle },
  ];

  return (
    <section className="motion-panel rounded-lg border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
            <Database className="h-4 w-4" />
            적용 중인 기획 기준
          </div>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">
            {project.title.trim() || '프로젝트 기준이 아직 비어 있습니다'}
          </h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            아래 기준이 GMS/로컬 분석 요청에 함께 전달됩니다. 초안만 넣는 도구가 아니라, 기획 기준으로 의견을 판단하는 흐름입니다.
          </p>
        </div>
        <StatusBadge variant={project.goal.trim() ? 'success' : 'warning'}>
          {project.goal.trim() ? '기준 연결됨' : '기준 입력 필요'}
        </StatusBadge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {briefItems.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="text-xs font-medium text-slate-500">{item.label}</div>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-700">
              {item.value.trim() || '아직 입력하지 않았습니다.'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TextField({
  icon,
  label,
  maxLength,
  onChange,
  placeholder,
  value,
}: {
  icon: ReactNode;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
        <span className="text-slate-400">{icon}</span>
        {label}
      </span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="focus-ring h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
      />
    </label>
  );
}

function DraftList({
  drafts,
  onDeleteDraft,
}: {
  drafts: LocalDraftSubmission[];
  onDeleteDraft: (draftId: string) => void;
}) {
  return (
    <section className="motion-panel-delay rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Inbox className="h-4 w-4 text-blue-600" />
          저장된 초안
        </div>
        <div className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">{drafts.length}개</div>
      </div>
      <div className="space-y-3">
        {drafts.length > 0 ? (
          drafts.map((draft) => (
            <div key={draft.id} className="lift-card rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-950">{draft.taskTitle}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {draft.authorName} / {draft.aiModel}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`${draft.taskTitle} 초안 삭제`}
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  onClick={() => onDeleteDraft(draft.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <StatusBadge variant={draft.status === 'parsed' ? 'success' : 'default'}>
                {draft.status === 'parsed' ? '분석 완료' : '저장됨'}
              </StatusBadge>
              <p className="mt-2 line-clamp-3 text-xs leading-6 text-slate-500">
                {getDraftPreview(draft.rawText)}
              </p>
              <div className="mt-2 text-xs text-slate-400">{draft.createdAtLabel}</div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm leading-7 text-slate-500">
            아직 저장된 초안이 없습니다. 왼쪽에 직접 붙여넣거나 PDF 파일을 업로드해 주세요.
          </div>
        )}
      </div>
    </section>
  );
}

function OwnerSharedDraftPanel({
  actionDraftId,
  draftLimitReached,
  drafts,
  loading,
  onDismiss,
  onImport,
  onRefresh,
}: {
  actionDraftId: string | null;
  draftLimitReached: boolean;
  drafts: SharedWorkspaceDraft[];
  loading: boolean;
  onDismiss: (draft: SharedWorkspaceDraft) => void;
  onImport: (draft: SharedWorkspaceDraft) => void;
  onRefresh: () => void;
}) {
  return (
    <div
      data-testid="shared-drafts-owner-panel"
      className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.07)]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950">공유로 제출된 초안 {drafts.length}건</div>
        <div className="flex items-center gap-2">
          {loading && <div className="text-xs text-blue-700">불러오는 중</div>}
          <button
            type="button"
            data-testid="shared-drafts-refresh-button"
            className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:text-slate-400"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      {draftLimitReached && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
          로컬 초안이 {MAX_DRAFT_COUNT}개라 가져올 수 없습니다. 기존 초안을 삭제한 뒤 가져오세요.
        </p>
      )}

      <div className="space-y-3">
        {drafts.length > 0 ? (
          drafts.map((draft) => (
            <SharedDraftCard key={draft.id} draft={draft}>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={draftLimitReached || actionDraftId === draft.id}
                  onClick={() => onImport(draft)}
                >
                  <Check className="h-3.5 w-3.5" />
                  가져오기
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  disabled={actionDraftId === draft.id}
                  onClick={() => onDismiss(draft)}
                >
                  <X className="h-3.5 w-3.5" />
                  무시
                </button>
              </div>
            </SharedDraftCard>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-blue-100 bg-white/70 p-3 text-xs leading-6 text-slate-500">
            대기 중인 공유 초안이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function SharedDraftList({
  drafts,
  loading,
  title,
}: {
  drafts: SharedWorkspaceDraft[];
  loading: boolean;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950">{title}</div>
        <div className="text-xs text-slate-500">{loading ? '불러오는 중' : `${drafts.length}개`}</div>
      </div>

      <div className="space-y-3">
        {drafts.length > 0 ? (
          drafts.map((draft) => (
            <SharedDraftCard key={draft.id} draft={draft} />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm leading-7 text-slate-500">
            아직 제출 대기 중인 초안이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function SharedDraftCard({
  children,
  draft,
}: {
  children?: ReactNode;
  draft: SharedWorkspaceDraft;
}) {
  return (
    <div className="lift-card rounded-lg border border-slate-200 bg-white p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-950">{draft.taskTitle}</div>
        <div className="mt-1 text-xs text-slate-600">
          {draft.authorName} / {draft.aiModel}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-500">
        {getDraftPreview(draft.rawText)}
      </p>
      <div className="mt-2 text-xs text-slate-400">{formatCreatedAtLabel(draft.createdAt)}</div>
      {children}
    </div>
  );
}

function IntakeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-lg border border-white/12 bg-white/8 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

async function extractFileText(file: File): Promise<Required<Pick<FileExtractResponse, 'text'>> & FileExtractResponse> {
  if (isPlainTextFile(file)) {
    return {
      fileName: file.name,
      pageCount: null,
      text: await file.text(),
      truncated: file.size > MAX_DRAFT_RAW_TEXT_LENGTH,
    };
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/extract-text', {
    method: 'POST',
    body: formData,
  });
  const payload = await readExtractResponse(response);

  if (!response.ok) {
    throw new Error(payload.errors?.[0] ?? `파일 추출 실패: ${response.status}`);
  }

  if (!payload.text) {
    throw new Error('파일에서 읽을 수 있는 텍스트를 찾지 못했습니다.');
  }

  return {
    ...payload,
    text: payload.text,
  };
}

async function readExtractResponse(response: Response): Promise<FileExtractResponse> {
  try {
    const payload: unknown = await response.json();

    if (!isRecord(payload)) {
      return {};
    }

    return {
      fileName: typeof payload.fileName === 'string' ? payload.fileName : undefined,
      pageCount: typeof payload.pageCount === 'number' ? payload.pageCount : null,
      text: typeof payload.text === 'string' ? payload.text : undefined,
      truncated: payload.truncated === true,
      errors: Array.isArray(payload.errors)
        ? payload.errors.filter((item): item is string => typeof item === 'string')
        : undefined,
    };
  } catch {
    return {};
  }
}

function isPlainTextFile(file: File) {
  return file.type.startsWith('text/') || /\.(txt|md|markdown)$/i.test(file.name);
}

function fileNameToTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || '업로드 초안';
}

function getSharedDraftErrorMessage(error: unknown, fallback: string) {
  if (error instanceof SharedWorkspaceRequestError) {
    if (error.status === 429) {
      return SHARED_RATE_LIMIT_MESSAGE;
    }

    if (error.status === 410) {
      return SHARED_LINK_UNAVAILABLE_MESSAGE;
    }

    return error.message || SHARED_DRAFT_FAILED_MESSAGE;
  }

  return fallback;
}

function removeDraftFromRemoteState(
  current: RemoteDraftsState | null,
  sourceKey: string | null,
  draftId: string,
): RemoteDraftsState | null {
  if (!current || !sourceKey || current.sourceKey !== sourceKey || current.status !== 'loaded') {
    return current;
  }

  return {
    ...current,
    drafts: current.drafts.filter((draft) => draft.id !== draftId),
  };
}

function getDraftPreview(rawText: string) {
  const trimmed = rawText.trim();

  return trimmed.length > SHARED_DRAFT_PREVIEW_LENGTH
    ? `${trimmed.slice(0, SHARED_DRAFT_PREVIEW_LENGTH)}...`
    : trimmed;
}

function formatCreatedAtLabel(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
