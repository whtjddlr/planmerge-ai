import { StatusBadge } from '../StatusBadge';
import type { BadgeVariant, DocumentSectionData, SectionStatus } from '../../data/mergeResult';

type OpenQuestionsPageProps = {
  documentSections: DocumentSectionData[];
  onSelectSection: (sectionNumber: number) => void;
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

export function OpenQuestionsPage({ documentSections, onSelectSection }: OpenQuestionsPageProps) {
  const queueItems = documentSections
    .map(createReviewQueueItem)
    .sort((first, second) =>
      queuePriority(first.category) - queuePriority(second.category) ||
      first.sectionNumber - second.sectionNumber,
    );
  const summary = createReviewSummary(queueItems);

  return (
    <main className="h-full min-h-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl text-gray-900">Review Queue</h2>
            <StatusBadge variant={summary.readinessVariant}>{summary.readinessLabel}</StatusBadge>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-gray-600">
            내보내기 전에 확인해야 할 충돌, 검토 필요, 입력 부족 섹션을 우선순위대로 정리합니다.
          </p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryTile label="완료" value={summary.readyCount} help={`${summary.totalCount}개 섹션 중`} />
          <SummaryTile label="충돌" value={summary.conflictCount} help="먼저 해결" variant="danger" />
          <SummaryTile label="검토 필요" value={summary.reviewCount} help="근거 확인" variant="warning" />
          <SummaryTile label="입력 부족" value={summary.inputCount} help="초안 보강" variant="default" />
          <SummaryTile label="남은 액션" value={summary.actionCount} help={summary.actionHelp} variant={summary.actionVariant} />
        </section>

        <section className="mt-6 border-y border-gray-100 py-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base text-gray-900">Export Readiness</h3>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-600">
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
            <h3 className="text-base text-gray-900">Queue Items</h3>
            <span className="text-xs text-gray-400">우선순위 순</span>
          </div>

          <div className="divide-y divide-gray-100 border-y border-gray-100">
            {queueItems.map((item) => (
              <div
                key={item.sectionNumber}
                className={`grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_180px] ${queueAccentClass(item.category)}`}
              >
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusBadge variant={item.statusVariant}>{item.status}</StatusBadge>
                    <h4 className="text-base text-gray-900">
                      {item.sectionNumber}. {item.section}
                    </h4>
                  </div>
                  <div className="mb-2 text-sm text-gray-700">{item.topic}</div>
                  <p className="text-sm leading-relaxed text-gray-600">{item.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>출처 {item.sourceCount}</span>
                    <span>대안 {item.alternativeCount}</span>
                    <span>충돌 {item.conflictCount}</span>
                  </div>
                </div>

                <div className="flex flex-col items-start gap-3 lg:items-end">
                  <div className="text-left text-xs leading-relaxed text-gray-500 lg:text-right">
                    <span className="block text-gray-900">다음 액션</span>
                    {item.nextAction}
                  </div>
                  <button
                    type="button"
                    aria-label={`${item.sectionNumber}. ${item.section} 검토하기`}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 lg:w-auto"
                    onClick={() => onSelectSection(item.sectionNumber)}
                  >
                    검토하기
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
  label,
  value,
  variant = 'default',
}: {
  help: string;
  label: string;
  value: number;
  variant?: BadgeVariant;
}) {
  return (
    <div className="rounded-md border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">{label}</div>
        <StatusBadge variant={variant}>{help}</StatusBadge>
      </div>
      <div className="text-2xl text-gray-900">{value}</div>
    </div>
  );
}

function createReviewQueueItem(section: DocumentSectionData): ReviewQueueItem {
  const trace = section.decisionTrace;
  const category = sectionCategory(section.status);

  return {
    sectionNumber: section.number,
    section: section.title,
    topic: trace?.topic ?? '추가 작성 필요',
    category,
    status: queueStatusLabel(section),
    statusVariant: sectionStatusVariant(section.status),
    reason: sectionReason(section),
    nextAction: sectionNextAction(section),
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

function createReviewSummary(items: ReviewQueueItem[]) {
  const totalCount = items.length;
  const conflictCount = items.filter((item) => item.category === 'conflict').length;
  const reviewCount = items.filter((item) => item.category === 'review').length;
  const inputCount = items.filter((item) => item.category === 'input').length;
  const readyCount = items.filter((item) => item.category === 'ready').length;
  const actionCount = conflictCount + reviewCount + inputCount;
  const readinessVariant: BadgeVariant = conflictCount ? 'danger' : actionCount ? 'warning' : 'success';
  const readinessLabel = conflictCount
    ? 'Export Blocked'
    : actionCount
      ? 'Export Caution'
      : 'Ready';
  const readinessDetail = conflictCount
    ? `${conflictCount}개 충돌 섹션이 남아 있어 내보내기 전에 사람이 최종 선택해야 합니다.`
    : inputCount
      ? `${inputCount}개 입력 부족 섹션이 있습니다. 추가 초안을 넣거나 해당 섹션을 의도적으로 비워둘지 결정해야 합니다.`
      : reviewCount
        ? `${reviewCount}개 선택안의 근거만 확인하면 내보내기 가능한 상태입니다.`
        : '충돌, 검토 필요, 입력 부족 섹션이 없어 내보내기 가능한 상태입니다.';

  return {
    actionCount,
    actionHelp: actionCount ? '처리 필요' : '준비됨',
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
        label: reviewCount ? `승인 후보 ${reviewCount}개` : '검토 대기 없음',
        variant: reviewCount ? 'warning' as const : 'success' as const,
      },
    ],
    conflictCount,
    inputCount,
    readinessDetail,
    readinessLabel,
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

function queueStatusLabel(section: DocumentSectionData) {
  if (section.violatesForbiddenDirection) {
    return '금지 방향 위반';
  }

  return sectionStatusLabel(section.status);
}

function sectionStatusLabel(status: SectionStatus) {
  if (status === 'conflict') return '충돌 검토';
  if (status === 'review') return '승인 후보';
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

  if (section.violatesForbiddenDirection) {
    return '현재 선택안이 프로젝트가 금지한 방향을 제안합니다. 다른 의견을 선택안으로 바꾸거나, 프로젝트 설정에서 금지 방향 기준을 고치고 다시 분석해야 합니다.';
  }

  if (section.status === 'conflict') {
    const conflictCount = trace?.conflicts.length ?? 0;

    return conflictCount
      ? `${conflictCount}개 충돌 의견이 있습니다. 선택안과 동시에 채택하기 어려운 의견을 비교해야 합니다.`
      : '선택안과 다른 방향의 의견이 있어 자동 승인하기 어렵습니다.';
  }

  if (section.status === 'review') {
    return trace
      ? 'AI가 선택안을 만들었지만 사람 검토가 필요합니다. 선택 근거와 원문 출처를 확인한 뒤 승인해야 합니다.'
      : '검토 상태이지만 연결된 Decision Block이 부족합니다. 분석 결과를 다시 확인해야 합니다.';
  }

  if (section.status === 'pending') {
    if (section.content.trim() && !trace) {
      return '최종 문서 문장은 있지만 관련 Decision Block이 없어 선택 근거 추적성이 낮습니다.';
    }

    if (!section.content.trim() && trace) {
      return 'Decision Block은 있으나 최종 문서 섹션이 비어 있습니다. 선택안을 문서 문장으로 반영해야 합니다.';
    }

    return '초안에서 이 섹션으로 매핑된 아이디어가 부족해 최종 문서 내용과 선택 근거가 비어 있습니다.';
  }

  return '최종 문서 내용과 선택 근거가 준비된 섹션입니다. 내보내기 전 문장만 최종 확인하면 됩니다.';
}

function sectionNextAction(section: DocumentSectionData) {
  if (section.violatesForbiddenDirection) return '금지 방향 위반 해소 — 선택안 변경 또는 기준 수정';
  if (section.status === 'conflict') return '충돌 의견 비교 후 선택안 확정';
  if (section.status === 'review') return '근거와 출처 확인 후 승인';
  if (section.status === 'pending') return '초안 추가 또는 섹션 수동 보강';
  return '최종 문장 확인';
}

function queueAccentClass(category: QueueCategory) {
  if (category === 'conflict') return 'border-l-2 border-l-red-300 pl-4';
  if (category === 'review') return 'border-l-2 border-l-amber-300 pl-4';
  if (category === 'input') return 'border-l-2 border-l-gray-200 pl-4';
  return 'border-l-2 border-l-emerald-200 pl-4';
}
