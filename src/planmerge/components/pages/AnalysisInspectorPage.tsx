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

type AnalysisInspectorPageProps = {
  project: ProjectSettings;
  drafts: LocalDraftSubmission[];
  analysisResult?: PlanMergeAnalysisResult;
  analysisStatus: 'idle' | 'analyzing' | 'completed';
  decisionLogs: LocalDecisionLog[];
  onRunAnalysis: () => void;
  readOnly: boolean;
};

type InspectorTab = 'quality' | 'ideas' | 'decisions' | 'logs' | 'validation';

const tabLabels: Record<InspectorTab, string> = {
  quality: 'Quality Gate',
  ideas: 'Ideas',
  decisions: 'Decision Blocks',
  logs: 'Decision Logs',
  validation: 'Validation',
};

export function AnalysisInspectorPage({
  project,
  drafts,
  analysisResult,
  analysisStatus,
  decisionLogs,
  onRunAnalysis,
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

    return evaluateAnalysisQuality({ project, drafts }, analysisResult);
  }, [analysisResult, drafts, project]);
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
      <main className="flex min-h-0 flex-1 items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-xl rounded-md border border-gray-200 p-6">
          <h2 className="text-base text-gray-900">분석 결과 없음</h2>
          <div className="mt-2 text-sm leading-relaxed text-gray-600">
            현재 워크스페이스에는 검사할 분석 결과가 없습니다.
          </div>
          {!readOnly && (
            <button
              type="button"
              className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-gray-300"
              disabled={analysisStatus === 'analyzing'}
              onClick={onRunAnalysis}
            >
              {analysisStatus === 'analyzing' ? '분석 중' : '분석 실행'}
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl text-gray-900">Analysis Inspector</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <StatusBadge variant={analysisResult.source === 'local_harness' ? 'warning' : 'success'}>
                {analysisResult.source === 'gms'
                  ? 'GMS'
                  : analysisResult.source === 'gemini'
                    ? 'Gemini'
                  : analysisResult.source === 'solar'
                    ? 'Solar'
                    : 'Local Harness'}
              </StatusBadge>
              <StatusBadge variant={validation?.valid ? 'success' : 'danger'}>
                {validation?.valid ? 'Valid' : 'Invalid'}
              </StatusBadge>
              <span>{analysisResult.protocolVersion}</span>
            </div>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="w-fit rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:text-gray-400"
              disabled={analysisStatus === 'analyzing'}
              onClick={onRunAnalysis}
            >
              {analysisStatus === 'analyzing' ? '분석 중' : '다시 분석'}
            </button>
          )}
        </div>

        <SummaryGrid
          analysisResult={analysisResult}
          decisionLogCount={decisionLogs.length}
          qualityScore={qualityReport?.score ?? 0}
          validationErrorCount={validation?.errors.length ?? 0}
        />

        <div className="mt-6 border-b border-gray-200">
          <div className="flex gap-1 overflow-x-auto">
            {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
              <button
                type="button"
                key={tab}
                className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
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
  qualityScore,
  validationErrorCount,
}: {
  analysisResult: PlanMergeAnalysisResult;
  decisionLogCount: number;
  qualityScore: number;
  validationErrorCount: number;
}) {
  const unresolvedDecisionCount = analysisResult.decisionBlocks.filter(
    (block) => block.needsHumanReview || block.conflictLevel !== 'none',
  ).length;
  const items = [
    { label: 'Evidence Score', value: qualityScore },
    { label: 'Normalized Ideas', value: analysisResult.normalizedIdeas.length },
    { label: 'Decision Blocks', value: analysisResult.decisionBlocks.length },
    { label: 'Unresolved', value: unresolvedDecisionCount },
    { label: 'Final Sections', value: analysisResult.finalDocumentSections.length },
    { label: 'Missing Sections', value: analysisResult.missingSections.length },
    { label: 'Decision Logs', value: decisionLogCount },
    { label: 'Validation Errors', value: validationErrorCount },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-gray-200 p-4">
          <div className="text-xs text-gray-500">{item.label}</div>
          <div className="mt-2 text-2xl text-gray-900">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function QualityGateTab({
  drafts,
  onOpenAction,
  qualityReport,
}: {
  drafts: LocalDraftSubmission[];
  onOpenAction: (action: QualityAction) => void;
  qualityReport: AnalysisQualityReport;
}) {
  const draftsById = useMemo(() => new Map(drafts.map((draft) => [draft.id, draft])), [drafts]);

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-gray-200 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-lg text-gray-900">Quality Gate</h3>
              <StatusBadge variant={qualityBadgeVariant(qualityReport.level)}>
                {qualityLabel(qualityReport.level)}
              </StatusBadge>
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-gray-600">{qualityReport.summary}</p>
          </div>
          <div className="rounded-md border border-gray-100 px-5 py-4 text-center">
            <div className="text-xs text-gray-500">품질 점수</div>
            <div className="mt-1 text-4xl text-gray-900">{qualityReport.score}</div>
            <div className="mt-1 text-xs text-gray-400">/ 100</div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {qualityReport.metrics.map((item) => (
          <QualityMetricCard key={item.id} metric={item} />
        ))}
      </section>

      <section className="rounded-md border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-gray-900">Next Actions</h3>
          <span className="text-xs text-gray-400">{qualityReport.nextActions.length}개 액션</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {qualityReport.nextActions.map((action) => (
            <div key={action.id} className="rounded-md border border-gray-100 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge variant={actionPriorityVariant(action.priority)}>
                  {actionPriorityLabel(action.priority)}
                </StatusBadge>
                <div className="text-sm text-gray-900">{action.title}</div>
              </div>
              {action.target && (
                <div className="mb-1 text-xs text-gray-500">{action.target}</div>
              )}
              <p className="text-xs leading-relaxed text-gray-600">{action.detail}</p>
              <div className="mt-2 rounded bg-gray-50 px-2 py-1 text-xs text-gray-500">
                기대 효과: {action.expectedImpact}
              </div>
              {action.destination && (
                <button
                  type="button"
                  className="mt-3 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
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
        <div className="rounded-md border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm text-gray-900">Review Findings</h3>
            <StatusBadge variant={qualityReport.findings.length ? 'warning' : 'success'}>
              {qualityReport.findings.length}개
            </StatusBadge>
          </div>
          {qualityReport.findings.length ? (
            <div className="space-y-2">
              {qualityReport.findings.map((finding) => (
                <div key={finding.id} className="rounded-md border border-gray-100 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge variant={qualityBadgeVariant(finding.severity)}>
                      {qualityLabel(finding.severity)}
                    </StatusBadge>
                    <div className="text-sm text-gray-900">{finding.title}</div>
                  </div>
                  {finding.target && (
                    <div className="mb-1 text-xs text-gray-500">{finding.target}</div>
                  )}
                  <p className="text-xs leading-relaxed text-gray-600">{finding.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600">즉시 조치가 필요한 품질 이슈가 없습니다.</p>
          )}
        </div>

        <div className="rounded-md border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm text-gray-900">Draft Coverage</h3>
            <span className="text-xs text-gray-400">{qualityReport.sourceCoverageByDraft.length}개 초안</span>
          </div>
          <div className="space-y-2">
            {qualityReport.sourceCoverageByDraft.map((item) => {
              const draft = draftsById.get(item.draftId);

              return (
                <div key={item.draftId} className="rounded-md bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-gray-900">
                        {draft ? `${draft.authorName} · ${draft.taskTitle}` : item.draftId}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">{item.draftId}</div>
                    </div>
                    <StatusBadge variant={item.ideaCount ? 'success' : 'warning'}>
                      {item.ideaCount} ideas
                    </StatusBadge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-gray-900">Section Coverage</h3>
          <span className="text-xs text-gray-400">기본 12개 섹션</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {qualityReport.sectionCoverage.map((section) => (
            <div key={section.sectionKey} className="rounded-md border border-gray-100 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="text-sm text-gray-900">{section.title}</div>
                <StatusBadge variant={section.hasFinalSection ? 'success' : 'warning'}>
                  {section.hasFinalSection ? '작성됨' : '누락'}
                </StatusBadge>
              </div>
              <div className="text-xs text-gray-500">
                ideas {section.ideaCount} · decisions {section.decisionBlockCount}
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
        <h3 className="text-sm text-gray-900">Decision Logs</h3>
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
            <StatusBadge variant={log.action === 'ai_consensus_applied' ? 'success' : 'warning'}>
              {log.action === 'ai_consensus_applied' ? 'GPT-5.6 consensus' : '사용자 변경'}
            </StatusBadge>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md bg-gray-50 p-3">
              <div className="mb-1 text-xs text-gray-500">변경 전</div>
              <p className="text-sm leading-relaxed text-gray-700">
                {log.beforeValue ?? '기존 선택안 없음'}
              </p>
              {log.beforeOptionId && (
                <div className="mt-2 text-xs text-gray-400">{log.beforeOptionId}</div>
              )}
            </div>
            <div className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
              <div className="mb-1 text-xs text-blue-700">변경 후</div>
              <p className="text-sm leading-relaxed text-gray-900">{log.afterValue}</p>
              <div className="mt-2 text-xs text-blue-500">{log.afterOptionId}</div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-gray-100 p-3">
            <div className="mb-1 text-xs text-gray-500">reason</div>
            <p className="text-xs leading-relaxed text-gray-600">{log.reason}</p>
            {log.action === 'ai_consensus_applied' && (
              <div
                data-testid="decision-log-model-evidence"
                className="mt-3 grid gap-1 border-t border-gray-100 pt-3 font-mono text-xs text-gray-500"
              >
                <span>model: {log.model ?? 'unknown'}</span>
                <span>response: {log.responseId ?? 'not recorded'}</span>
                {log.generatedAt && <span>generated: {log.generatedAt}</span>}
                <span>
                  supporting options: {log.supportingOptionIds?.join(', ') || 'none'}
                </span>
                <span>
                  addressed opinions: {log.addressedOpinionIds?.join(', ') || 'none'}
                </span>
              </div>
            )}
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
                <div className="mb-1 text-xs text-gray-500">sourceExcerpt</div>
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
            <h3 className="text-sm text-gray-900">Decision Block 필터</h3>
            <p className="mt-1 text-xs text-gray-500">
              Quality Gate 액션에서 넘어오면 관련 결정만 좁혀서 봅니다.
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
          {decisionFilterLabel(decisionFilter)} 조건에 해당하는 Decision Block이 없습니다.
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
                {block.id} · {sectionTitle(block.sectionKey)} · confidence {Math.round(block.confidence * 100)}%
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {focused && <StatusBadge variant="success">Action Focus</StatusBadge>}
              <StatusBadge variant={block.needsHumanReview ? 'warning' : 'success'}>
                {block.needsHumanReview ? '검토 필요' : '자동 선택'}
              </StatusBadge>
              <StatusBadge variant={block.conflictLevel === 'none' ? 'default' : 'warning'}>
                conflict {block.conflictLevel}
              </StatusBadge>
            </div>
          </div>
          <div className="mb-4 rounded-md bg-gray-50 p-3">
            <div className="mb-1 text-xs text-gray-500">selectionReason</div>
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
            {option.id} · {option.optionType}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected && <StatusBadge variant="success">selected</StatusBadge>}
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
          <h3 className="text-sm text-gray-900">Validation Errors</h3>
          <div className="flex items-center gap-2">
            {validationFocus === 'errors' && <StatusBadge variant="danger">Action Focus</StatusBadge>}
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
          <h3 className="text-sm text-gray-900">Warnings</h3>
          <div className="flex items-center gap-2">
            {validationFocus === 'warnings' && <StatusBadge variant="warning">Action Focus</StatusBadge>}
            <StatusBadge variant={analysisResult.warnings.length ? 'warning' : 'success'}>
              {analysisResult.warnings.length}개
            </StatusBadge>
          </div>
        </div>
        {analysisResult.warnings.length ? (
          <div className="space-y-2">
            {analysisResult.warnings.map((warning) => (
              <div key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                {warning}
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
          <h3 className="text-sm text-gray-900">Missing Sections</h3>
          <div className="flex items-center gap-2">
            {validationFocus === 'missing_sections' && <StatusBadge variant="warning">Action Focus</StatusBadge>}
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
    return 'Ready';
  }

  if (level === 'review') {
    return 'Review';
  }

  return 'Blocked';
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
    return 'Now';
  }

  if (priority === 'next') {
    return 'Next';
  }

  return 'Later';
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
