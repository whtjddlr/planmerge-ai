import type { AnonymousOpinion } from '../data/mergeResult';
import type { LocalWorkspaceState } from './localWorkspace';

export type SharedParticipation = {
  votes: Record<string, number>;
  myOptionId?: string;
  opinions: AnonymousOpinion[];
};

type ParticipationResponse = {
  votes?: Record<string, number>;
  myOptionId?: string | null;
  opinions?: Array<{
    id: string;
    content: string;
    createdAt: string;
  }>;
};

function formatCreatedAtLabel(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
}

function toParticipation(data: ParticipationResponse): SharedParticipation {
  return {
    votes: data.votes ?? {},
    myOptionId: data.myOptionId ?? undefined,
    opinions: (data.opinions ?? []).map((opinion) => ({
      id: opinion.id,
      content: opinion.content,
      createdAtLabel: formatCreatedAtLabel(opinion.createdAt),
    })),
  };
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const data = await response.json() as { errors?: string[] };

    return data.errors?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function createSharedWorkspace(exportJson: string): Promise<{ id: string }> {
  const response = await fetch('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: exportJson,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '공유 링크 생성에 실패했습니다.'));
  }

  const data = await response.json() as { id?: string };

  if (!data.id) {
    throw new Error('공유 링크 생성 응답이 올바르지 않습니다.');
  }

  return { id: data.id };
}

export async function fetchSharedWorkspace(workspaceId: string): Promise<LocalWorkspaceState | null> {
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { workspace?: LocalWorkspaceState };

    return data.workspace ?? null;
  } catch {
    return null;
  }
}

export async function fetchBlockParticipation(
  workspaceId: string,
  decisionBlockId: string,
  anonymousKey: string,
): Promise<SharedParticipation | null> {
  try {
    const query = new URLSearchParams({ decisionBlockId, anonymousKey });
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/participation?${query.toString()}`,
    );

    if (!response.ok) {
      return null;
    }

    return toParticipation(await response.json() as ParticipationResponse);
  } catch {
    return null;
  }
}

export async function submitSharedVote(
  workspaceId: string,
  decisionBlockId: string,
  optionId: string,
  anonymousKey: string,
): Promise<SharedParticipation | null> {
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionBlockId, optionId, anonymousKey }),
    });

    if (!response.ok) {
      return null;
    }

    return toParticipation(await response.json() as ParticipationResponse);
  } catch {
    return null;
  }
}

export async function submitSharedOpinion(
  workspaceId: string,
  decisionBlockId: string,
  content: string,
  anonymousKey: string,
): Promise<SharedParticipation | null> {
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/opinions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionBlockId, content, anonymousKey }),
    });

    if (!response.ok) {
      return null;
    }

    return toParticipation(await response.json() as ParticipationResponse);
  } catch {
    return null;
  }
}
