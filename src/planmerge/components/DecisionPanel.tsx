import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GitCompare, Maximize2, MessageSquare, Minimize2, ShieldAlert } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { getDecisionTrace } from '../data/mergeResult';
import type { AnonymousOpinion, DecisionOpinion, DecisionTrace, DocumentSectionData } from '../data/mergeResult';
import { getAnonymousClientId } from '../lib/anonymousClient';
import {
  addAnonymousOpinion,
  buildVoteOptions,
  createEmptyParticipationState,
  getTotalVotes,
  getVoteCount,
  groupLabel,
  loadParticipationState,
  saveParticipationState,
  voteOnOption,
} from '../lib/decisionParticipation';
import type { DecisionVote, ParticipationState, ParticipationStateScope } from '../lib/decisionParticipation';
import {
  createOpinionClusteringPayload,
  generateOpinionClusters,
  loadOpinionClusterState,
  saveOpinionClusterState,
} from '../lib/ai/opinionClustering';
import type { OpinionClusteringResult, OpinionClusterStateScope } from '../lib/ai/opinionClustering';
import {
  fetchBlockParticipation,
  SHARED_LINK_UNAVAILABLE_MESSAGE,
  SHARED_PARTICIPATION_FAILED_MESSAGE,
  SHARED_RATE_LIMIT_MESSAGE,
  SharedWorkspaceRequestError,
  submitSharedOpinion,
  submitSharedVote,
} from '../lib/sharedWorkspaceClient';
import type { SharedParticipation } from '../lib/sharedWorkspaceClient';
import type { SharedWorkspaceOwnerAccess } from '../lib/sharedWorkspaceOwnerStore';

type DecisionPanelProps = {
  selectedSection: DocumentSectionData;
  analysisRunId: number;
  localWorkspaceId: string | null;
  sharedWorkspaceId?: string | null;
  sharedSnapshotVersion?: number | null;
  ownerShareAccess?: SharedWorkspaceOwnerAccess | null;
  approvedBlockIds: string[];
  reviewRequiredBlockIds: string[];
  onApplyDecisionOption?: (decisionBlockId: string, optionId: string) => void;
  onApproveDecision?: (decisionBlockId: string) => void;
};

type SharedPendingAction = 'vote' | 'opinion';

type SharedActionErrorState = {
  action: SharedPendingAction | 'load';
  decisionBlockId: string;
  message: string;
};

type OwnerSharedFeedbackState = {
  sourceKey: string;
  status: 'loaded' | 'error';
  participation: SharedParticipation | null;
  message?: string;
};

function toSharedDecisionVote(
  participation: SharedParticipation | null,
  voterKey: string,
): DecisionVote | undefined {
  if (!participation) {
    return undefined;
  }

  return {
    voterKey,
    selectedOptionId: participation.myOptionId,
    overrides: participation.votes,
  };
}

function SourceChips({ opinion }: { opinion: DecisionOpinion }) {
  const excerpts = opinion.sources.filter((source) => source.sourceExcerpt);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {opinion.sources.map((source) => (
          <div
            key={`${source.sourceIdeaId ?? source.authorName}-${source.aiModel}`}
            className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
          >
            {source.authorName} / {source.aiModel}
            {source.taskTitle ? ` · ${source.taskTitle}` : ''}
          </div>
        ))}
      </div>

      {excerpts.length > 0 && (
        <div className="space-y-1.5">
          {excerpts.map((source) => (
            <div
              key={`${source.sourceIdeaId}-excerpt`}
              className="rounded-md bg-gray-50 px-2.5 py-2 text-xs leading-relaxed text-gray-600"
            >
              <span className="text-gray-400">원문 발췌</span>
              <span className="mx-1 text-gray-300">·</span>
              {source.sourceExcerpt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectedSources({ trace }: { trace: DecisionTrace }) {
  if (!trace.selectedSources?.length) {
    return null;
  }

  return (
    <div className="mt-3">
      <div className="mb-1 text-xs text-gray-500">선택안 출처</div>
      <SourceChips
        opinion={{
          title: trace.selectedContent,
          description: trace.selectionReason,
          sources: trace.selectedSources,
        }}
      />
    </div>
  );
}

function AnonymousVotePanel({
  trace,
  votes,
  shared,
  disabled,
  onVote,
}: {
  trace: DecisionTrace;
  votes?: DecisionVote;
  shared?: boolean;
  disabled?: boolean;
  onVote: (optionId: string) => void;
}) {
  const options = useMemo(() => buildVoteOptions(trace), [trace]);
  const totalVotes = getTotalVotes(options, votes);

  return (
    <div className="pb-6 border-b border-gray-100">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs text-gray-500">익명 투표</div>
        <div className="text-xs text-gray-400">{totalVotes}표</div>
      </div>
      <div className="space-y-2">
        {options.map((option) => {
          const count = getVoteCount(option, votes);
          const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = votes?.selectedOptionId === option.id;

          return (
            <button
              type="button"
              key={option.id}
              className={`w-full rounded-md border p-3 text-left transition-colors ${
                selected
                  ? 'border-blue-300 bg-blue-50/50'
                  : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
              } disabled:cursor-wait disabled:opacity-70`}
              disabled={disabled}
              onClick={() => onVote(option.id)}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900">{option.label}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{groupLabel(option.group)}</div>
                </div>
                <div className="text-xs text-gray-500">
                  {count}표 · {percent}%
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${
                    option.group === 'conflict' ? 'bg-amber-400' : selected ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {shared
          ? '투표는 익명으로 참여자 전체 기준으로 집계됩니다. 같은 섹션에서는 선택을 바꿀 수 있습니다.'
          : '투표는 익명으로 이 브라우저에만 저장됩니다. 같은 섹션에서는 선택을 바꿀 수 있습니다.'}
      </p>
    </div>
  );
}

function OpinionPanel({
  opinions,
  draftOpinion,
  errorMessage,
  submitting,
  onDraftChange,
  onSubmit,
}: {
  opinions: AnonymousOpinion[];
  draftOpinion: string;
  errorMessage?: string;
  submitting?: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = draftOpinion.trim().length > 0;
  const buttonDisabled = !canSubmit || Boolean(submitting);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-gray-500">익명 의견</div>
        <div className="text-xs text-gray-400">{opinions.length}개</div>
      </div>

      <div className="space-y-3">
        {opinions.length > 0 ? (
          opinions.map((opinion) => (
            <div key={opinion.id} className="rounded-md border border-gray-100 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500">익명 의견</div>
                <div className="text-xs text-gray-400">{opinion.createdAtLabel}</div>
              </div>
              <p className="text-sm leading-relaxed text-gray-700">{opinion.content}</p>
            </div>
          ))
        ) : (
          <EmptyDecisionState label="아직 남겨진 의견이 없습니다." />
        )}
      </div>

      <div className="mt-4">
        <textarea
          value={draftOpinion}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="의견을 익명으로 남기기"
          className="min-h-20 w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-500"
        />
        <button
          type="button"
          className={`mt-2 w-full rounded-md px-3 py-2 text-sm transition-colors ${
            !buttonDisabled
              ? 'bg-gray-900 text-white hover:bg-gray-800'
              : 'cursor-not-allowed bg-gray-100 text-gray-400'
          }`}
          disabled={buttonDisabled}
          onClick={onSubmit}
        >
          {submitting ? '등록 중' : '익명 의견 등록'}
        </button>
        {errorMessage && (
          <div className="mt-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function OpinionClusterPanel({
  clusterResult,
  loading,
  opinionCount,
  onGenerate,
}: {
  clusterResult?: OpinionClusteringResult;
  loading: boolean;
  opinionCount: number;
  onGenerate: () => void;
}) {
  return (
    <div className="pb-6 border-b border-gray-100">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">AI 의견 요약</div>
          <div className="mt-1 text-xs text-gray-400">
            GMS GPT-4.1 기준 · {opinionCount}개 의견
          </div>
        </div>
        <button
          type="button"
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            loading
              ? 'cursor-wait border-gray-200 bg-gray-50 text-gray-400'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
          disabled={loading || opinionCount === 0}
          onClick={onGenerate}
        >
          {loading ? '요약 중' : clusterResult ? '다시 요약' : '요약 생성'}
        </button>
      </div>

      {clusterResult?.warning && (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          {clusterResult.warning}
        </div>
      )}

      {loading ? (
        <OpinionClusterLoadingState />
      ) : clusterResult ? (
        <div className="space-y-3">
          {clusterResult.clusters.map((cluster) => (
            <div key={cluster.id} className="rounded-md border border-gray-100 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900">{cluster.title}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {cluster.category} · {cluster.impact} · {cluster.opinionIds.length}개 의견
                  </div>
                </div>
                <StatusBadge variant={cluster.impact === 'high' ? 'warning' : 'default'}>
                  {cluster.stance === 'supports_selected' ? '선택안 지지' :
                    cluster.stance === 'supports_alternative' ? '대안 지지' :
                      cluster.stance === 'raises_concern' ? '우려' :
                        cluster.stance === 'proposes_change' ? '변경 제안' : '중립'}
                </StatusBadge>
              </div>
              <p className="mb-2 text-sm leading-relaxed text-gray-700">{cluster.summary}</p>
              <p className="text-xs leading-relaxed text-gray-500">{cluster.reasoning}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyDecisionState label={opinionCount > 0 ? '아직 생성된 의견 요약이 없습니다.' : '요약할 의견이 없습니다.'} />
      )}
    </div>
  );
}

function OpinionClusterLoadingState() {
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <div className="text-sm text-gray-900">AI가 의견을 묶고 있습니다</div>
      </div>
      <div className="space-y-2">
        <div className="h-2 w-full animate-pulse rounded-full bg-blue-100" />
        <div className="h-2 w-5/6 animate-pulse rounded-full bg-blue-100" />
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-blue-100" />
      </div>
      <div className="mt-3 space-y-1 text-xs leading-relaxed text-gray-500">
        <div>1. 원문 의견 ID를 검증합니다.</div>
        <div>2. 유사한 의견을 클러스터로 묶습니다.</div>
        <div>3. 선택안과의 관계를 분류합니다.</div>
      </div>
    </div>
  );
}

function waitForLoadingTime(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function EmptyDecisionState({ label }: { label: string }) {
  return (
    <div className="text-xs text-gray-400 italic">
      {label}
    </div>
  );
}

function SharedLinkFeedbackPanel({
  errorMessage,
  loading,
  participation,
  trace,
}: {
  errorMessage?: string;
  loading: boolean;
  participation: SharedParticipation | null;
  trace: DecisionTrace;
}) {
  const options = useMemo(() => buildVoteOptions(trace), [trace]);
  const votes = toSharedDecisionVote(participation, 'shared-link-feedback');
  const totalVotes = getTotalVotes(options, votes);
  const opinions = participation?.opinions ?? [];

  return (
    <div className="pb-6 border-b border-gray-100">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">공유 링크 피드백</div>
        <div className="text-xs text-gray-400">
          {loading ? '불러오는 중' : `${totalVotes}표 · 의견 ${opinions.length}개`}
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
          {errorMessage}
        </div>
      ) : loading ? (
        <div className="rounded-md border border-blue-100 bg-blue-50/40 px-3 py-2 text-xs text-blue-700">
          공유 링크 피드백을 불러오는 중입니다.
        </div>
      ) : participation ? (
        <div className="space-y-4">
          <div className="space-y-2">
            {options.map((option) => {
              const count = getVoteCount(option, votes);
              const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

              return (
                <div key={option.id} className="rounded-md border border-gray-100 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-gray-900">{option.label}</div>
                      <div className="mt-0.5 text-xs text-gray-500">{groupLabel(option.group)}</div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {count}표 · {percent}%
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${
                        option.group === 'conflict' ? 'bg-amber-400' : 'bg-blue-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <div className="mb-2 text-xs text-gray-500">공유 의견</div>
            {opinions.length > 0 ? (
              <div className="space-y-2">
                {opinions.map((opinion) => (
                  <div key={opinion.id} className="rounded-md border border-gray-100 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-xs text-gray-500">익명 의견</div>
                      <div className="text-xs text-gray-400">{opinion.createdAtLabel}</div>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-700">{opinion.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyDecisionState label="공유 링크에 아직 남겨진 의견이 없습니다." />
            )}
          </div>
        </div>
      ) : (
        <EmptyDecisionState label="공유 링크 피드백을 찾지 못했습니다." />
      )}
    </div>
  );
}

function getSharedParticipationErrorMessage(error: unknown) {
  if (error instanceof SharedWorkspaceRequestError) {
    if (error.status === 429) {
      return SHARED_RATE_LIMIT_MESSAGE;
    }

    if (error.status === 410) {
      return SHARED_LINK_UNAVAILABLE_MESSAGE;
    }

    if (error.status === 409) {
      return error.message;
    }

    return SHARED_PARTICIPATION_FAILED_MESSAGE;
  }

  return SHARED_PARTICIPATION_FAILED_MESSAGE;
}

function ApplyOptionButton({
  optionId,
  decisionBlockId,
  onApplyDecisionOption,
}: {
  optionId?: string;
  decisionBlockId: string;
  onApplyDecisionOption?: (decisionBlockId: string, optionId: string) => void;
}) {
  if (!optionId || !onApplyDecisionOption) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="apply-decision-option"
      className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
      onClick={() => onApplyDecisionOption(decisionBlockId, optionId)}
    >
      선택안으로 적용
    </button>
  );
}

function DecisionComparison({
  approved,
  onApplyDecisionOption,
  onApproveDecision,
  trace,
}: {
  approved: boolean;
  onApplyDecisionOption?: (decisionBlockId: string, optionId: string) => void;
  onApproveDecision?: (decisionBlockId: string) => void;
  trace: DecisionTrace;
}) {
  const comparison = trace.conflicts[0] ?? trace.alternatives[0];

  if (!comparison) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3">
        <div className="text-xs font-semibold text-blue-700">변경 영향 미리보기</div>
        <h3 className="mt-1 text-base font-semibold text-slate-950">현재 문장과 대체 문장을 비교합니다.</h3>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-blue-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold text-blue-700">현재 선택안</div>
          <p className="text-sm leading-7 text-slate-800">{trace.selectedContent}</p>
          {onApproveDecision && (
            <button
              type="button"
              className="mt-4 w-full rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:bg-emerald-600"
              disabled={approved}
              onClick={() => onApproveDecision(trace.decisionBlockId)}
            >
              {approved ? '승인 완료' : '현재 선택안 유지하고 승인'}
            </button>
          )}
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold text-amber-700">
            {trace.conflicts.length ? '충돌안 적용 시' : '대안 적용 시'}
          </div>
          <p className="text-sm leading-7 text-slate-800">{comparison.title}</p>
          <p className="mt-2 text-xs leading-6 text-slate-500">{comparison.description}</p>
          {comparison.optionId && onApplyDecisionOption && (
            <button
              type="button"
              className="mt-4 w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
              onClick={() => onApplyDecisionOption(trace.decisionBlockId, comparison.optionId!)}
            >
              이 문장으로 변경하고 승인
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function DecisionPanel({
  selectedSection,
  analysisRunId,
  localWorkspaceId,
  sharedWorkspaceId,
  sharedSnapshotVersion,
  ownerShareAccess,
  approvedBlockIds,
  reviewRequiredBlockIds,
  onApplyDecisionOption,
  onApproveDecision,
}: DecisionPanelProps) {
  const traces = selectedSection.decisionTraces?.length
    ? selectedSection.decisionTraces
    : [getDecisionTrace(selectedSection)];
  const [activeBlockIdBySection, setActiveBlockIdBySection] = useState<Record<number, string>>({});
  const [focusMode, setFocusMode] = useState(false);
  const trace = traces.find(
    (candidate) => candidate.decisionBlockId === activeBlockIdBySection[selectedSection.number],
  ) ?? traces[0];
  const localParticipationScope: ParticipationStateScope = `local:${localWorkspaceId ?? 'pending'}`;
  const clusterStorageScope: OpinionClusterStateScope = sharedWorkspaceId
    ? `shared:${sharedWorkspaceId}:${sharedSnapshotVersion ?? 1}`
    : `local:${localWorkspaceId ?? 'pending'}`;
  const [anonymousClientId] = useState(() => getAnonymousClientId());
  const [participationState, setParticipationState] = useState<ParticipationState>(() =>
    sharedWorkspaceId
      ? createEmptyParticipationState(analysisRunId)
      : loadParticipationState(analysisRunId, localParticipationScope),
  );
  const [sharedParticipationByBlock, setSharedParticipationByBlock] =
    useState<Record<string, SharedParticipation>>({});
  const [sharedPendingAction, setSharedPendingAction] = useState<SharedPendingAction | null>(null);
  const [sharedActionError, setSharedActionError] = useState<SharedActionErrorState | null>(null);
  const [ownerSharedFeedbackState, setOwnerSharedFeedbackState] = useState<OwnerSharedFeedbackState | null>(null);
  const sharedParticipation = sharedParticipationByBlock[trace.decisionBlockId] ?? null;
  const ownerFeedbackInSync = Boolean(
    !sharedWorkspaceId &&
    ownerShareAccess &&
    ownerShareAccess.sharedAnalysisRunId === analysisRunId,
  );
  const ownerFeedbackSourceKey = ownerFeedbackInSync && ownerShareAccess
    ? `${ownerShareAccess.workspaceId}:${ownerShareAccess.snapshotVersion}:${trace.decisionBlockId}`
    : null;
  const currentOwnerFeedbackState = ownerFeedbackSourceKey &&
    ownerSharedFeedbackState?.sourceKey === ownerFeedbackSourceKey
    ? ownerSharedFeedbackState
    : null;
  const ownerFeedbackLoading = Boolean(
    ownerFeedbackSourceKey && ownerSharedFeedbackState?.sourceKey !== ownerFeedbackSourceKey,
  );

  const applySharedParticipation = useCallback((decisionBlockId: string, participation: SharedParticipation) => {
    setSharedActionError(null);
    setSharedParticipationByBlock((current) => ({
      ...current,
      [decisionBlockId]: participation,
    }));
  }, []);
  const [clusterResults, setClusterResults] = useState(() =>
    loadOpinionClusterState(analysisRunId, clusterStorageScope));
  const [clusterLoadingByBlock, setClusterLoadingByBlock] = useState<Record<string, boolean>>({});
  const [draftOpinions, setDraftOpinions] = useState<Record<string, string>>({});

  const decisionVote = sharedWorkspaceId
    ? toSharedDecisionVote(sharedParticipation, anonymousClientId)
    : participationState.votesByDecisionBlock[trace.decisionBlockId];
  const decisionOpinions = sharedWorkspaceId
    ? sharedParticipation?.opinions ?? []
    : participationState.opinionsByDecisionBlock[trace.decisionBlockId] ?? trace.opinions;
  const decisionClusterResult = clusterResults.resultsByDecisionBlock[trace.decisionBlockId];
  const draftOpinion = draftOpinions[trace.decisionBlockId] ?? '';
  const currentBlockError = sharedActionError?.decisionBlockId === trace.decisionBlockId
    ? sharedActionError
    : null;
  const sharedVoteErrorMessage =
    currentBlockError && currentBlockError.action !== 'opinion' ? currentBlockError.message : null;
  const sharedOpinionErrorMessage =
    currentBlockError?.action === 'opinion' ? currentBlockError.message : undefined;
  const ownerFeedbackParticipation = currentOwnerFeedbackState?.status === 'loaded'
    ? currentOwnerFeedbackState.participation
    : null;
  const ownerFeedbackErrorMessage = currentOwnerFeedbackState?.status === 'error'
    ? currentOwnerFeedbackState.message
    : undefined;
  const approved = approvedBlockIds.includes(trace.decisionBlockId);
  const reviewRequired = reviewRequiredBlockIds.includes(trace.decisionBlockId);

  useEffect(() => {
    // 공유 모드에서는 서버가 단일 소스이므로 로컬 참여 상태를 건드리지 않는다.
    if (sharedWorkspaceId) {
      return;
    }

    saveParticipationState(participationState, localParticipationScope);
  }, [localParticipationScope, sharedWorkspaceId, participationState]);

  useEffect(() => {
    saveOpinionClusterState(clusterResults, clusterStorageScope);
  }, [clusterResults, clusterStorageScope]);

  useEffect(() => {
    if (!focusMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFocusMode(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusMode]);

  useEffect(() => {
    if (!sharedWorkspaceId || !sharedSnapshotVersion) {
      return;
    }

    let cancelled = false;
    const decisionBlockId = trace.decisionBlockId;
    const snapshotVersion = sharedSnapshotVersion;

    void (async () => {
      try {
        const participation = await fetchBlockParticipation(
          sharedWorkspaceId,
          decisionBlockId,
          anonymousClientId,
          snapshotVersion,
        );

        if (!cancelled && participation) {
          applySharedParticipation(decisionBlockId, participation);
        }
      } catch (error) {
        if (!cancelled) {
          setSharedActionError({
            action: 'load',
            decisionBlockId,
            message: getSharedParticipationErrorMessage(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sharedWorkspaceId, sharedSnapshotVersion, trace.decisionBlockId, anonymousClientId, applySharedParticipation]);

  useEffect(() => {
    if (!ownerShareAccess || !ownerFeedbackSourceKey) {
      return;
    }

    let cancelled = false;
    const decisionBlockId = trace.decisionBlockId;
    const sourceKey = ownerFeedbackSourceKey;
    const snapshotVersion = ownerShareAccess.snapshotVersion;
    const workspaceId = ownerShareAccess.workspaceId;

    void (async () => {
      try {
        const participation = await fetchBlockParticipation(
          workspaceId,
          decisionBlockId,
          undefined,
          snapshotVersion,
        );

        if (!cancelled) {
          setOwnerSharedFeedbackState({
            sourceKey,
            status: 'loaded',
            participation,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setOwnerSharedFeedbackState({
            sourceKey,
            status: 'error',
            participation: null,
            message: getSharedParticipationErrorMessage(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ownerFeedbackSourceKey, ownerShareAccess, trace.decisionBlockId]);

  const handleVote = (optionId: string) => {
    if (sharedWorkspaceId) {
      if (sharedPendingAction) {
        return;
      }

      if (!sharedSnapshotVersion) {
        setSharedActionError({
          action: 'vote',
          decisionBlockId: trace.decisionBlockId,
          message: '공유본 버전을 확인하지 못했습니다. 페이지를 새로고침 해주세요.',
        });
        return;
      }

      const decisionBlockId = trace.decisionBlockId;
      const snapshotVersion = sharedSnapshotVersion;

      setSharedPendingAction('vote');
      setSharedActionError(null);
      void (async () => {
        try {
          const participation = await submitSharedVote(
            sharedWorkspaceId,
            snapshotVersion,
            decisionBlockId,
            optionId,
            anonymousClientId,
          );

          applySharedParticipation(decisionBlockId, participation);
        } catch (error) {
          setSharedActionError({
            action: 'vote',
            decisionBlockId,
            message: getSharedParticipationErrorMessage(error),
          });
        } finally {
          setSharedPendingAction(null);
        }
      })();

      return;
    }

    setParticipationState((current) => {
      const previous = current.votesByDecisionBlock[trace.decisionBlockId];
      const nextVote = voteOnOption(trace, previous, optionId, anonymousClientId);

      if (!nextVote || nextVote === previous) {
        return current;
      }

      return {
        ...current,
        analysisRunId,
        votesByDecisionBlock: {
          ...current.votesByDecisionBlock,
          [trace.decisionBlockId]: nextVote,
        },
      };
    });
  };

  const handleOpinionSubmit = () => {
    const content = draftOpinion.trim();

    if (!content) {
      return;
    }

    const clearDraft = () => {
      setDraftOpinions((current) => ({
        ...current,
        [trace.decisionBlockId]: '',
      }));
    };

    if (sharedWorkspaceId) {
      if (sharedPendingAction) {
        return;
      }

      if (!sharedSnapshotVersion) {
        setSharedActionError({
          action: 'opinion',
          decisionBlockId: trace.decisionBlockId,
          message: '공유본 버전을 확인하지 못했습니다. 페이지를 새로고침 해주세요.',
        });
        return;
      }

      const decisionBlockId = trace.decisionBlockId;
      const snapshotVersion = sharedSnapshotVersion;

      setSharedPendingAction('opinion');
      setSharedActionError(null);
      void (async () => {
        try {
          const participation = await submitSharedOpinion(
            sharedWorkspaceId,
            snapshotVersion,
            decisionBlockId,
            content,
            anonymousClientId,
          );

          applySharedParticipation(decisionBlockId, participation);
          clearDraft();
        } catch (error) {
          setSharedActionError({
            action: 'opinion',
            decisionBlockId,
            message: getSharedParticipationErrorMessage(error),
          });
        } finally {
          setSharedPendingAction(null);
        }
      })();

      return;
    }

    setParticipationState((current) => ({
      ...current,
      analysisRunId,
      opinionsByDecisionBlock: {
        ...current.opinionsByDecisionBlock,
        [trace.decisionBlockId]: addAnonymousOpinion(
          trace,
          current.opinionsByDecisionBlock[trace.decisionBlockId],
          content,
          anonymousClientId,
        ),
      },
    }));

    clearDraft();
  };

  const handleClusterGenerate = async () => {
    if (decisionOpinions.length === 0) {
      return;
    }

    setClusterLoadingByBlock((current) => ({
      ...current,
      [trace.decisionBlockId]: true,
    }));

    const payload = createOpinionClusteringPayload(trace, decisionOpinions, 'gpt-4.1');
    const [result] = await Promise.all([
      generateOpinionClusters(payload),
      waitForLoadingTime(700),
    ]);

    setClusterResults((current) => ({
      ...current,
      analysisRunId,
      resultsByDecisionBlock: {
        ...current.resultsByDecisionBlock,
        [trace.decisionBlockId]: result,
      },
    }));
    setClusterLoadingByBlock((current) => ({
      ...current,
      [trace.decisionBlockId]: false,
    }));
  };

  return (
    <>
      {focusMode && (
        <button
          type="button"
          aria-label="배경을 눌러 집중 비교 닫기"
          className="fixed inset-0 z-[60] cursor-default bg-slate-950/45 backdrop-blur-sm"
          onClick={() => setFocusMode(false)}
        />
      )}
      <div
        data-testid="decision-panel"
        data-focus-mode={focusMode ? 'true' : 'false'}
        role={focusMode ? 'dialog' : undefined}
        aria-modal={focusMode ? true : undefined}
        aria-label={focusMode ? '결정 집중 비교' : undefined}
        className={focusMode
          ? 'fixed inset-3 z-[70] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl sm:inset-6'
          : 'w-full flex-shrink-0 border-t border-slate-200 bg-white xl:h-full xl:min-h-0 xl:w-96 xl:overflow-y-auto xl:border-l xl:border-t-0'}
      >
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/96 p-6 backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
            <GitCompare className="h-4 w-4" />
            결정 근거
          </div>
          <button
            type="button"
            data-testid="decision-focus-toggle"
            className="focus-ring grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            aria-label={focusMode ? '집중 비교 닫기' : '집중 비교 열기'}
            title={focusMode ? '집중 비교 닫기' : '집중 비교 열기'}
            onClick={() => setFocusMode((current) => !current)}
          >
            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        <h2 className="text-base font-semibold text-slate-950">선택 과정</h2>
        <div className="mt-1 text-xs text-slate-500">
          현재 선택: {trace.sectionNumber}. {trace.sectionTitle}
        </div>
        {traces.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {traces.map((candidate, index) => (
              <button
                key={candidate.decisionBlockId}
                type="button"
                aria-pressed={candidate.decisionBlockId === trace.decisionBlockId}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  candidate.decisionBlockId === trace.decisionBlockId
                    ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
                onClick={() => setActiveBlockIdBySection((current) => ({
                  ...current,
                  [selectedSection.number]: candidate.decisionBlockId,
                }))}
              >
                결정 {index + 1} · {candidate.topic}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`space-y-5 p-6 ${focusMode ? 'mx-auto max-w-6xl' : ''}`}>
        {focusMode && (
          <DecisionComparison
            approved={approved}
            onApplyDecisionOption={onApplyDecisionOption}
            onApproveDecision={onApproveDecision}
            trace={trace}
          />
        )}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
          <div className="text-xs text-slate-500 mb-1">섹션</div>
          <div className="text-sm font-semibold text-slate-950 mb-4">{trace.sectionTitle}</div>
          <div className="text-xs text-slate-500 mb-1">검토 주제</div>
          <div className="text-sm font-medium text-slate-900 mb-3">{trace.topic}</div>
          <div className="flex gap-2">
            {trace.badges.map((badge) => (
              <StatusBadge key={badge.label} variant={badge.variant}>
                {badge.label}
              </StatusBadge>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700">
            <CheckCircle2 className="h-4 w-4" />
            현재 선택안
          </div>
          <p className="text-sm text-slate-950 leading-7 mb-3">
            {trace.selectedContent}
          </p>
          <div className="text-xs text-blue-700 mb-1">선택 근거</div>
          <p className="text-xs text-slate-600 leading-6">
            {trace.selectionReason}
          </p>
          <SelectedSources trace={trace} />
          {(reviewRequired || approved) && (
            <div className="mt-4 border-t border-blue-100 pt-4">
              {approved ? (
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  이 결정은 승인되었습니다.
                </div>
              ) : onApproveDecision ? (
                <button
                  type="button"
                  data-testid="approve-decision-button"
                  className="w-full rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                  onClick={() => onApproveDecision(trace.decisionBlockId)}
                >
                  현재 선택안 유지하고 승인
                </button>
              ) : (
                <StatusBadge variant="warning">검토 대기</StatusBadge>
              )}
            </div>
          )}
        </div>

        <AnonymousVotePanel
          trace={trace}
          votes={decisionVote}
          shared={Boolean(sharedWorkspaceId)}
          disabled={sharedPendingAction !== null}
          onVote={handleVote}
        />

        {sharedWorkspaceId && sharedVoteErrorMessage && (
          <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {sharedVoteErrorMessage}
          </div>
        )}

        {!sharedWorkspaceId && ownerShareAccess && (
          ownerFeedbackInSync ? (
            <SharedLinkFeedbackPanel
              errorMessage={ownerFeedbackErrorMessage}
              loading={ownerFeedbackLoading}
              participation={ownerFeedbackParticipation}
              trace={trace}
            />
          ) : (
            <div className="pb-6 border-b border-slate-100">
              <div className="mb-2 text-xs text-gray-500">공유 링크 피드백</div>
              <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                공유 이후 분석이 변경되어 집계를 표시하지 않습니다. 공유를 갱신하세요.
              </div>
            </div>
          )
        )}

        <OpinionClusterPanel
          clusterResult={decisionClusterResult}
          loading={clusterLoadingByBlock[trace.decisionBlockId] ?? false}
          opinionCount={decisionOpinions.length}
          onGenerate={handleClusterGenerate}
        />

        <div className="pb-6 border-b border-slate-100">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <MessageSquare className="h-4 w-4" />
            대안 의견
          </div>
          {trace.alternatives.length > 0 ? (
            <div className="space-y-3">
              {trace.alternatives.map((alternative, index) => (
                <div
                  key={alternative.optionId ?? `${alternative.title}-${index}`}
                  className="pb-3 border-b border-slate-100 last:border-0 last:pb-0"
                >
                  <div className="text-sm font-semibold text-slate-950 mb-1">{alternative.title}</div>
                  <div className="text-xs text-slate-600 mb-2">{alternative.description}</div>
                  <SourceChips opinion={alternative} />
                  <ApplyOptionButton
                    optionId={alternative.optionId}
                    decisionBlockId={trace.decisionBlockId}
                    onApplyDecisionOption={onApplyDecisionOption}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyDecisionState label="주요 대안 의견이 없습니다." />
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-amber-700">
            <ShieldAlert className="h-4 w-4" />
            충돌 의견
          </div>
          {trace.conflicts.length > 0 ? (
            <div className="space-y-3">
              {trace.conflicts.map((conflict, index) => (
                <div
                  key={conflict.optionId ?? `${conflict.title}-${index}`}
                  className="pb-3 border-b border-slate-100 last:border-0 last:pb-0"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="text-sm font-semibold text-slate-950">{conflict.title}</div>
                    {conflict.severity && (
                      <StatusBadge variant="warning">
                        {conflict.severity === 'high' ? '높음' : conflict.severity === 'medium' ? '중간' : '낮음'}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mb-2">{conflict.description}</div>
                  <SourceChips opinion={conflict} />
                  <ApplyOptionButton
                    optionId={conflict.optionId}
                    decisionBlockId={trace.decisionBlockId}
                    onApplyDecisionOption={onApplyDecisionOption}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyDecisionState label="충돌 의견이 없습니다." />
          )}
        </div>

        <OpinionPanel
          opinions={decisionOpinions}
          draftOpinion={draftOpinion}
          errorMessage={sharedOpinionErrorMessage}
          submitting={sharedPendingAction === 'opinion'}
          onDraftChange={(value) => setDraftOpinions((current) => ({
            ...current,
            [trace.decisionBlockId]: value,
          }))}
          onSubmit={handleOpinionSubmit}
        />
      </div>
      </div>
    </>
  );
}
