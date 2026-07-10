import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Database,
  FileSearch,
  GitMerge,
  History,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '../StatusBadge';
import type { LocalDecisionLog, LocalDraftSubmission, ProjectSettings } from '../../lib/localWorkspace';
import {
  documentSectionDefinitions,
  validatePlanMergeAnalysis,
} from '../../lib/ai/planmergeProtocol';
import { evaluateAnalysisQuality } from '../../lib/analysisQuality';
import type {
  AnalysisQualityReport,
  QualityAction,
  QualityDecisionFilter,
  QualityActionPriority,
  QualityLevel,
  QualityMetric,
  QualityValidationFocus,
} from '../../lib/analysisQuality';
import type {
  NormalizedIdea,
  PlanMergeAnalysisResult,
  ProtocolDecisionBlock,
  ProtocolDecisionOption,
} from '../../lib/ai/planmergeProtocol';
import type { PublicationReadiness } from '../../lib/publicationReadiness';

type AnalysisInspectorPageProps = {
  project: ProjectSettings;
  approvedBlockIds: string[];
  drafts: LocalDraftSubmission[];
  analysisResult?: PlanMergeAnalysisResult;
  analysisStatus: 'idle' | 'analyzing' | 'completed';
  decisionLogs: LocalDecisionLog[];
  onRunAnalysis: () => void;
  publicationReadiness: PublicationReadiness;
  readOnly: boolean;
};

type InspectorTab = 'quality' | 'ideas' | 'decisions' | 'logs' | 'validation';

const tabLabels: Record<InspectorTab, string> = {
  quality: '품질 게이트',
  ideas: '정규화 아이디어',
  decisions: '결정 블록',
  logs: '변경 기록',
  validation: '검증 결과',
};

export function AnalysisInspectorPage({
  project,
  approvedBlockIds,
  drafts,
  analysisResult,
  analysisStatus,
  decisionLogs,
  onRunAnalysis,
  publicationReadiness,
  readOnly,
}: AnalysisInspectorPageProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('quality');
  const [decisionFilter, setDecisionFilter] = useState<QualityDecisionFilter>('all');
  const [focusedDecisionBlockId, setFocusedDecisionBlockId] = useState<string>();
  const [validationFocus, setValidationFocus] = useState<QualityValidationFocus>();
  const validation = useMemo(() => {
    if (!analysisResult) {
      return undefined;
    }

    return validatePlanMergeAnalysis({ project, drafts }, analysisResult);
  }, [analysisResult, drafts, project]);
  const qualityReport = useMemo(() => {
    if (!analysisResult) {
      return undefined;
    }

    return evaluateAnalysisQuality({ project, drafts }, analysisResult, approvedBlockIds);
  }, [analysisResult, approvedBlockIds, drafts, project]);
  const openQualityAction = (action: QualityAction) => {
    if (!action.destination) {
      return;
    }

    if (action.destination.tab === 'decisions') {
      setDecisionFilter(action.destination.decisionFilter ?? 'all');
      setFocusedDecisionBlockId(action.destination.decisionBlockId);
    }

    if (action.destination.tab === 'validation') {
      setValidationFocus(action.destination.validationFocus);
    }

    setActiveTab(action.destination.tab);
  };
  const updateDecisionFilter = (filter: QualityDecisionFilter) => {
    setDecisionFilter(filter);
    setFocusedDecisionBlockId(undefined);
  };

  if (!analysisResult) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="motion-panel w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-slate-950 text-white">
            <FileSearch className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-slate-950">검토할 분석 결과가 없습니다.</h2>
          <div className="mt-2 text-sm leading-7 text-slate-600">
            초안을 추가한 뒤 병합 분석을 실행하면 아이디어, 결정 블록, 품질 게이트를 여기에서 점검할 수 있습니다.
          </div>
          {!readOnly && (
            <button
              type="button"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-slate-300"
              disabled={analysisStatus === 'analyzing'}
              onClick={onRunAnalysis}
            >
              <RefreshCw className={`h-4 w-4 ${analysisStatus === 'analyzing' ? 'animate-spin' : ''}`} />
              {analysisStatus === 'analyzing' ? '분석 중' : '병합 분석 실행'}
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              분석 검토
            </div>
            <h2 className="text-2xl font-semibold text-slate-950">근거와 품질 상태를 점검합니다.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              병합 결과가 어떤 초안에서 왔는지, 어떤 결정이 자동 선택됐는지, 공유 전에 어떤 보완이 필요한지 확인합니다.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <StatusBadge variant={analysisResult.source === 'local_harness' ? 'warning' : 'success'}>
                {analysisResult.source === 'gms'
                  ? 'GMS'
                  : analysisResult.source === 'gemini'
                    ? 'Gemini'
                  : analysisResult.source === 'solar'
                    ? 'Solar'
                    : '로컬 검증'}
              </StatusBadge>
              <StatusBadge variant={validation?.valid ? 'success' : 'danger'}>
                {validation?.valid ? '검증 통과' : '검증 필요'}
              </StatusBadge>
              <span>{analysisResult.protocolVersion}</span>
            </div>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
              disabled={analysisStatus === 'analyzing'}
              onClick={onRunAnalysis}
            >
              <RefreshCw className={`h-4 w-4 ${analysisStatus === 'analyzing' ? 'animate-spin' : ''}`} />
              {analysisStatus === 'analyzing' ? '분석 중' : '다시 분석'}
            </button>
          )}
        </div>

        <SummaryGrid
          analysisResult={analysisResult}
          decisionLogCount={decisionLogs.length}
          publicationReadiness={publicationReadiness}
          qualityScore={qualityReport?.score ?? 0}
          validationErrorCount={validation?.errors.length ?? 0}
        />

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <div className="flex gap-1 overflow-x-auto">
            {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
              <button
                type="button"
                key={tab}
                data-testid={`inspector-tab-${tab}`}
                className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          {activeTab === 'quality' && qualityReport && (
            <QualityGateTab
              drafts={drafts}
              onOpenAction={openQualityAction}
              publicationReadiness={publicationReadiness}
              qualityReport={qualityReport}
            />
          )}
          {activeTab === 'ideas' && <IdeasTab ideas={analysisResult.normalizedIdeas} drafts={drafts} />}
          {activeTab === 'decisions' && (
            <DecisionBlocksTab
              decisionBlocks={analysisResult.decisionBlocks}
              decisionFilter={decisionFilter}
              focusedDecisionBlockId={focusedDecisionBlockId}
              ideas={analysisResult.normalizedIdeas}
              onDecisionFilterChange={updateDecisionFilter}
            />
          )}
          {activeTab === 'logs' && <DecisionLogsTab decisionLogs={decisionLogs} />}
          {activeTab === 'validation' && (
            <ValidationTab
              analysisResult={analysisResult}
              validationFocus={validationFocus}
              validationErrors={validation?.errors ?? []}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function SummaryGrid({
  analysisResult,
  decisionLogCount,
  publicationReadiness,
  qualityScore,
  validationErrorCount,
}: {
  analysisResult: PlanMergeAnalysisResult;
  decisionLogCount: number;
  publicationReadiness: PublicationReadiness;
  qualityScore: number;
  validationErrorCount: number;
}) {
  const items = [
    { label: '문서 품질', value: qualityScore, icon: ShieldCheck },
    { label: '아이디어', value: analysisResult.normalizedIdeas.length, icon: Sparkles },
    { label: '결정 블록', value: analysisResult.decisionBlocks.length, icon: GitMerge },
    {
      label: '검토 완료',
      value: `${publicationReadiness.approvedCount}/${publicationReadiness.requiredCount}`,
      icon: CheckCircle2,
    },
    { label: '누락 섹션', value: analysisResult.missingSections.length, icon: AlertTriangle },
    { label: '변경 기록', value: decisionLogCount, icon: History },
    { label: '경고', value: analysisResult.warnings.length, icon: ClipboardList },
    { label: '검증 오류', value: validationErrorCount, icon: Database },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {items.map((item) => {
        const Icon = item.icon;

        return (
        <div key={item.label} className="lift-card rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-slate-500">{item.label}</div>
            <Icon className="h-4 w-4 text-slate-300" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</div>
        </div>
        );
      })}
    </div>
  );
}

function QualityGateTab({
  drafts,
  onOpenAction,
  publicationReadiness,
  qualityReport,
}: {
  drafts: LocalDraftSubmission[];
  onOpenAction: (action: QualityAction) => void;
  publicationReadiness: PublicationReadiness;
  qualityReport: AnalysisQualityReport;
}) {
  const draftsById = useMemo(() => new Map(drafts.map((draft) => [draft.id, draft])), [drafts]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-start">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-950">문서 품질</h3>
              <StatusBadge variant={qualityBadgeVariant(qualityReport.level)}>
                {qualityLabel(qualityReport.level)}
              </StatusBadge>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">{qualityReport.summary}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4 text-center">
            <div className="text-xs font-medium text-slate-500">문서 품질</div>
            <div className="mt-1 text-4xl font-semibold text-slate-950">{qualityReport.score}</div>
            <div className="mt-1 text-xs text-slate-400">/ 100</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4 text-center">
            <div className="text-xs font-medium text-slate-500">검토 완료도</div>
            <div className="mt-1 text-4xl font-semibold text-slate-950">{publicationReadiness.reviewCompletion}</div>
            <div className="mt-1 text-xs text-slate-400">%</div>
            <div className="mt-2">
              <StatusBadge variant={publicationBadgeVariant(publicationReadiness.level)}>
                {publicationReadiness.label}
              </StatusBadge>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {qualityReport.metrics.map((item) => (
          <QualityMetricCard key={item.id} metric={item} />
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-950">다음 조치</h3>
          <span className="text-xs text-slate-400">{qualityReport.nextActions.length}개 항목</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {qualityReport.nextActions.map((action) => (
            <div key={action.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge variant={actionPriorityVariant(action.priority)}>
                  {actionPriorityLabel(action.priority)}
                </StatusBadge>
                <div className="text-sm font-semibold text-slate-950">{action.title}</div>
              </div>
              {action.target && (
                <div className="mb-1 text-xs text-gray-500">{action.target}</div>
              )}
              <p className="text-xs leading-6 text-slate-600">{action.detail}</p>
              <div className="mt-2 rounded-md bg-white px-2 py-1 text-xs text-slate-500">
                기대 효과: {action.expectedImpact}
              </div>
              {action.destination && (
                <button
                  type="button"
                  className="mt-3 rounded-md border border-blue-100 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  onClick={() => onOpenAction(action)}
                >
                  {actionDestinationLabel(action)}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950">검토 필요 항목</h3>
            <StatusBadge variant={qualityReport.findings.length ? 'warning' : 'success'}>
              {qualityReport.findings.length}개
            </StatusBadge>
          </div>
          {qualityReport.findings.length ? (
            <div className="space-y-2">
              {qualityReport.findings.map((finding) => (
                <div key={finding.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge variant={qualityBadgeVariant(finding.severity)}>
                      {qualityLabel(finding.severity)}
                    </StatusBadge>
                    <div className="text-sm font-semibold text-slate-950">{finding.title}</div>
                  </div>
                  {finding.target && (
                    <div className="mb-1 text-xs text-gray-500">{finding.target}</div>
                  )}
                  <p className="text-xs leading-6 text-slate-600">{finding.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">즉시 조치가 필요한 품질 이슈가 없습니다.</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950">초안 반영 상태</h3>
            <span className="text-xs text-slate-400">{qualityReport.sourceCoverageByDraft.length}개 초안</span>
          </div>
          <div className="space-y-2">
            {qualityReport.sourceCoverageByDraft.map((item) => {
              const draft = draftsById.get(item.draftId);

              return (
                <div key={item.draftId} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-950">
                        {draft ? `${draft.authorName} · ${draft.taskTitle}` : item.draftId}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{item.draftId}</div>
                    </div>
                    <StatusBadge variant={item.ideaCount ? 'success' : 'warning'}>
                      {item.ideaCount}개 아이디어
                    </StatusBadge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-950">섹션 반영 상태</h3>
          <span className="text-xs text-slate-400">기본 12개 섹션</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {qualityReport.sectionCoverage.map((section) => (
            <div key={section.sectionKey} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="text-sm font-medium text-slate-950">{section.title}</div>
                <StatusBadge variant={section.hasFinalSection ? 'success' : 'warning'}>
                  {section.hasFinalSection ? '작성됨' : '누락'}
                </StatusBadge>
              </div>
              <div className="text-xs text-slate-500">
                아이디어 {section.ideaCount}개 · 결정 {section.decisionBlockCount}개
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function QualityMetricCard({ metric }: { metric: QualityMetric }) {
  return (
    <div className="rounded-md border border-gray-200 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-gray-900">{metric.label}</div>
          <div className="mt-1 text-xs leading-relaxed text-gray-500">{metric.helpText}</div>
        </div>
        <StatusBadge variant={qualityBadgeVariant(metric.status)}>
          {metric.score}%
        </StatusBadge>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${qualityBarClass(metric.status)}`}
          style={{ width: `${Math.min(Math.max(metric.score, 0), 100)}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {metric.value} / {metric.total}
      </div>
    </div>
  );
}

function DecisionLogsTab({ decisionLogs }: { decisionLogs: LocalDecisionLog[] }) {
  const orderedLogs = [...decisionLogs].reverse();

  if (!orderedLogs.length) {
    return (
      <div className="rounded-md border border-gray-200 p-5">
        <h3 className="text-sm text-gray-900">변경 기록</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          아직 사용자가 변경한 선택안이 없습니다. 병합 화면에서 대안 또는 충돌 의견을 선택안으로 적용하면 이곳에 기록됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orderedLogs.map((log) => (
        <div
          key={log.id}
          data-testid="decision-log-entry"
          className="rounded-md border border-gray-200 p-4"
        >
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm text-gray-900">{log.sectionTitle} · {log.topic}</div>
              <div className="mt-1 text-xs text-gray-500">
                run {log.analysisRunId} · {log.id} · {log.decisionBlockId} · {log.createdAtLabel}
              </div>
            </div>
            <StatusBadge variant="warning">사용자 선택</StatusBadge>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md bg-gray-50 p-3">
              <div className="mb-1 text-xs text-gray-500">이전 선택안</div>
              <p className="text-sm leading-relaxed text-gray-700">
                {log.beforeValue ?? '기존 선택안 없음'}
              </p>
              {log.beforeOptionId && (
                <div className="mt-2 text-xs text-gray-400">{log.beforeOptionId}</div>
              )}
            </div>
            <div className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
              <div className="mb-1 text-xs text-blue-700">적용한 선택안</div>
              <p className="text-sm leading-relaxed text-gray-900">{log.afterValue}</p>
              <div className="mt-2 text-xs text-blue-500">{log.afterOptionId}</div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-gray-100 p-3">
            <div className="mb-1 text-xs text-gray-500">변경 이유</div>
            <p className="text-xs leading-relaxed text-gray-600">{log.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function IdeasTab({
  ideas,
  drafts,
}: {
  ideas: NormalizedIdea[];
  drafts: LocalDraftSubmission[];
}) {
  const draftsById = useMemo(() => new Map(drafts.map((draft) => [draft.id, draft])), [drafts]);

  return (
    <div className="space-y-3">
      {ideas.map((idea) => {
        const draft = draftsById.get(idea.sourceDraftId);

        return (
          <div key={idea.id} className="rounded-md border border-gray-200 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm text-gray-900">{idea.normalizedText}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {idea.id} · {idea.sectionKey} · {idea.ideaType} · {idea.intent}
                </div>
              </div>
              <StatusBadge variant={idea.confidence >= 0.75 ? 'success' : 'warning'}>
                {Math.round(idea.confidence * 100)}%
              </StatusBadge>
            </div>
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
                <div className="text-gray-900">{idea.sourceDraftId}</div>
                <div className="mt-1">{draft ? `${draft.authorName} / ${draft.aiModel}` : idea.sourceModel}</div>
                <div className="mt-1">{draft?.taskTitle ?? idea.topic}</div>
              </div>
              <div className="rounded-md border border-gray-100 p-3">
                <div className="mb-1 text-xs text-gray-500">원문 근거</div>
                <p className="text-sm leading-relaxed text-gray-700">{idea.sourceExcerpt}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DecisionBlocksTab({
  decisionBlocks,
  decisionFilter,
  focusedDecisionBlockId,
  ideas,
  onDecisionFilterChange,
}: {
  decisionBlocks: ProtocolDecisionBlock[];
  decisionFilter: QualityDecisionFilter;
  focusedDecisionBlockId?: string;
  ideas: NormalizedIdea[];
  onDecisionFilterChange: (filter: QualityDecisionFilter) => void;
}) {
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const ideasById = useMemo(() => new Map(ideas.map((idea) => [idea.id, idea])), [ideas]);
  const filteredBlocks = useMemo(
    () => filterDecisionBlocks(decisionBlocks, decisionFilter),
    [decisionBlocks, decisionFilter],
  );
  const filterItems = useMemo(
    () => [
      { id: 'all' as const, label: '전체', count: decisionBlocks.length },
      {
        id: 'needs_review' as const,
        label: '검토 필요',
        count: decisionBlocks.filter((block) => block.needsHumanReview).length,
      },
      {
        id: 'conflicts' as const,
        label: '충돌 있음',
        count: decisionBlocks.filter((block) => block.conflictLevel !== 'none').length,
      },
      {
        id: 'low_confidence' as const,
        label: '낮은 신뢰도',
        count: decisionBlocks.filter((block) => block.confidence < 0.65).length,
      },
    ],
    [decisionBlocks],
  );

  useEffect(() => {
    if (!focusedDecisionBlockId) {
      return;
    }

    blockRefs.current[focusedDecisionBlockId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [focusedDecisionBlockId, filteredBlocks.length]);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-gray-200 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm text-gray-900">결정 블록 필터</h3>
            <p className="mt-1 text-xs text-gray-500">
              품질 게이트에서 넘어오면 관련 결정만 좁혀서 봅니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {filterItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  decisionFilter === item.id
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
                onClick={() => onDecisionFilterChange(item.id)}
              >
                {item.label} · {item.count}
              </button>
            ))}
          </div>
        </div>
      </section>

      {filteredBlocks.length === 0 && (
        <div className="rounded-md border border-gray-200 p-5 text-sm text-gray-600">
          {decisionFilterLabel(decisionFilter)} 조건에 해당하는 결정 블록이 없습니다.
        </div>
      )}

      {filteredBlocks.map((block) => {
        const focused = block.id === focusedDecisionBlockId;

        return (
        <div
          key={block.id}
          ref={(node) => {
            blockRefs.current[block.id] = node;
          }}
          className={`rounded-md border p-4 ${
            focused
              ? 'border-blue-300 bg-blue-50/30 ring-1 ring-blue-200'
              : 'border-gray-200'
          }`}
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm text-gray-900">{block.topic}</div>
              <div className="mt-1 text-xs text-gray-500">
                {block.id} · {sectionTitle(block.sectionKey)} · 신뢰도 {Math.round(block.confidence * 100)}%
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {focused && <StatusBadge variant="success">집중 검토</StatusBadge>}
              <StatusBadge variant={block.needsHumanReview ? 'warning' : 'success'}>
                {block.needsHumanReview ? '검토 필요' : '자동 선택'}
              </StatusBadge>
              <StatusBadge variant={block.conflictLevel === 'none' ? 'default' : 'warning'}>
                {conflictLevelDisplay(block.conflictLevel)}
              </StatusBadge>
            </div>
          </div>
          <div className="mb-4 rounded-md bg-gray-50 p-3">
            <div className="mb-1 text-xs text-gray-500">선택 근거</div>
            <p className="text-sm leading-relaxed text-gray-700">{block.selectionReason}</p>
          </div>
          <div className="space-y-3">
            {block.options.map((option) => (
              <DecisionOptionRow
                key={option.id}
                option={option}
                selected={option.id === block.selectedOptionId}
                ideasById={ideasById}
              />
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}

function DecisionOptionRow({
  option,
  selected,
  ideasById,
}: {
  option: ProtocolDecisionOption;
  selected: boolean;
  ideasById: Map<string, NormalizedIdea>;
}) {
  return (
    <div className={`rounded-md border p-3 ${selected ? 'border-blue-200 bg-blue-50/40' : 'border-gray-100'}`}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm text-gray-900">{option.content}</div>
          <div className="mt-1 text-xs text-gray-500">
            {option.id} · {optionTypeDisplay(option.optionType)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected && <StatusBadge variant="success">선택됨</StatusBadge>}
          {option.severity && <StatusBadge variant="warning">{option.severity}</StatusBadge>}
        </div>
      </div>
      {option.differenceFromSelected && (
        <p className="mb-2 text-xs leading-relaxed text-gray-600">{option.differenceFromSelected}</p>
      )}
      <div className="space-y-2">
        {option.sourceIdeaIds.map((ideaId) => {
          const idea = ideasById.get(ideaId);

          return (
            <div key={ideaId} className="rounded bg-white px-3 py-2 text-xs text-gray-600">
              <span className="text-gray-900">{ideaId}</span>
              {idea && <span> · {idea.sourceDraftId} · {idea.sourceExcerpt}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValidationTab({
  analysisResult,
  validationFocus,
  validationErrors,
}: {
  analysisResult: PlanMergeAnalysisResult;
  validationFocus?: QualityValidationFocus;
  validationErrors: string[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`rounded-md border p-4 ${
        validationFocus === 'errors' ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
      }`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-gray-900">검증 오류</h3>
          <div className="flex items-center gap-2">
            {validationFocus === 'errors' && <StatusBadge variant="danger">검토 위치</StatusBadge>}
            <StatusBadge variant={validationErrors.length ? 'danger' : 'success'}>
              {validationErrors.length ? `${validationErrors.length}개` : '0개'}
            </StatusBadge>
          </div>
        </div>
        {validationErrors.length ? (
          <div className="space-y-2">
            {validationErrors.map((error) => (
              <div key={error} className="rounded-md bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
                {error}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-600">검증 오류 없음</div>
        )}
      </section>

      <section className={`rounded-md border p-4 ${
        validationFocus === 'warnings' ? 'border-amber-200 bg-amber-50/30' : 'border-gray-200'
      }`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-gray-900">경고</h3>
          <div className="flex items-center gap-2">
            {validationFocus === 'warnings' && <StatusBadge variant="warning">검토 위치</StatusBadge>}
            <StatusBadge variant={analysisResult.warnings.length ? 'warning' : 'success'}>
              {analysisResult.warnings.length}개
            </StatusBadge>
          </div>
        </div>
        {analysisResult.warnings.length ? (
          <div className="space-y-2">
            {analysisResult.warnings.map((warning, index) => (
              <div
                key={`${index}:${formatWarningText(warning)}`}
                className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
              >
                {formatWarningText(warning)}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-600">경고 없음</div>
        )}
      </section>

      <section className={`rounded-md border p-4 lg:col-span-2 ${
        validationFocus === 'missing_sections' ? 'border-amber-200 bg-amber-50/30' : 'border-gray-200'
      }`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-gray-900">누락 섹션</h3>
          <div className="flex items-center gap-2">
            {validationFocus === 'missing_sections' && <StatusBadge variant="warning">검토 위치</StatusBadge>}
            <StatusBadge variant={analysisResult.missingSections.length ? 'warning' : 'success'}>
              {analysisResult.missingSections.length}개
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {analysisResult.missingSections.map((sectionKey) => (
            <span key={sectionKey} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
              {sectionTitle(sectionKey)}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatWarningText(warning: unknown) {
  if (typeof warning === 'string') {
    return warning;
  }

  if (typeof warning === 'object' && warning !== null && !Array.isArray(warning)) {
    const record = warning as Record<string, unknown>;
    const type = typeof record.type === 'string' && record.type.trim()
      ? `[${record.type.trim()}] `
      : '';
    const message = typeof record.message === 'string' && record.message.trim()
      ? record.message.trim()
      : JSON.stringify(record);

    return `${type}${message}`;
  }

  return String(warning);
}

function sectionTitle(sectionKey: string) {
  return documentSectionDefinitions.find((section) => section.key === sectionKey)?.title ?? sectionKey;
}

function filterDecisionBlocks(
  decisionBlocks: ProtocolDecisionBlock[],
  filter: QualityDecisionFilter,
) {
  if (filter === 'needs_review') {
    return decisionBlocks.filter((block) => block.needsHumanReview);
  }

  if (filter === 'conflicts') {
    return decisionBlocks.filter((block) => block.conflictLevel !== 'none');
  }

  if (filter === 'low_confidence') {
    return decisionBlocks.filter((block) => block.confidence < 0.65);
  }

  return decisionBlocks;
}

function decisionFilterLabel(filter: QualityDecisionFilter) {
  if (filter === 'needs_review') {
    return '검토 필요';
  }

  if (filter === 'conflicts') {
    return '충돌 있음';
  }

  if (filter === 'low_confidence') {
    return '낮은 신뢰도';
  }

  return '전체';
}

function conflictLevelDisplay(level: ProtocolDecisionBlock['conflictLevel']) {
  if (level === 'none') {
    return '충돌 없음';
  }

  if (level === 'high') {
    return '충돌 높음';
  }

  if (level === 'medium') {
    return '충돌 보통';
  }

  return '충돌 낮음';
}

function optionTypeDisplay(type: ProtocolDecisionOption['optionType']) {
  if (type === 'selected') {
    return '선택안';
  }

  if (type === 'alternative') {
    return '대안';
  }

  return '충돌 의견';
}

function actionDestinationLabel(action: QualityAction) {
  if (action.destination?.tab === 'decisions') {
    return '관련 결정 보기';
  }

  if (action.destination?.tab === 'validation') {
    return '검증 항목 보기';
  }

  if (action.destination?.tab === 'ideas') {
    return '관련 아이디어 보기';
  }

  return '관련 항목 보기';
}

function qualityLabel(level: QualityLevel) {
  if (level === 'ready') {
    return '양호';
  }

  if (level === 'review') {
    return '보완 필요';
  }

  return '차단';
}

function publicationBadgeVariant(level: PublicationReadiness['level']): 'success' | 'warning' | 'danger' {
  if (level === 'ready') return 'success';
  if (level === 'blocked') return 'danger';
  return 'warning';
}

function qualityBadgeVariant(level: QualityLevel): 'success' | 'warning' | 'danger' {
  if (level === 'ready') {
    return 'success';
  }

  if (level === 'review') {
    return 'warning';
  }

  return 'danger';
}

function qualityBarClass(level: QualityLevel) {
  if (level === 'ready') {
    return 'bg-emerald-500';
  }

  if (level === 'review') {
    return 'bg-amber-400';
  }

  return 'bg-red-500';
}

function actionPriorityLabel(priority: QualityActionPriority) {
  if (priority === 'now') {
    return '지금 처리';
  }

  if (priority === 'next') {
    return '다음 처리';
  }

  return '나중에';
}

function actionPriorityVariant(priority: QualityActionPriority): 'success' | 'warning' | 'danger' {
  if (priority === 'now') {
    return 'danger';
  }

  if (priority === 'next') {
    return 'warning';
  }

  return 'success';
}
