import type { AnonymousOpinion, DecisionTrace } from '../data/mergeResult';

const PARTICIPATION_STORAGE_KEY = 'planmerge_decision_participation_v1';

export type VoteGroup = 'selected' | 'alternative' | 'conflict';

export type VoteOption = {
  id: string;
  label: string;
  description: string;
  group: VoteGroup;
};

export type DecisionVote = {
  voterKey: string;
  selectedOptionId?: string;
  overrides: Record<string, number>;
};

export type ParticipationState = {
  analysisRunId: number;
  votesByDecisionBlock: Record<string, DecisionVote>;
  opinionsByDecisionBlock: Record<string, AnonymousOpinion[]>;
};

export const emptyParticipationState: ParticipationState = {
  analysisRunId: 0,
  votesByDecisionBlock: {},
  opinionsByDecisionBlock: {},
};

export function createEmptyParticipationState(analysisRunId: number): ParticipationState {
  return {
    analysisRunId,
    votesByDecisionBlock: {},
    opinionsByDecisionBlock: {},
  };
}

// 인덱스 기반 ID는 "선택안으로 적용" 후 옵션이 재배열되면 투표가 다른 내용의
// 옵션으로 옮겨 붙는다. 분석 결과의 실제 옵션 ID를 우선 사용한다.
export function buildVoteOptions(trace: DecisionTrace): VoteOption[] {
  return [
    {
      id: trace.selectedOptionId ?? `${trace.decisionBlockId}:selected`,
      label: 'AI 선택안',
      description: trace.selectedContent,
      group: 'selected',
    },
    ...trace.alternatives.map((alternative, index) => ({
      id: alternative.optionId ?? `${trace.decisionBlockId}:alternative:${index}`,
      label: alternative.title,
      description: alternative.description,
      group: 'alternative' as const,
    })),
    ...trace.conflicts.map((conflict, index) => ({
      id: conflict.optionId ?? `${trace.decisionBlockId}:conflict:${index}`,
      label: conflict.title,
      description: conflict.description,
      group: 'conflict' as const,
    })),
  ];
}

export function groupLabel(group: VoteGroup) {
  if (group === 'selected') return '선택안';
  if (group === 'alternative') return '대안';
  return '충돌';
}

// 실제 투표 수만 집계한다. 가공의 기본 표를 깔면 집계가 허구가 된다.
export function getVoteCount(option: VoteOption, decisionVote?: DecisionVote) {
  return decisionVote?.overrides[option.id] ?? 0;
}

export function getTotalVotes(options: VoteOption[], decisionVote?: DecisionVote) {
  return options.reduce((sum, option) => sum + getVoteCount(option, decisionVote), 0);
}

export function voteOnOption(trace: DecisionTrace, currentVote: DecisionVote | undefined, optionId: string, voterKey: string) {
  const options = buildVoteOptions(trace);
  const validOption = options.some((option) => option.id === optionId);

  if (!validOption) {
    return currentVote;
  }

  const overrides: Record<string, number> = {};

  for (const option of options) {
    overrides[option.id] = getVoteCount(option, currentVote);
  }

  if (currentVote?.selectedOptionId === optionId) {
    return currentVote;
  }

  if (currentVote?.selectedOptionId) {
    overrides[currentVote.selectedOptionId] = Math.max(0, overrides[currentVote.selectedOptionId] - 1);
  }

  overrides[optionId] += 1;

  return {
    voterKey,
    selectedOptionId: optionId,
    overrides,
  };
}

export function addAnonymousOpinion(
  trace: DecisionTrace,
  currentOpinions: AnonymousOpinion[] | undefined,
  content: string,
  anonymousKey: string,
) {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return currentOpinions ?? trace.opinions;
  }

  const nextOpinion: AnonymousOpinion = {
    id: `${trace.decisionBlockId}:opinion:${Date.now()}`,
    anonymousKey,
    content: trimmedContent,
    createdAtLabel: '방금',
  };

  return [nextOpinion, ...(currentOpinions ?? trace.opinions)];
}

export function loadParticipationState(analysisRunId = 0) {
  if (typeof window === 'undefined') {
    return createEmptyParticipationState(analysisRunId);
  }

  const rawState = window.localStorage.getItem(PARTICIPATION_STORAGE_KEY);

  if (!rawState) {
    return createEmptyParticipationState(analysisRunId);
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<ParticipationState>;
    const storedRunId = parsedState.analysisRunId ?? 0;

    if (storedRunId !== analysisRunId) {
      return createEmptyParticipationState(analysisRunId);
    }

    return {
      analysisRunId: storedRunId,
      votesByDecisionBlock: parsedState.votesByDecisionBlock ?? {},
      opinionsByDecisionBlock: parsedState.opinionsByDecisionBlock ?? {},
    };
  } catch {
    return createEmptyParticipationState(analysisRunId);
  }
}

export function saveParticipationState(state: ParticipationState) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PARTICIPATION_STORAGE_KEY, JSON.stringify(state));
}
