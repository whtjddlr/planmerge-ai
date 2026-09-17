import { StatusBadge } from './StatusBadge';
import type { SectionStatus } from '../data/mergeResult';

interface DocumentSectionProps {
  number: number;
  title: string;
  content?: string;
  status?: SectionStatus;
  active?: boolean;
  onClick?: () => void;
  /** 결정이 바뀌었는데 본문은 이전 선택안 기준인가. */
  stale?: boolean;
  recomposing?: boolean;
  onRecompose?: () => void;
}

export function DocumentSection({
  number,
  title,
  content,
  status,
  active,
  onClick,
  stale,
  recomposing,
  onRecompose,
}: DocumentSectionProps) {
  const getStatusText = () => {
    if (content) return null;
    switch (status) {
      case 'pending': return '내용 없음';
      case 'review': return '검토 필요';
      case 'conflict': return '충돌 있음';
      default: return null;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'review':
        return <StatusBadge variant="warning">검토 필요</StatusBadge>;
      case 'conflict':
        return <StatusBadge variant="warning">충돌 있음</StatusBadge>;
      case 'pending':
        return <StatusBadge variant="default">내용 없음</StatusBadge>;
      default:
        return null;
    }
  };

  return (
    <div
      data-testid={`document-section-${number}`}
      onClick={onClick}
      className={`cursor-pointer border-l px-4 py-5 transition-all sm:px-8 sm:py-6 ${
        active
          ? 'border-l-blue-600 bg-gray-50/50'
        : 'border-l-transparent hover:bg-gray-50/30'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-base text-gray-900">
          {number}. {title}
        </h3>
        {getStatusBadge()}
      </div>
      {content ? (
        <p className="text-sm text-gray-700 leading-relaxed">{content}</p>
      ) : (
        <p className="text-sm text-gray-400 italic">{getStatusText()}</p>
      )}
      {stale && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-800"
          data-testid={`document-section-${number}-stale`}
        >
          <StatusBadge variant="warning">본문 갱신 필요</StatusBadge>
          <span>결정이 바뀌었지만 본문은 이전 선택안을 기준으로 쓰여 있습니다.</span>
          {onRecompose && (
            <button
              type="button"
              disabled={recomposing}
              onClick={(event) => {
                event.stopPropagation();
                onRecompose();
              }}
              className="rounded border border-amber-300 bg-white px-2 py-0.5 text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recomposing ? '다시 쓰는 중…' : '본문 다시 쓰기'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
