import { useEffect, useMemo, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { getDecisionTrace } from '../data/mergeResult';
import type { AnonymousOpinion, DecisionOpinion, DecisionTrace, DocumentSectionData } from '../data/mergeResult';
import { getAnonymousClientId } from '../lib/anonymousClient';
import {
  addAnonymousOpinion,
  buildVoteOptions,
  getTotalVotes,
  getVoteCount,
  groupLabel,
  loadParticipationState,
  saveParticipationState,
  voteOnOption,
} from '../lib/decisionParticipation';
import type { DecisionVote, ParticipationState } from '../lib/decisionParticipation';
import {
  createOpinionClusteringPayload,
  generateOpinionClusters,
  loadOpinionClusterState,
  saveOpinionClusterState,
} from '../lib/ai/opinionClustering';
import type { OpinionClusteringResult } from '../lib/ai/opinionClustering';
import {
  fetchBlockParticipation,
  submitSharedOpinion,
  submitSharedVote,
} from '../lib/sharedWorkspaceClient';
import type { SharedParticipation } from '../lib/sharedWorkspaceClient';

type DecisionPanelProps = {
  selectedSection: DocumentSectionData;
  analysisRunId: number;
  sharedWorkspaceId?: string | null;
  onApplyDecisionOption?: (decisionBlockId: string, optionId: string) => void;
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
  onVote,
}: {
  trace: DecisionTrace;
  votes?: DecisionVote;
  shared?: boolean;
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
              }`}
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
  onDraftChange,
  onSubmit,
}: {
  opinions: AnonymousOpinion[];
  draftOpinion: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = draftOpinion.trim().length > 0;

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
            canSubmit
              ? 'bg-gray-900 text-white hover:bg-gray-800'
              : 'cursor-not-allowed bg-gray-100 text-gray-400'
          }`}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          익명 의견 등록
        </button>
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
      className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
      onClick={() => onApplyDecisionOption(decisionBlockId, optionId)}
    >
      선택안으로 적용
    </button>
  );
}

export function DecisionPanel({
  selectedSection,
  analysisRunId,
  sharedWorkspaceId,
  onApplyDecisionOption,
}: DecisionPanelProps) {
  const trace = getDecisionTrace(selectedSection);
  const [anonymousClientId] = useState(() => getAnonymousClientId());
  const [participationState, setParticipationState] = useState<ParticipationState>(() =>
    loadParticipationState(analysisRunId),
  );
  const [sharedParticipationByBlock, setSharedParticipationByBlock] =
    useState<Record<string, SharedParticipation>>({});
  const [sharedActionPending, setSharedActionPending] = useState(false);
  const sharedParticipation = sharedParticipationByBlock[trace.decisionBlockId] ?? null;

  const applySharedParticipation = (decisionBlockId: string, participation: SharedParticipation) => {
    setSharedParticipationByBlock((current) => ({
      ...current,
      [decisionBlockId]: participation,
    }));
  };
  const [clusterResults, setClusterResults] = useState(() => loadOpinionClusterState(analysisRunId));
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

  useEffect(() => {
    // 공유 모드에서는 서버가 단일 소스이므로 로컬 참여 상태를 건드리지 않는다.
    if (sharedWorkspaceId) {
      return;
    }

    saveParticipationState(participationState);
  }, [sharedWorkspaceId, participationState]);

  useEffect(() => {
    saveOpinionClusterState(clusterResults);
  }, [clusterResults]);

  useEffect(() => {
    if (!sharedWorkspaceId) {
      return;
    }

    let cancelled = false;
    const decisionBlockId = trace.decisionBlockId;

    void (async () => {
      const participation = await fetchBlockParticipation(
        sharedWorkspaceId,
        decisionBlockId,
        anonymousClientId,
      );

      if (!cancelled && participation) {
        setSharedParticipationByBlock((current) => ({
          ...current,
          [decisionBlockId]: participation,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sharedWorkspaceId, trace.decisionBlockId, anonymousClientId]);

  const handleVote = (optionId: string) => {
    if (sharedWorkspaceId) {
      if (sharedActionPending) {
        return;
      }

      setSharedActionPending(true);
      void (async () => {
        const participation = await submitSharedVote(
          sharedWorkspaceId,
          trace.decisionBlockId,
          optionId,
          anonymousClientId,
        );

        if (participation) {
          applySharedParticipation(trace.decisionBlockId, participation);
        }

        setSharedActionPending(false);
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
      if (sharedActionPending) {
        return;
      }

      setSharedActionPending(true);
      void (async () => {
        const participation = await submitSharedOpinion(
          sharedWorkspaceId,
          trace.decisionBlockId,
          content,
          anonymousClientId,
        );

        if (participation) {
          applySharedParticipation(trace.decisionBlockId, participation);
          clearDraft();
        }

        setSharedActionPending(false);
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
    <div className="w-full flex-shrink-0 border-t border-gray-200 bg-white xl:h-full xl:min-h-0 xl:w-96 xl:overflow-y-auto xl:border-l xl:border-t-0">
      <div className="p-6 border-b border-gray-100 sticky top-0 bg-white">
        <h2 className="text-base text-gray-900">선택 과정</h2>
        <div className="mt-1 text-xs text-gray-500">
          현재 선택: {trace.sectionNumber}. {trace.sectionTitle}
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="pb-6 border-b border-gray-100">
          <div className="text-xs text-gray-500 mb-1">섹션</div>
          <div className="text-sm text-gray-900 mb-4">{trace.sectionTitle}</div>
          <div className="text-xs text-gray-500 mb-1">토픽</div>
          <div className="text-sm text-gray-900 mb-3">{trace.topic}</div>
          <div className="flex gap-2">
            {trace.badges.map((badge) => (
              <StatusBadge key={badge.label} variant={badge.variant}>
                {badge.label}
              </StatusBadge>
            ))}
          </div>
        </div>

        <div className="pb-6 border-b border-gray-100">
          <div className="text-xs text-gray-500 mb-2">선택 내용</div>
          <p className="text-sm text-gray-900 leading-relaxed mb-3">
            {trace.selectedContent}
          </p>
          <div className="text-xs text-gray-500 mb-1">선택 근거</div>
          <p className="text-xs text-gray-600 leading-relaxed">
            {trace.selectionReason}
          </p>
          <SelectedSources trace={trace} />
        </div>

        <AnonymousVotePanel
          trace={trace}
          votes={decisionVote}
          shared={Boolean(sharedWorkspaceId)}
          onVote={handleVote}
        />

        <OpinionClusterPanel
          clusterResult={decisionClusterResult}
          loading={clusterLoadingByBlock[trace.decisionBlockId] ?? false}
          opinionCount={decisionOpinions.length}
          onGenerate={handleClusterGenerate}
        />

        <div className="pb-6 border-b border-gray-100">
          <div className="text-xs text-gray-500 mb-3">다른 의견</div>
          {trace.alternatives.length > 0 ? (
            <div className="space-y-3">
              {trace.alternatives.map((alternative) => (
                <div key={alternative.title} className="pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="text-sm text-gray-900 mb-1">{alternative.title}</div>
                  <div className="text-xs text-gray-600 mb-2">{alternative.description}</div>
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
          <div className="text-xs text-gray-500 mb-3">충돌 의견</div>
          {trace.conflicts.length > 0 ? (
            <div className="space-y-3">
              {trace.conflicts.map((conflict) => (
                <div key={conflict.title} className="pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="text-sm text-gray-900">{conflict.title}</div>
                    {conflict.severity && (
                      <StatusBadge variant="warning">
                        {conflict.severity === 'high' ? '높음' : conflict.severity === 'medium' ? '중간' : '낮음'}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 mb-2">{conflict.description}</div>
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
          onDraftChange={(value) => setDraftOpinions((current) => ({
            ...current,
            [trace.decisionBlockId]: value,
          }))}
          onSubmit={handleOpinionSubmit}
        />
      </div>
    </div>
  );
}
