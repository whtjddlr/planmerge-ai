import { StatusBadge } from './StatusBadge';
import type { DecisionOpinion, DecisionSource, DecisionTrace } from '../data/mergeResult';
import type { DecisionResolutionResult } from '../lib/ai/decisionResolution';

type ConsensusPatchPanelProps = {
  beforeContent: string;
  error?: string;
  loading: boolean;
  resolution?: DecisionResolutionResult;
  trace: DecisionTrace;
  onApply?: () => void;
  onRequest: () => void;
};

type ResolutionEvidence = {
  id: string;
  kind: 'selected' | 'alternative' | 'conflict' | 'unknown';
  label: string;
  content: string;
  sources: DecisionSource[];
};

export function ConsensusPatchPanel({
  beforeContent,
  error,
  loading,
  resolution,
  trace,
  onApply,
  onRequest,
}: ConsensusPatchPanelProps) {
  const proposal = resolution?.proposal;
  const status = proposal?.status;
  const afterContent = proposal?.revisedSectionContent ?? proposal?.synthesizedDecision ?? '';
  const canApply = Boolean(
    resolution?.applicable &&
    status === 'ready' &&
    afterContent.trim() &&
    onApply,
  );

  return (
    <section
      data-testid="decision-resolution-panel"
      aria-labelledby={`decision-room-title-${trace.decisionBlockId}`}
      className="pb-6 border-b border-gray-100"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`decision-room-title-${trace.decisionBlockId}`} className="text-sm text-gray-900">
              Decision Room
            </h3>
            <StatusBadge variant={statusVariant({ error, loading, status })}>
              {statusLabel({ error, loading, status })}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            GPT-5.6이 원문 근거와 팀 피드백을 비교해 이 결정만 다시 병합합니다.
          </p>
        </div>
        {resolution && (
          <span className="shrink-0 rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
            {resolution.model}
          </span>
        )}
      </div>

      {loading ? (
        <ResolutionLoadingState />
      ) : error ? (
        <ResolutionErrorState message={error} onRetry={onRequest} />
      ) : resolution && proposal ? (
        <div className="space-y-4">
          {resolution.warning && (
            <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              {resolution.warning}
            </div>
          )}

          {status === 'ready' ? (
            <ReadyResolution
              beforeContent={beforeContent}
              resolution={resolution}
              trace={trace}
            />
          ) : (
            <NeedsInputResolution resolution={resolution} />
          )}

          <ResolutionMetadata resolution={resolution} />

          {status === 'ready' ? (
            <button
              type="button"
              data-testid="decision-resolution-apply"
              className={`w-full rounded-md px-3 py-2.5 text-sm transition-colors ${
                canApply
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400'
              }`}
              disabled={!canApply}
              onClick={onApply}
            >
              Apply consensus
            </button>
          ) : (
            <button
              type="button"
              data-testid="decision-resolution-trigger"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
              onClick={onRequest}
            >
              Ask GPT-5.6 again
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
          <p className="text-xs leading-relaxed text-blue-900">
            현재 선택안, 대안, 충돌 의견과 참여자 피드백을 함께 검토해 출처가 남는 합의안을 제안합니다.
          </p>
          <button
            type="button"
            data-testid="decision-resolution-trigger"
            className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2.5 text-sm text-white transition-colors hover:bg-blue-700"
            onClick={onRequest}
          >
            Ask GPT-5.6
          </button>
        </div>
      )}
    </section>
  );
}

function ReadyResolution({
  beforeContent,
  resolution,
  trace,
}: {
  beforeContent: string;
  resolution: DecisionResolutionResult;
  trace: DecisionTrace;
}) {
  const { proposal } = resolution;
  const afterContent = proposal.revisedSectionContent ?? proposal.synthesizedDecision ?? '';
  const evidence = createResolutionEvidence(trace, proposal.supportingOptionIds);

  return (
    <>
      <div className="rounded-md border border-green-100 bg-green-50/50 px-3 py-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-xs text-green-800">GPT-5.6 합의 요약</div>
          <div className="text-xs text-green-700">신뢰도 {formatConfidence(proposal.confidence)}</div>
        </div>
        <p className="text-sm leading-relaxed text-green-950">{proposal.summary}</p>
        {proposal.synthesizedDecision && proposal.synthesizedDecision !== afterContent && (
          <p className="mt-2 text-xs leading-relaxed text-green-800">{proposal.synthesizedDecision}</p>
        )}
      </div>

      <div className="space-y-2">
        <div
          data-testid="decision-resolution-before"
          className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3"
        >
          <div className="mb-1 text-xs text-gray-500">Before · 현재 섹션</div>
          <p className="text-xs leading-relaxed text-gray-700">{beforeContent}</p>
        </div>
        <div
          data-testid="decision-resolution-after"
          className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-3"
        >
          <div className="mb-1 text-xs text-blue-700">After · 제안된 섹션</div>
          <p className="text-sm leading-relaxed text-blue-950">{afterContent}</p>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-gray-500">선택 근거</div>
        <p className="text-xs leading-relaxed text-gray-700">{proposal.selectionReason}</p>
      </div>

      <ResolutionEvidenceList
        evidence={evidence}
        addressedOpinionCount={proposal.addressedOpinionIds.length}
      />

      {proposal.unresolvedRisks.length > 0 && (
        <UnresolvedRisks risks={proposal.unresolvedRisks} />
      )}
    </>
  );
}

function NeedsInputResolution({ resolution }: { resolution: DecisionResolutionResult }) {
  const { proposal } = resolution;

  return (
    <div className="space-y-3">
      <div
        data-testid="decision-resolution-question"
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
      >
        <div className="mb-1 text-xs text-amber-700">합의에 필요한 확인 질문</div>
        <p className="text-sm leading-relaxed text-amber-950">
          {proposal.clarifyingQuestion ?? '결정을 확정하려면 팀의 추가 의견이 필요합니다.'}
        </p>
      </div>
      <p className="text-xs leading-relaxed text-gray-600">{proposal.summary}</p>
      {proposal.unresolvedRisks.length > 0 && (
        <UnresolvedRisks risks={proposal.unresolvedRisks} />
      )}
    </div>
  );
}

function ResolutionEvidenceList({
  addressedOpinionCount,
  evidence,
}: {
  addressedOpinionCount: number;
  evidence: ResolutionEvidence[];
}) {
  return (
    <div data-testid="decision-resolution-evidence">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">검증된 근거</div>
        <div className="text-xs text-gray-400">
          선택지 {evidence.length}개 · 팀 의견 {addressedOpinionCount}개 반영
        </div>
      </div>
      {evidence.length > 0 ? (
        <div className="space-y-2">
          {evidence.map((item) => (
            <div key={item.id} className="rounded-md border border-gray-100 px-3 py-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-700">{item.label}</div>
                  <div className="truncate font-mono text-[10px] text-gray-400">{item.id}</div>
                </div>
                <span className="text-[11px] text-gray-400">{evidenceKindLabel(item.kind)}</span>
              </div>
              <p className="text-xs leading-relaxed text-gray-600">{item.content}</p>
              {item.sources.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {item.sources.map((source) => (
                    <div key={sourceKey(source)} className="rounded bg-gray-50 px-2 py-1.5">
                      <div className="text-[11px] text-gray-500">
                        {source.authorName} / {source.aiModel}
                      </div>
                      {source.sourceExcerpt && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">
                          {source.sourceExcerpt}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs italic text-gray-400">표시할 선택지 근거가 없습니다.</p>
      )}
    </div>
  );
}

function UnresolvedRisks({ risks }: { risks: string[] }) {
  return (
    <div className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2.5">
      <div className="mb-1 text-xs text-amber-800">남은 리스크</div>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-900">
        {risks.map((risk) => (
          <li key={risk}>{risk}</li>
        ))}
      </ul>
    </div>
  );
}

function ResolutionMetadata({ resolution }: { resolution: DecisionResolutionResult }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-gray-50 px-3 py-2 text-[11px]">
      <dt className="text-gray-400">Model</dt>
      <dd className="text-right font-mono text-gray-600">{resolution.model}</dd>
      <dt className="text-gray-400">Source</dt>
      <dd className="text-right text-gray-600">{resolutionSourceLabel(resolution.source)}</dd>
      {resolution.responseId && (
        <>
          <dt className="text-gray-400">Response ID</dt>
          <dd className="break-all text-right font-mono text-gray-600">{resolution.responseId}</dd>
        </>
      )}
      <dt className="text-gray-400">Generated</dt>
      <dd className="break-all text-right font-mono text-gray-600">{resolution.generatedAt}</dd>
    </dl>
  );
}

function ResolutionLoadingState() {
  return (
    <div role="status" aria-live="polite" className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <div className="text-sm text-blue-950">GPT-5.6이 합의안을 만들고 있습니다</div>
      </div>
      <div className="space-y-2">
        <div className="h-2 w-full animate-pulse rounded-full bg-blue-100" />
        <div className="h-2 w-5/6 animate-pulse rounded-full bg-blue-100" />
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-blue-100" />
      </div>
      <div className="mt-3 space-y-1 text-xs leading-relaxed text-blue-800/70">
        <div>1. 선택안과 충돌 의견의 원문 ID를 검증합니다.</div>
        <div>2. 팀 투표와 익명 의견을 프로젝트 기준과 비교합니다.</div>
        <div>3. 이 섹션만 다시 병합하고 출처를 확인합니다.</div>
      </div>
    </div>
  );
}

function ResolutionErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-red-100 bg-red-50 px-3 py-3">
      <div className="text-xs text-red-800">합의안을 만들지 못했습니다.</div>
      <p className="mt-1 text-xs leading-relaxed text-red-700">{message}</p>
      <button
        type="button"
        data-testid="decision-resolution-trigger"
        className="mt-3 w-full rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 transition-colors hover:bg-red-50"
        onClick={onRetry}
      >
        Ask GPT-5.6 again
      </button>
    </div>
  );
}

function createResolutionEvidence(trace: DecisionTrace, optionIds: string[]): ResolutionEvidence[] {
  const optionById = new Map<string, ResolutionEvidence>();

  if (trace.selectedOptionId) {
    optionById.set(trace.selectedOptionId, {
      id: trace.selectedOptionId,
      kind: 'selected',
      label: '현재 선택안',
      content: trace.selectedContent,
      sources: trace.selectedSources ?? [],
    });
  }

  addOpinionsToEvidenceMap(optionById, trace.alternatives, 'alternative');
  addOpinionsToEvidenceMap(optionById, trace.conflicts, 'conflict');

  return optionIds.map((optionId) => optionById.get(optionId) ?? {
    id: optionId,
    kind: 'unknown',
    label: optionId,
    content: '서버가 검증한 근거 선택지입니다.',
    sources: [],
  });
}

function addOpinionsToEvidenceMap(
  evidenceById: Map<string, ResolutionEvidence>,
  opinions: DecisionOpinion[],
  kind: 'alternative' | 'conflict',
) {
  opinions.forEach((opinion) => {
    if (!opinion.optionId) {
      return;
    }

    evidenceById.set(opinion.optionId, {
      id: opinion.optionId,
      kind,
      label: opinion.title,
      content: opinion.description,
      sources: opinion.sources,
    });
  });
}

function statusVariant({
  error,
  loading,
  status,
}: {
  error?: string;
  loading: boolean;
  status?: 'ready' | 'needs_input';
}) {
  if (error) return 'danger' as const;
  if (loading) return 'default' as const;
  if (status === 'ready') return 'success' as const;
  if (status === 'needs_input') return 'warning' as const;
  return 'default' as const;
}

function statusLabel({
  error,
  loading,
  status,
}: {
  error?: string;
  loading: boolean;
  status?: 'ready' | 'needs_input';
}) {
  if (error) return '오류';
  if (loading) return '분석 중';
  if (status === 'ready') return '적용 가능';
  if (status === 'needs_input') return '추가 의견 필요';
  return '대기';
}

function formatConfidence(confidence: number) {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function evidenceKindLabel(kind: ResolutionEvidence['kind']) {
  if (kind === 'selected') return '선택안';
  if (kind === 'alternative') return '대안';
  if (kind === 'conflict') return '충돌';
  return '근거';
}

function resolutionSourceLabel(source: DecisionResolutionResult['source']) {
  if (source === 'openai') return 'OpenAI Responses API';
  if (source === 'gms') return 'GMS Responses API';
  return 'Local fallback';
}

function sourceKey(source: DecisionSource) {
  return `${source.sourceIdeaId ?? source.sourceDraftId ?? source.authorName}-${source.aiModel}`;
}
