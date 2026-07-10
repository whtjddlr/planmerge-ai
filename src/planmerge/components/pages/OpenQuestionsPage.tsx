import type { ReactNode } from 'react';
import { StatusBadge } from '../StatusBadge';
import { AlertTriangle, CheckCircle2, ClipboardList, FileWarning, ShieldCheck } from 'lucide-react';
import type { BadgeVariant, DocumentSectionData, SectionStatus } from '../../data/mergeResult';
import type { PublicationReadiness } from '../../lib/publicationReadiness';

type OpenQuestionsPageProps = {
  documentSections: DocumentSectionData[];
  onSelectSection: (sectionNumber: number) => void;
  publicationReadiness: PublicationReadiness;
};

type QueueCategory = 'conflict' | 'review' | 'input' | 'ready';

type ReviewQueueItem = {
  sectionNumber: number;
  section: string;
  topic: string;
  category: QueueCategory;
  status: string;
  statusVariant: BadgeVariant;
  reason: string;
  nextAction: string;
  sourceCount: number;
  alternativeCount: number;
  conflictCount: number;
};

export function OpenQuestionsPage({
  documentSections,
  onSelectSection,
  publicationReadiness,
}: OpenQuestionsPageProps) {
  const queueItems = documentSections
    .map((section) => createReviewQueueItem(section, publicationReadiness))
    .sort((first, second) =>
      queuePriority(first.category) - queuePriority(second.category) ||
      first.sectionNumber - second.sectionNumber,
    );
  const summary = createReviewSummary(queueItems, publicationReadiness);

  return (
    <main className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-950 text-white">
              <ClipboardList className="h-4 w-4" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-950">검토 큐</h2>
            <StatusBadge variant={summary.readinessVariant}>{summary.readinessLabel}</StatusBadge>
          </div>
          <p className="max-w-3xl text-sm leading-7 text-slate-600">
            공유하거나 내보내기 전에 확인해야 할 충돌, 검토 필요, 입력 부족 섹션을 우선순위대로 정리합니다.
          </p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryTile icon={<CheckCircle2 className="h-4 w-4" />} label="완료" value={summary.readyCount} help={`${summary.totalCount}개 섹션 중`} />
          <SummaryTile icon={<AlertTriangle className="h-4 w-4" />} label="충돌" value={summary.conflictCount} help="먼저 해결" variant="danger" />
          <SummaryTile icon={<ShieldCheck className="h-4 w-4" />} label="검토 필요" value={summary.reviewCount} help="근거 확인" variant="warning" />
          <SummaryTile icon={<FileWarning className="h-4 w-4" />} label="입력 부족" value={summary.inputCount} help="초안 보강" variant="default" />
          <SummaryTile icon={<ClipboardList className="h-4 w-4" />} label="남은 조치" value={summary.actionCount} help={summary.actionHelp} variant={summary.actionVariant} />
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-950">공유 전 점검</h3>
              <p className="mt-1 max-w-3xl text-sm leading-7 text-slate-600">
                {summary.readinessDetail}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.checks.map((check) => (
                <StatusBadge key={check.label} variant={check.variant}>
                  {check.label}
                </StatusBadge>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950">검토 항목</h3>
            <span className="text-xs text-slate-400">우선순위 순</span>
          </div>

          <div className="space-y-3">
            {queueItems.map((item) => (
              <div
                key={item.sectionNumber}
                className={`rounded-lg border bg-white p-4 shadow-sm lg:grid lg:grid-cols-[minmax(0,1fr)_190px] lg:gap-4 ${queueAccentClass(item.category)}`}
              >
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusBadge variant={item.statusVariant}>{item.status}</StatusBadge>
                    <h4 className="text-base text-gray-900">
                      {item.sectionNumber}. {item.section}
                    </h4>
                  </div>
                  <div className="mb-2 text-sm font-medium text-slate-700">{item.topic}</div>
                  <p className="text-sm leading-7 text-slate-600">{item.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>출처 {item.sourceCount}개</span>
                    <span>대안 {item.alternativeCount}개</span>
                    <span>충돌 {item.conflictCount}개</span>
                  </div>
                </div>

                <div className="flex flex-col items-start gap-3 lg:items-end">
                  <div className="text-left text-xs leading-relaxed text-gray-500 lg:text-right">
                    <span className="block font-medium text-slate-900">다음 조치</span>
                    {item.nextAction}
                  </div>
                  <button
                    type="button"
                    aria-label={`${item.sectionNumber}. ${item.section} 검토하기`}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 lg:w-auto"
                    onClick={() => onSelectSection(item.sectionNumber)}
                  >
                    섹션 보기
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryTile({
  help,
  icon,
  label,
  value,
  variant = 'default',
}: {
  help: string;
  icon: ReactNode;
  label: string;
  value: number;
  variant?: BadgeVariant;
}) {
  return (
    <div className="lift-card rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="text-slate-400">{icon}</span>
          {label}
        </div>
        <StatusBadge variant={variant}>{help}</StatusBadge>
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function createReviewQueueItem(
  section: DocumentSectionData,
  publicationReadiness: PublicationReadiness,
): ReviewQueueItem {
  const trace = section.decisionTrace;
  const traces = section.decisionTraces?.length
    ? section.decisionTraces
    : trace
      ? [trace]
      : [];
  const requiredBlockIds = new Set(publicationReadiness.requiredBlockIds);
  const unresolvedBlockIds = new Set(publicationReadiness.unresolvedBlockIds);
  const sectionRequiredIds = traces
    .map((item) => item.decisionBlockId)
    .filter((blockId) => requiredBlockIds.has(blockId));
  const sectionUnresolvedIds = sectionRequiredIds.filter((blockId) => unresolvedBlockIds.has(blockId));
  const reviewResolved = sectionRequiredIds.length > 0 && sectionUnresolvedIds.length === 0;
  const category = reviewResolved ? 'ready' : sectionCategory(section.status);

  return {
    sectionNumber: section.number,
    section: section.title,
    topic: trace?.topic ?? '추가 작성 필요',
    category,
    status: reviewResolved ? '검토 완료' : sectionStatusLabel(section.status),
    statusVariant: reviewResolved ? 'success' : sectionStatusVariant(section.status),
    reason: reviewResolved
      ? '선택안과 충돌 의견을 확인하고 이 섹션의 결정을 승인했습니다.'
      : sectionReason(section),
    nextAction: reviewResolved ? '최종 문장 확인' : sectionNextAction(section),
    sourceCount: trace
      ? new Set([
        ...(trace.selectedSources ?? []).map((source) => source.sourceIdeaId ?? source.sourceDraftId),
        ...trace.alternatives.flatMap((opinion) =>
          opinion.sources.map((source) => source.sourceIdeaId ?? source.sourceDraftId),
        ),
        ...trace.conflicts.flatMap((opinion) =>
          opinion.sources.map((source) => source.sourceIdeaId ?? source.sourceDraftId),
        ),
      ].filter(Boolean)).size
      : 0,
    alternativeCount: trace?.alternatives.length ?? 0,
    conflictCount: trace?.conflicts.length ?? 0,
  };
}

function createReviewSummary(items: ReviewQueueItem[], publicationReadiness: PublicationReadiness) {
  const totalCount = items.length;
  const conflictCount = items.filter((item) => item.category === 'conflict').length;
  const reviewCount = items.filter((item) => item.category === 'review').length;
  const inputCount = items.filter((item) => item.category === 'input').length;
  const readyCount = items.filter((item) => item.category === 'ready').length;
  const sectionActionCount = conflictCount + reviewCount + inputCount;
  const qualityActionCount = publicationReadiness.level === 'review' && sectionActionCount === 0 ? 1 : 0;
  const actionCount = sectionActionCount + qualityActionCount;
  const readinessVariant: BadgeVariant = publicationReadiness.level === 'ready'
    ? 'success'
    : publicationReadiness.level === 'blocked' || conflictCount
      ? 'danger'
      : 'warning';

  return {
    actionCount,
    actionHelp: qualityActionCount ? '품질 확인' : actionCount ? '처리 필요' : '정리됨',
    actionVariant: actionCount ? 'warning' as const : 'success' as const,
    checks: [
      {
        label: conflictCount ? `충돌 ${conflictCount}개` : '충돌 없음',
        variant: conflictCount ? 'danger' as const : 'success' as const,
      },
      {
        label: inputCount ? `입력 부족 ${inputCount}개` : '입력 부족 없음',
        variant: inputCount ? 'warning' as const : 'success' as const,
      },
      {
        label: qualityActionCount
          ? '문서 품질 보완'
          : reviewCount
            ? `승인 후보 ${reviewCount}개`
            : '검토 대기 없음',
        variant: qualityActionCount || reviewCount ? 'warning' as const : 'success' as const,
      },
    ],
    conflictCount,
    inputCount,
    readinessDetail: publicationReadiness.detail,
    readinessLabel: publicationReadiness.label,
    readinessVariant,
    readyCount,
    reviewCount,
    totalCount,
  };
}

function sectionCategory(status: SectionStatus): QueueCategory {
  if (status === 'conflict') return 'conflict';
  if (status === 'review') return 'review';
  if (status === 'pending') return 'input';
  return 'ready';
}

function queuePriority(category: QueueCategory) {
  if (category === 'conflict') return 0;
  if (category === 'review') return 1;
  if (category === 'input') return 2;
  return 3;
}

function sectionStatusLabel(status: SectionStatus) {
  if (status === 'conflict') return '충돌 있음';
  if (status === 'review') return '근거 확인';
  if (status === 'pending') return '입력 부족';
  return '완료';
}

function sectionStatusVariant(status: SectionStatus): BadgeVariant {
  if (status === 'conflict') return 'danger';
  if (status === 'review') return 'warning';
  if (status === 'pending') return 'default';
  return 'success';
}

function sectionReason(section: DocumentSectionData) {
  const trace = section.decisionTrace;

  if (section.status === 'conflict') {
    const conflictCount = trace?.conflicts.length ?? 0;

    return conflictCount
      ? `${conflictCount}개 충돌 의견이 있습니다. 선택안과 동시에 채택하기 어려운 의견을 비교해야 합니다.`
      : '선택안과 다른 방향의 의견이 있어 자동 승인하기 어렵습니다.';
  }

  if (section.status === 'review') {
    return trace
      ? 'AI가 선택안을 만들었지만 사람 검토가 필요합니다. 선택 근거와 원문 출처를 확인한 뒤 승인해야 합니다.'
      : '검토 상태이지만 연결된 결정 근거가 부족합니다. 분석 결과를 다시 확인해야 합니다.';
  }

  if (section.status === 'pending') {
    if (section.content.trim() && !trace) {
      return '최종 문서 문장은 있지만 관련 결정 근거가 없어 선택 추적성이 낮습니다.';
    }

    if (!section.content.trim() && trace) {
      return '결정 근거는 있으나 최종 문서 섹션이 비어 있습니다. 선택안을 문서 문장으로 반영해야 합니다.';
    }

    return '초안에서 이 섹션으로 매핑된 아이디어가 부족해 최종 문서 내용과 선택 근거가 비어 있습니다.';
  }

  return '최종 문서 내용과 선택 근거가 준비된 섹션입니다. 내보내기 전 문장만 최종 확인하면 됩니다.';
}

function sectionNextAction(section: DocumentSectionData) {
  if (section.status === 'conflict') return '충돌 의견을 비교하고 선택안을 확정하세요.';
  if (section.status === 'review') return '출처와 선택 근거를 확인하세요.';
  if (section.status === 'pending') return '초안을 추가하거나 섹션을 보강하세요.';
  return '최종 문장 확인';
}

function queueAccentClass(category: QueueCategory) {
  if (category === 'conflict') return 'border-red-200';
  if (category === 'review') return 'border-amber-200';
  if (category === 'input') return 'border-slate-200';
  return 'border-emerald-200';
}
