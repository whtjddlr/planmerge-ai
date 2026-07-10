import { useCallback, useEffect, useState } from 'react';
import { Clipboard, RefreshCw, Share2, Trash2 } from 'lucide-react';
import {
  fetchMyWorkspaces,
  revokeSharedWorkspace,
  SharedWorkspaceRequestError,
  type MySharedWorkspaceSummary,
} from '../../lib/sharedWorkspaceClient';

type MySharesLoadState =
  | { status: 'loading' }
  | { status: 'ready'; workspaces: MySharedWorkspaceSummary[] }
  | { status: 'error'; message: string; statusCode?: number };

type MySharedWorkspacesPageProps = {
  onNotice: (message: string) => void;
  onShareRevoked: (workspaceId: string) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function MySharedWorkspacesPage({ onNotice, onShareRevoked }: MySharedWorkspacesPageProps) {
  const [loadState, setLoadState] = useState<MySharesLoadState>({ status: 'loading' });
  const [revokingWorkspaceId, setRevokingWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextState = await loadMySharesState();

      if (!cancelled) {
        setLoadState(nextState);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshShares = useCallback(async () => {
    setLoadState({ status: 'loading' });
    setLoadState(await loadMySharesState());
  }, []);

  const copyShareLink = useCallback(async (workspaceId: string) => {
    const shareUrl = buildShareUrl(workspaceId);

    try {
      await navigator.clipboard.writeText(shareUrl);
      onNotice('공유 링크를 복사했습니다.');
    } catch {
      onNotice('클립보드 권한이 없어 링크를 직접 복사해 주세요.');
    }
  }, [onNotice]);

  const showRefreshGuide = useCallback(() => {
    onNotice('공유 링크 갱신은 원본 워크스페이스에서 공유 링크 만들기를 다시 실행하세요.');
  }, [onNotice]);

  const revokeShare = useCallback(async (workspace: MySharedWorkspaceSummary) => {
    const title = workspace.title.trim() || '공유 링크';

    if (!window.confirm(`${title} 공유 링크를 회수할까요? 회수 후에는 링크로 접근할 수 없습니다.`)) {
      return;
    }

    setRevokingWorkspaceId(workspace.id);

    try {
      await revokeSharedWorkspace(workspace.id);
      onShareRevoked(workspace.id);
      onNotice('공유 링크를 회수했습니다.');
      setLoadState(await loadMySharesState());
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '공유 링크 회수에 실패했습니다.');
    } finally {
      setRevokingWorkspaceId(null);
    }
  }, [onNotice, onShareRevoked]);

  return (
    <main
      data-testid="my-shared-workspaces-page"
      className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700">
              <Share2 className="h-4 w-4" />
              공유 관리
            </div>
            <h2 className="text-2xl font-semibold text-slate-950">내 공유 링크</h2>
            <p className="mt-1 text-sm leading-7 text-slate-600">
              로그인한 계정으로 만든 공유 링크의 만료일, 참여 현황, 회수 상태를 관리합니다.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
            disabled={loadState.status === 'loading'}
            onClick={() => {
              void refreshShares();
            }}
          >
            <RefreshCw className={`h-4 w-4 ${loadState.status === 'loading' ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        {loadState.status === 'loading' && (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-slate-500">
            공유 링크 목록을 불러오는 중입니다.
          </div>
        )}

        {loadState.status === 'error' && (
          <div
            data-testid="my-shares-error"
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <div className="font-medium">내 공유 링크 목록을 불러오지 못했습니다.</div>
            <p className="mt-1 leading-relaxed">{loadState.message}</p>
            {loadState.statusCode === 503 && (
              <p className="mt-2 text-xs text-amber-800">
                데이터베이스가 없는 테스트 환경에서는 이 화면이 비어 있거나 오류 상태로 표시될 수 있습니다.
              </p>
            )}
          </div>
        )}

        {loadState.status === 'ready' && loadState.workspaces.length === 0 && (
          <div
            data-testid="my-shares-empty"
            className="mt-6 rounded-lg border border-dashed border-slate-200 bg-white p-6 text-sm leading-7 text-slate-600"
          >
            아직 만든 공유 링크가 없습니다. 병합 결과 화면에서 공유 링크를 만들면 이곳에서 만료일과 참여 현황을 관리할 수 있습니다.
          </div>
        )}

        {loadState.status === 'ready' && loadState.workspaces.length > 0 && (
          <div data-testid="my-shares-list" className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="hidden grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_12rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 md:grid">
              <div>공유 문서</div>
              <div>버전</div>
              <div>만료</div>
              <div>참여</div>
              <div className="text-right">작업</div>
            </div>
            <div className="divide-y divide-slate-200">
              {loadState.workspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  className="grid grid-cols-1 gap-3 px-4 py-4 text-sm md:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_12rem] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-950">{workspace.title.trim() || '제목 없는 공유 링크'}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatCreatedAt(workspace.createdAt)} 생성
                    </div>
                  </div>
                  <div className="text-slate-700">v{workspace.snapshotVersion}</div>
                  <div className="text-slate-700">{formatExpiry(workspace.expiresAt)}</div>
                  <div className="text-slate-700">
                    투표 {workspace.participation.totalVoters.toLocaleString('ko-KR')}명 · 의견 {workspace.participation.totalOpinions.toLocaleString('ko-KR')}개
                  </div>
                  <div className="flex justify-start gap-2 md:justify-end">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      onClick={() => {
                        void copyShareLink(workspace.id);
                      }}
                    >
                      <Clipboard className="h-3.5 w-3.5" />
                      복사
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      onClick={showRefreshGuide}
                    >
                      갱신 안내
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:text-red-300"
                      disabled={revokingWorkspaceId === workspace.id}
                      onClick={() => {
                        void revokeShare(workspace);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      회수
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

async function loadMySharesState(): Promise<MySharesLoadState> {
  try {
    return {
      status: 'ready',
      workspaces: await fetchMyWorkspaces(),
    };
  } catch (error) {
    if (error instanceof SharedWorkspaceRequestError) {
      return {
        status: 'error',
        message: error.message,
        ...(error.status !== undefined ? { statusCode: error.status } : {}),
      };
    }

    return {
      status: 'error',
      message: '내 공유 링크 목록을 불러오지 못했습니다.',
    };
  }
}

function buildShareUrl(workspaceId: string) {
  const url = new URL(window.location.href);

  url.search = '';
  url.searchParams.set('ws', workspaceId);
  url.hash = '';

  return url.toString();
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) {
    return '만료일 없음';
  }

  const date = new Date(expiresAt);

  if (Number.isNaN(date.getTime())) {
    return '만료일 확인 필요';
  }

  const remainingDays = Math.ceil((date.getTime() - Date.now()) / DAY_MS);

  if (remainingDays < 0) {
    return '만료됨';
  }

  if (remainingDays === 0) {
    return '오늘 만료';
  }

  if (remainingDays === 1) {
    return '내일 만료';
  }

  return `${remainingDays.toLocaleString('ko-KR')}일 후 만료`;
}

function formatCreatedAt(createdAt: string) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return '생성일 확인 필요';
  }

  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}
