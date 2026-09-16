import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { MAX_ANALYSIS_DRAFT_COUNT } from '../../lib/ai/planmergeProtocol';
import { StatusBadge } from '../StatusBadge';
import { getAnonymousClientId } from '../../lib/anonymousClient';
import type { DraftFormInput, LocalDraftSubmission } from '../../lib/localWorkspace';
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

const initialForm: DraftFormInput = {
  authorName: '',
  authorRole: '',
  aiModel: 'ChatGPT',
  taskTitle: '',
  rawText: '',
};

const MAX_DRAFT_RAW_TEXT_LENGTH = 50000;
const DRAFT_RAW_TEXT_COUNTER_THRESHOLD = 45000;
const MAX_AUTHOR_NAME_LENGTH = 80;
const MAX_AUTHOR_ROLE_LENGTH = 80;
const MAX_TASK_TITLE_LENGTH = 160;
const SHARED_DRAFT_PREVIEW_LENGTH = 200;

export function DraftSubmitPage({
  analysisStatus,
  drafts,
  mode = 'local',
  ownerShareAccess,
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
  const isSharedSubmitMode = mode === 'shared' && Boolean(sharedWorkspaceId);
  const canAnalyze = drafts.length > 0 && analysisStatus !== 'analyzing';
  const draftLimitReached = drafts.length >= MAX_ANALYSIS_DRAFT_COUNT;
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
      setSharedDraftMessage('초안을 제출했습니다. 소유자가 가져오면 분석에 반영됩니다.');
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

  const importSharedDraft = async (draft: SharedWorkspaceDraft) => {
    if (!ownerShareAccess?.manageToken || !onImportSharedDraft || draftLimitReached) {
      return;
    }

    setSharedDraftActionId(draft.id);
    setSharedDraftMessage(null);

    try {
      await updateSharedDraftStatus(ownerShareAccess.workspaceId, draft.id, {
        status: 'imported',
        manageToken: ownerShareAccess.manageToken,
      });

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
    <main className="h-full min-h-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[1fr_320px] lg:py-10">
        <section>
          <h2 className="text-2xl text-gray-900">{isSharedSubmitMode ? '초안 제출' : '새 초안 입력'}</h2>
          <p className="mt-2 text-sm text-gray-600">
            {isSharedSubmitMode
              ? '공유 워크스페이스 소유자에게 전달할 AI 초안을 제출합니다.'
              : '작성자와 원문을 넣으면 병합 분석 대상 초안 목록에 추가됩니다.'}
          </p>

          <form className="mt-8 space-y-5" onSubmit={submitDraftForm}>
            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">초안 작성자</span>
              <input
                value={form.authorName}
                maxLength={MAX_AUTHOR_NAME_LENGTH}
                onChange={(event) => updateForm('authorName', event.target.value)}
                placeholder="예: 수진"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>

            <div className={isSharedSubmitMode ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-3'}>
              {!isSharedSubmitMode && (
                <label className="block">
                  <span className="mb-2 block text-sm text-gray-700">작성자 역할</span>
                  <input
                    value={form.authorRole}
                    maxLength={MAX_AUTHOR_ROLE_LENGTH}
                    onChange={(event) => updateForm('authorRole', event.target.value)}
                    placeholder="예: PM"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-2 block text-sm text-gray-700">사용한 AI</span>
                <select
                  value={form.aiModel}
                  onChange={(event) => updateForm('aiModel', event.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="ChatGPT">ChatGPT</option>
                  <option value="Claude">Claude</option>
                  <option value="Gemini">Gemini</option>
                  <option value="Cursor">Cursor</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm text-gray-700">작업 주제</span>
                <input
                  value={form.taskTitle}
                  maxLength={MAX_TASK_TITLE_LENGTH}
                  onChange={(event) => updateForm('taskTitle', event.target.value)}
                  placeholder="예: MVP 범위"
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">AI 초안 원문</span>
              <textarea
                value={form.rawText}
                maxLength={MAX_DRAFT_RAW_TEXT_LENGTH}
                onChange={(event) => updateForm('rawText', event.target.value)}
                placeholder="AI로 생성한 기획서 초안을 붙여넣기"
                className="min-h-64 w-full rounded-md border border-gray-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-500"
              />
              <div className="mt-1 min-h-5 text-xs text-gray-500">
                {rawTextLength >= DRAFT_RAW_TEXT_COUNTER_THRESHOLD && (
                  <span>
                    {rawTextLength.toLocaleString('ko-KR')} / {MAX_DRAFT_RAW_TEXT_LENGTH.toLocaleString('ko-KR')}자
                  </span>
                )}
              </div>
            </label>

            {draftLimitReached && !isSharedSubmitMode && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                초안은 최대 {MAX_ANALYSIS_DRAFT_COUNT}개까지 저장할 수 있습니다. 기존 초안을 삭제한 뒤 추가해 주세요.
              </p>
            )}

            {displayedSharedDraftMessage && (
              <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                {displayedSharedDraftMessage}
              </p>
            )}

            <button
              type="submit"
              className={`rounded-md px-4 py-2 text-sm text-white ${
                canSubmitDraft
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'cursor-not-allowed bg-gray-300'
              }`}
              disabled={!canSubmitDraft}
            >
              {isSharedSubmitMode
                ? sharedSubmitPending ? '제출 중' : '초안 제출'
                : '초안 저장'}
            </button>
          </form>
        </section>

        <aside>
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
                />
              )}

              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-gray-900">제출된 초안</div>
                <div className="text-xs text-gray-500">{drafts.length}개</div>
              </div>
              <div className="space-y-3">
                {drafts.length > 0 ? (
                  drafts.map((draft) => (
                    <div key={draft.id} className="rounded-md border border-gray-200 p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-gray-900">{draft.taskTitle}</div>
                          <div className="mt-1 text-xs text-gray-600">
                            {draft.authorName} / {draft.aiModel}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`${draft.taskTitle} 초안 삭제`}
                          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => onDeleteDraft(draft.id)}
                        >
                          삭제
                        </button>
                      </div>
                      <StatusBadge variant={draft.status === 'parsed' ? 'success' : 'default'}>
                        {draft.status === 'parsed' ? '분석 완료' : '제출됨'}
                      </StatusBadge>
                      <div className="mt-2 text-xs text-gray-400">{draft.createdAtLabel}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-gray-200 p-4 text-sm leading-relaxed text-gray-500">
                    아직 제출된 초안이 없습니다. 왼쪽 입력 영역에 AI가 작성한 기획서 초안을 붙여넣어 주세요.
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`mt-4 w-full rounded-md px-4 py-2 text-sm transition-colors ${
                  canAnalyze
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400'
                }`}
                disabled={!canAnalyze}
                onClick={onRunAnalysis}
              >
                {analysisStatus === 'analyzing' ? '분석 중' : '병합 분석 실행'}
              </button>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function OwnerSharedDraftPanel({
  actionDraftId,
  draftLimitReached,
  drafts,
  loading,
  onDismiss,
  onImport,
}: {
  actionDraftId: string | null;
  draftLimitReached: boolean;
  drafts: SharedWorkspaceDraft[];
  loading: boolean;
  onDismiss: (draft: SharedWorkspaceDraft) => void;
  onImport: (draft: SharedWorkspaceDraft) => void;
}) {
  return (
    <div data-testid="shared-drafts-owner-panel" className="mb-6 rounded-md border border-blue-100 bg-blue-50/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-gray-900">공유로 제출된 초안 {drafts.length}건</div>
        {loading && <div className="text-xs text-blue-700">불러오는 중</div>}
      </div>

      {draftLimitReached && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          로컬 초안이 {MAX_ANALYSIS_DRAFT_COUNT}개라 가져올 수 없습니다. 기존 초안을 삭제한 뒤 가져오세요.
        </p>
      )}

      <div className="space-y-3">
        {drafts.length > 0 ? (
          drafts.map((draft) => (
            <SharedDraftCard key={draft.id} draft={draft}>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  disabled={draftLimitReached || actionDraftId === draft.id}
                  onClick={() => onImport(draft)}
                >
                  가져오기
                </button>
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:text-gray-400"
                  disabled={actionDraftId === draft.id}
                  onClick={() => onDismiss(draft)}
                >
                  무시
                </button>
              </div>
            </SharedDraftCard>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-blue-100 bg-white/60 p-3 text-xs leading-relaxed text-gray-500">
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
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">{loading ? '불러오는 중' : `${drafts.length}개`}</div>
      </div>

      <div className="space-y-3">
        {drafts.length > 0 ? (
          drafts.map((draft) => (
            <SharedDraftCard key={draft.id} draft={draft} />
          ))
        ) : (
          <div className="rounded-md border border-dashed border-gray-200 p-4 text-sm leading-relaxed text-gray-500">
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
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="min-w-0">
        <div className="truncate text-sm text-gray-900">{draft.taskTitle}</div>
        <div className="mt-1 text-xs text-gray-600">
          {draft.authorName} / {draft.aiModel}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-500">
        {getDraftPreview(draft.rawText)}
      </p>
      <div className="mt-2 text-xs text-gray-400">{formatCreatedAtLabel(draft.createdAt)}</div>
      {children}
    </div>
  );
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
