import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { SectionStatus } from '../data/mergeResult';

interface DocumentSectionProps {
  number: number;
  title: string;
  content?: string;
  status?: SectionStatus;
  active?: boolean;
  onClick?: () => void;
}

export function DocumentSection({ number, title, content, status, active, onClick }: DocumentSectionProps) {
  const statusText = getStatusText(content, status);
  const statusBadge = getStatusBadge(status);
  const StatusIcon = status === 'conflict' || status === 'review'
    ? AlertTriangle
    : content
      ? CheckCircle2
      : CircleDashed;

  return (
    <button
      type="button"
      data-testid={`document-section-${number}`}
      onClick={onClick}
      className={`lift-card w-full rounded-lg border bg-white p-5 text-left transition-all sm:p-6 ${
        active
          ? 'border-blue-300 shadow-[0_18px_55px_rgba(37,99,235,0.13)]'
          : 'border-slate-200 shadow-[0_12px_34px_rgba(15,23,42,0.05)] hover:border-slate-300'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${
              active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <StatusIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">섹션 {number}</div>
            <h3 className="mt-1 text-base font-semibold text-slate-950">
              {number}. {title}
            </h3>
          </div>
        </div>
        {statusBadge}
      </div>
      {content ? (
        <p className="text-sm leading-7 text-slate-700">{content}</p>
      ) : (
        <p className="text-sm italic leading-7 text-slate-400">{statusText}</p>
      )}
    </button>
  );
}

function getStatusText(content: string | undefined, status: SectionStatus | undefined) {
  if (content) return null;

  switch (status) {
    case 'pending':
      return '내용 없음';
    case 'review':
      return '검토 필요';
    case 'conflict':
      return '충돌 있음';
    default:
      return null;
  }
}

function getStatusBadge(status: SectionStatus | undefined) {
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
}
