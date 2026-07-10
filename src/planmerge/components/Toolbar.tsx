import {
  ClipboardList,
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthControl } from './AuthControl';
import type { AppView } from '../types/navigation';
import type { PublicationReadiness, PublicationReadinessLevel } from '../lib/publicationReadiness';

type ToolbarProps = {
  activeView: AppView;
  analysisStatus: 'idle' | 'analyzing' | 'completed';
  canRevokeSharedWorkspace: boolean;
  draftCount: number;
  hasMergeResult: boolean;
  normalizedIdeaCount: number;
  onExportMarkdown: () => void;
  onExportWorkspace: () => void;
  onImportWorkspace: () => void;
  onPrimaryAction: () => void;
  onReanalyze: () => void;
  onRevokeSharedWorkspace: () => void;
  onShareWorkspace: () => void;
  onViewChange: (view: AppView) => void;
  projectTitle: string;
  publicationReadiness: PublicationReadiness;
  sharedMode: boolean;
};

const viewCopy: Record<AppView, { title: string; subtitle: string; breadcrumb: string }> = {
  setup: {
    title: '프로젝트 설정',
    subtitle: 'AI 초안을 병합하기 전에 목표, 배경, 제외 범위를 정리합니다.',
    breadcrumb: '프로젝트 / 설정',
  },
  drafts: {
    title: '초안 입력',
    subtitle: '사람마다 다른 AI 초안과 PDF 자료를 같은 기준으로 모읍니다.',
    breadcrumb: '프로젝트 / 초안 입력',
  },
  merge: {
    title: '병합 결과',
    subtitle: '선택안, 대안, 충돌 의견을 근거와 함께 검토합니다.',
    breadcrumb: '프로젝트 / 병합 결과',
  },
  inspector: {
    title: '분석 검토',
    subtitle: '정규화된 아이디어, 출처, 결정 블록, 검증 상태를 확인합니다.',
    breadcrumb: '프로젝트 / 분석 검토',
  },
  openQuestions: {
    title: '검토 큐',
    subtitle: '공유 전에 보완해야 할 충돌, 검토, 입력 부족 섹션을 정리합니다.',
    breadcrumb: '프로젝트 / 검토 큐',
  },
  myShares: {
    title: '내 공유 링크',
    subtitle: '로그인한 계정으로 만든 공유 링크를 관리합니다.',
    breadcrumb: '계정 / 내 공유 링크',
  },
};

export function Toolbar({
  activeView,
  analysisStatus,
  canRevokeSharedWorkspace,
  draftCount,
  hasMergeResult,
  normalizedIdeaCount,
  onExportMarkdown,
  onExportWorkspace,
  onImportWorkspace,
  onPrimaryAction,
  onReanalyze,
  onRevokeSharedWorkspace,
  onShareWorkspace,
  onViewChange,
  projectTitle,
  publicationReadiness,
  sharedMode,
}: ToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const shareDisabled = !hasMergeResult || !publicationReadiness.canShare;
  const shareDisabledTitle = !hasMergeResult
    ? '분석 결과가 있어야 공유할 수 있습니다.'
    : publicationReadiness.canShare
      ? undefined
      : publicationReadiness.detail;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const copy = {
    ...viewCopy[activeView],
    breadcrumb:
      activeView === 'merge'
        ? `프로젝트 / ${projectTitle.trim() || '새 프로젝트'}`
        : viewCopy[activeView].breadcrumb,
    subtitle:
      activeView === 'merge'
        ? getMergeSubtitle(draftCount, normalizedIdeaCount, hasMergeResult)
        : activeView === 'inspector'
          ? `${draftCount}개 초안을 기준으로 분석 구조를 검토합니다.`
          : activeView === 'drafts' && sharedMode
            ? '공유 워크스페이스에 AI 초안을 제출합니다.'
            : viewCopy[activeView].subtitle,
  };

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <header className="relative z-40 flex-shrink-0 border-b border-slate-200/70 bg-white/82 backdrop-blur-xl">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
              {copy.breadcrumb}
            </span>
            <ReadinessBadge level={publicationReadiness.level} />
          </div>
          <h1 className="text-xl font-semibold text-slate-950">{copy.title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{copy.subtitle}</p>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-start gap-2 lg:justify-end">
          <ToolbarMetric label="초안" value={draftCount.toString()} />
          <ToolbarMetric label="아이디어" value={hasMergeResult ? normalizedIdeaCount.toString() : '-'} />

          <div ref={menuContainerRef} className="relative flex flex-shrink-0 items-center gap-2">
            {activeView === 'merge' && hasMergeResult && !sharedMode && (
              <button
                type="button"
                data-testid="publication-primary-action"
                className={`focus-ring inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white transition-colors ${
                  publicationReadiness.level === 'ready'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-950 hover:bg-slate-800'
                } disabled:cursor-not-allowed disabled:bg-slate-300`}
                disabled={analysisStatus === 'analyzing'}
                title={publicationReadiness.detail}
                onClick={onPrimaryAction}
              >
                {publicationReadiness.level === 'ready'
                  ? <FileDown className="h-4 w-4" />
                  : <ClipboardList className="h-4 w-4" />}
                {publicationPrimaryActionLabel(publicationReadiness)}
              </button>
            )}

            <button
              type="button"
              data-testid="toolbar-menu-button"
              className="focus-ring grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              aria-label="추가 작업"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>

            {menuOpen && (
              <div className="motion-panel absolute right-0 top-12 z-50 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/12">
                {!sharedMode && (
                  <>
                    <MenuButton
                      testId="toolbar-add-draft-button"
                      icon={<FilePlus2 className="h-4 w-4" />}
                      onClick={() => runMenuAction(() => onViewChange('drafts'))}
                    >
                      초안 추가
                    </MenuButton>
                    <MenuButton
                      testId="toolbar-rerun-analysis-button"
                      icon={<RefreshCw className={`h-4 w-4 ${analysisStatus === 'analyzing' ? 'animate-spin' : ''}`} />}
                      disabled={analysisStatus === 'analyzing'}
                      onClick={() => runMenuAction(onReanalyze)}
                    >
                      {analysisStatus === 'analyzing' ? '분석 중' : '다시 분석'}
                    </MenuButton>
                  </>
                )}
                {!sharedMode && (
                  <MenuButton
                    testId="share-workspace-button"
                    icon={<Share2 className="h-4 w-4" />}
                    disabled={shareDisabled}
                    title={shareDisabledTitle}
                    onClick={() => runMenuAction(onShareWorkspace)}
                  >
                    공유 링크 만들기
                  </MenuButton>
                )}
                {canRevokeSharedWorkspace && (
                  <MenuButton
                    tone="danger"
                    icon={<Undo2 className="h-4 w-4" />}
                    onClick={() => runMenuAction(onRevokeSharedWorkspace)}
                  >
                    공유 링크 회수
                  </MenuButton>
                )}
                <div className="my-1 border-t border-slate-100" />
                <MenuButton
                  testId="export-markdown-button"
                  icon={<FileDown className="h-4 w-4" />}
                  onClick={() => runMenuAction(onExportMarkdown)}
                >
                  {publicationReadiness.canShare ? 'Markdown 내보내기' : '검토본 Markdown 내보내기'}
                </MenuButton>
                <MenuButton
                  testId="export-workspace-button"
                  icon={<Download className="h-4 w-4" />}
                  onClick={() => runMenuAction(onExportWorkspace)}
                >
                  워크스페이스 내보내기
                </MenuButton>
                {!sharedMode && (
                  <MenuButton
                    icon={<FolderOpen className="h-4 w-4" />}
                    onClick={() => runMenuAction(onImportWorkspace)}
                  >
                    워크스페이스 가져오기
                  </MenuButton>
                )}
              </div>
            )}
          </div>
          <AuthControl onOpenMyShares={() => onViewChange('myShares')} />
        </div>
      </div>
    </header>
  );
}

function ToolbarMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm sm:block">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ReadinessBadge({ level }: { level: PublicationReadinessLevel }) {
  if (level === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
        <ShieldAlert className="h-3.5 w-3.5" />
        사용 보류
      </span>
    );
  }

  if (level === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
        <ShieldCheck className="h-3.5 w-3.5" />
        공유 가능
      </span>
    );
  }

  if (level === 'review') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-100 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
        <ShieldAlert className="h-3.5 w-3.5" />
        공유 보류
      </span>
    );
  }

  return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" />
      검증 대기
      </span>
  );
}

function publicationPrimaryActionLabel(readiness: PublicationReadiness) {
  if (readiness.level === 'ready') {
    return '최종본 내보내기';
  }

  if (readiness.level === 'blocked') {
    return '품질 문제 확인';
  }

  return readiness.unresolvedCount > 0
    ? `남은 검토 ${readiness.unresolvedCount}건`
    : '보완 항목 확인';
}

function MenuButton({
  children,
  disabled,
  icon,
  onClick,
  testId,
  title,
  tone = 'default',
}: {
  children: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  testId?: string;
  title?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      data-testid={testId}
      type="button"
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-slate-400 ${
        tone === 'danger'
          ? 'text-red-700 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'
      }`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="text-current">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

function getMergeSubtitle(draftCount: number, normalizedIdeaCount: number, hasMergeResult: boolean) {
  if (!draftCount) {
    return '프로젝트 설정 뒤 AI 초안을 입력하면 병합 결과가 생성됩니다.';
  }

  if (!hasMergeResult) {
    return `${draftCount}개 초안이 준비됐습니다. 병합 분석을 실행해 주세요.`;
  }

  return `${draftCount}개 초안에서 ${normalizedIdeaCount}개 아이디어를 추출했습니다.`;
}
