import { useState } from 'react';
import type { AppView } from '../types/navigation';

type ToolbarProps = {
  activeView: AppView;
  approvalStatus: 'pending' | 'approved';
  analysisStatus: 'idle' | 'analyzing' | 'completed';
  draftCount: number;
  normalizedIdeaCount: number;
  onApprove: () => void;
  onExportMarkdown: () => void;
  onExportWorkspace: () => void;
  onImportWorkspace: () => void;
  onReanalyze: () => void;
  onShareWorkspace: () => void;
  onViewChange: (view: AppView) => void;
  projectTitle: string;
  sharedMode: boolean;
};

const viewCopy: Record<AppView, { title: string; subtitle: string; breadcrumb: string }> = {
  setup: {
    title: '프로젝트 설정',
    subtitle: '기획서 목표와 공통 기준을 정리합니다',
    breadcrumb: '프로젝트 / 설정',
  },
  drafts: {
    title: '초안 입력',
    subtitle: '팀원이 만든 AI 초안을 붙여넣고 제출 정보를 관리합니다',
    breadcrumb: '프로젝트 / 초안 입력',
  },
  merge: {
    title: '병합 결과',
    subtitle: '3개의 AI 초안에서 42개의 아이디어를 추출했습니다',
    breadcrumb: '프로젝트 / AI 공동 기획서 병합 도구',
  },
  inspector: {
    title: 'Analysis Inspector',
    subtitle: '정규화 아이디어, 출처, Decision Block, 검증 상태를 확인합니다',
    breadcrumb: '프로젝트 / 분석 Inspector',
  },
  openQuestions: {
    title: 'Review Queue',
    subtitle: '내보내기 전에 처리할 충돌, 검토, 입력 부족 섹션을 정리합니다',
    breadcrumb: '프로젝트 / Review Queue',
  },
};

export function Toolbar({
  activeView,
  approvalStatus,
  analysisStatus,
  draftCount,
  normalizedIdeaCount,
  onApprove,
  onExportMarkdown,
  onExportWorkspace,
  onImportWorkspace,
  onReanalyze,
  onShareWorkspace,
  onViewChange,
  projectTitle,
  sharedMode,
}: ToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const copy = {
    ...viewCopy[activeView],
    breadcrumb: activeView === 'merge'
      ? `프로젝트 / ${projectTitle}`
      : viewCopy[activeView].breadcrumb,
    subtitle: activeView === 'merge'
      ? `${draftCount}개 초안에서 ${normalizedIdeaCount}개 아이디어를 추출했습니다`
      : activeView === 'inspector'
        ? `${draftCount}개의 초안을 기준으로 분석 구조를 검사합니다`
      : viewCopy[activeView].subtitle,
  };

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <div className="border-b border-gray-200 bg-white flex-shrink-0">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-xs text-gray-500 mb-1">{copy.breadcrumb}</div>
          <h1 className="text-lg text-gray-900 mb-1">{copy.title}</h1>
          <div className="text-sm text-gray-600">{copy.subtitle}</div>
        </div>
        <div className="relative flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="추가 작업"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            •••
          </button>
          {activeView === 'merge' && (
            <button
              type="button"
              className={`px-4 py-1.5 rounded-md text-sm text-white transition-colors ${
                approvalStatus === 'approved'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
              disabled={analysisStatus === 'analyzing'}
              onClick={onApprove}
            >
              {approvalStatus === 'approved' ? '승인 완료' : '선택안 승인'}
            </button>
          )}
          {menuOpen && (
            <div className="absolute right-0 top-10 z-10 w-44 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => runMenuAction(() => onViewChange('drafts'))}
              >
                초안 추가
              </button>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:text-gray-400"
                disabled={analysisStatus === 'analyzing'}
                onClick={() => runMenuAction(onReanalyze)}
              >
                {analysisStatus === 'analyzing' ? '분석 중' : '다시 분석'}
              </button>
              {!sharedMode && (
                <button
                  type="button"
                  className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => runMenuAction(onShareWorkspace)}
                >
                  팀 공유 링크 만들기
                </button>
              )}
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => runMenuAction(onExportMarkdown)}
              >
                Markdown 내보내기
              </button>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => runMenuAction(onExportWorkspace)}
              >
                워크스페이스 내보내기
              </button>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => runMenuAction(onImportWorkspace)}
              >
                워크스페이스 가져오기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
