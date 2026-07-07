import { useEffect, useMemo, useRef, useState } from 'react';
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
  const navItems = [
    { label: '프로젝트 설정', view: 'setup' as const },
    { label: '초안 입력', view: 'drafts' as const },
    { label: '병합 결과', view: 'merge' as const },
    { label: '분석 Inspector', view: 'inspector' as const },
    { label: 'Review Queue', view: 'openQuestions' as const },
  ];

  return (
    <div className="flex w-full flex-shrink-0 flex-col border-b border-gray-200 bg-gray-50 md:h-dvh md:w-60 md:border-b-0 md:border-r">
      <div className="border-b border-gray-200 p-4 md:p-5">
        <div className="text-sm mb-1 text-gray-900">PlanMerge</div>
        <div className="text-xs text-gray-600">AI 공동 기획서 병합 도구</div>
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

      <nav className="grid gap-3 p-3 md:block md:flex-1">
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:block md:space-y-0.5">
          {navItems.map((item, index) => (
            <li key={index} className="min-w-0 md:block">
              <button
                type="button"
                onClick={() => onViewChange(item.view)}
                aria-current={activeView === item.view ? 'page' : undefined}
                className={`min-h-10 w-full rounded-md px-3 py-2 text-left text-sm leading-5 transition-colors md:min-h-0 md:whitespace-nowrap ${
                  activeView === item.view
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="justify-self-start px-1 md:mt-6 md:px-3">
          <StatusBadge variant={getAnalysisStatusVariant(analysisStatus)}>
            {getAnalysisStatusLabel(analysisStatus)}
          </StatusBadge>
        </div>
      </nav>

      <div className="hidden border-t border-gray-200 p-5 md:block">
        <div className="text-xs text-gray-500">MVP v0.1</div>
      </div>
    </div>
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
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:border-gray-300"
        aria-label="워크스페이스 선택"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="block text-[11px] text-gray-500">워크스페이스</span>
        <span
          data-testid="workspace-switcher-active-title"
          className="mt-0.5 block truncate text-sm text-gray-900"
        >
          {activeTitle}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          <div className="max-h-72 overflow-y-auto">
            {workspaces.map((workspace) => {
              const selected = workspace.id === activeWorkspaceId;

              return (
                <div
                  key={workspace.id}
                  className="flex items-center gap-2 rounded px-2 py-2 hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-900">{getWorkspaceTitle(workspace)}</div>
                    {selected && <div className="mt-0.5 text-[11px] text-blue-600">현재 워크스페이스</div>}
                  </div>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:text-gray-400"
                    disabled={selected}
                    onClick={() => runAction(() => onSwitchWorkspace(workspace.id))}
                  >
                    전환
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    onClick={() => runAction(() => onDeleteWorkspace(workspace.id))}
                  >
                    삭제
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-1 border-t border-gray-100 pt-1">
            <button
              type="button"
              data-testid="workspace-create-button"
              className="w-full rounded px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => runAction(onCreateWorkspace)}
            >
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
