import {
  Check,
  ChevronDown,
  ClipboardList,
  FileInput,
  GitMerge,
  LayoutDashboard,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { StatusBadge } from './StatusBadge';
import { SAMPLE_WORKSPACE_ID, type LocalWorkspaceMetadata } from '../lib/localWorkspace';
import type { AppView } from '../types/navigation';

type SidebarProps = {
  activeView: AppView;
  activeWorkspaceId: string | null;
  analysisStatus: 'idle' | 'analyzing' | 'completed';
  sharedMode: boolean;
  workspaces: LocalWorkspaceMetadata[];
  onCreateWorkspace: () => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  onViewChange: (view: AppView) => void;
};

type NavItem = {
  description: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  view: AppView;
};

const navItems: NavItem[] = [
  { label: '프로젝트 설정', description: '기준 고정', icon: LayoutDashboard, view: 'setup' },
  { label: '초안 입력', description: 'PDF와 모델 초안', icon: FileInput, view: 'drafts' },
  { label: '병합 결과', description: '최종 문서', icon: GitMerge, view: 'merge' },
  { label: '분석 검토', description: '근거와 로그', icon: ShieldCheck, view: 'inspector' },
  { label: '검토 큐', description: '보완할 항목', icon: ClipboardList, view: 'openQuestions' },
];

export function Sidebar({
  activeView,
  activeWorkspaceId,
  analysisStatus,
  sharedMode,
  workspaces,
  onCreateWorkspace,
  onDeleteWorkspace,
  onSwitchWorkspace,
  onViewChange,
}: SidebarProps) {
  const visibleNavItems = navItems.filter((item) => !sharedMode || item.view !== 'setup');

  return (
    <aside className="flex w-full flex-shrink-0 flex-col border-b border-slate-200/70 bg-white/82 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl md:h-dvh md:w-72 md:border-b-0 md:border-r">
      <div className="border-b border-slate-200/70 p-4 md:p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-950 text-sm font-semibold text-white shadow-lg shadow-slate-900/18">
            PM
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-950">PlanMerge</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                MVP
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">AI 공동 기획 병합 도구</div>
          </div>
        </div>

        {!sharedMode && (
          <WorkspaceSwitcher
            activeWorkspaceId={activeWorkspaceId}
            workspaces={workspaces}
            onCreateWorkspace={onCreateWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            onSwitchWorkspace={onSwitchWorkspace}
          />
        )}
      </div>

      <nav className="grid gap-3 p-3 md:flex md:flex-1 md:flex-col md:p-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:block md:space-y-1.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.view;

            return (
              <li key={item.view} className="min-w-0">
                <button
                  type="button"
                  data-testid={`nav-${item.view}`}
                  onClick={() => onViewChange(item.view)}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all md:min-h-[54px] ${
                    active
                      ? 'bg-slate-950 text-white shadow-lg shadow-slate-900/16'
                      : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-950'
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-md border transition-colors ${
                      active
                        ? 'border-white/16 bg-white/12 text-white'
                        : 'border-slate-200 bg-white text-slate-500 group-hover:border-slate-300 group-hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium leading-5">{item.label}</span>
                    <span className={`hidden truncate text-[11px] md:block ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {item.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:mt-auto">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">분석 상태</span>
            <StatusBadge variant={getAnalysisStatusVariant(analysisStatus)}>
              {getAnalysisStatusLabel(analysisStatus)}
            </StatusBadge>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                analysisStatus === 'completed'
                  ? 'w-full bg-emerald-500'
                  : analysisStatus === 'analyzing'
                    ? 'w-2/3 bg-amber-400'
                    : 'w-1/4 bg-slate-300'
              }`}
            />
          </div>
        </div>
      </nav>

      <div className="hidden border-t border-slate-200/70 p-5 md:block">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>파일럿 검증 준비됨</span>
        </div>
      </div>
    </aside>
  );
}

function WorkspaceSwitcher({
  activeWorkspaceId,
  workspaces,
  onCreateWorkspace,
  onDeleteWorkspace,
  onSwitchWorkspace,
}: {
  activeWorkspaceId: string | null;
  workspaces: LocalWorkspaceMetadata[];
  onCreateWorkspace: () => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeTitle = useMemo(
    () => getWorkspaceTitle(workspaces.find((workspace) => workspace.id === activeWorkspaceId)),
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const runAction = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div ref={containerRef} data-testid="workspace-switcher" className="relative mt-4">
      <button
        type="button"
        data-testid="workspace-switcher-button"
        className="focus-ring group w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 text-left transition-colors hover:border-slate-300 hover:bg-white"
        aria-label="워크스페이스 선택"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase text-slate-500">
              작업 공간
            </span>
            <span
              data-testid="workspace-switcher-active-title"
              className="mt-1 block truncate text-sm font-medium text-slate-950"
            >
              {activeTitle}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="motion-panel absolute left-0 right-0 top-full z-20 mt-2 rounded-lg border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/12">
          <div className="max-h-72 overflow-y-auto">
            {workspaces.map((workspace) => {
              const selected = workspace.id === activeWorkspaceId;

              return (
                <div
                  key={workspace.id}
                  className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{getWorkspaceTitle(workspace)}</div>
                    {selected && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-700">
                        <Check className="h-3 w-3" />
                        현재 워크스페이스
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:text-slate-400"
                    disabled={selected}
                    onClick={() => runAction(() => onSwitchWorkspace(workspace.id))}
                  >
                    전환
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-red-600 hover:bg-red-50"
                    aria-label={`${getWorkspaceTitle(workspace)} 삭제`}
                    onClick={() => runAction(() => onDeleteWorkspace(workspace.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button
              type="button"
              data-testid="workspace-create-button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => runAction(onCreateWorkspace)}
            >
              <Plus className="h-4 w-4 text-blue-600" />
              새 워크스페이스
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getWorkspaceTitle(workspace: LocalWorkspaceMetadata | undefined) {
  if (!workspace) {
    return '새 워크스페이스';
  }

  if (workspace.id === SAMPLE_WORKSPACE_ID) {
    return '검증 샘플';
  }

  return workspace.title.trim() || '새 워크스페이스';
}

function getAnalysisStatusLabel(status: SidebarProps['analysisStatus']) {
  if (status === 'analyzing') return '분석 중';
  if (status === 'completed') return '분석 완료';
  return '분석 대기';
}

function getAnalysisStatusVariant(status: SidebarProps['analysisStatus']) {
  if (status === 'analyzing') return 'warning';
  if (status === 'completed') return 'success';
  return 'default';
}
