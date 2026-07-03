import { getDb } from './db';

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidWorkspaceId(value: string) {
  return WORKSPACE_ID_PATTERN.test(value);
}

export function readRequiredString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

export type SharedBlockParticipation = {
  votes: Record<string, number>;
  myOptionId?: string;
  opinions: Array<{
    id: string;
    content: string;
    createdAt: string;
  }>;
};

export async function findSharedWorkspaceId(workspaceId: string) {
  const db = getDb();
  const workspace = await db.sharedWorkspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });

  return workspace?.id;
}

export async function getBlockParticipation(
  workspaceId: string,
  decisionBlockId: string,
  anonymousKey?: string,
): Promise<SharedBlockParticipation> {
  const db = getDb();
  const [voteGroups, myVote, opinionRows] = await Promise.all([
    db.sharedWorkspaceVote.groupBy({
      by: ['optionId'],
      where: { workspaceId, decisionBlockId },
      _count: { _all: true },
    }),
    anonymousKey
      ? db.sharedWorkspaceVote.findUnique({
        where: {
          workspaceId_decisionBlockId_anonymousKey: {
            workspaceId,
            decisionBlockId,
            anonymousKey,
          },
        },
        select: { optionId: true },
      })
      : Promise.resolve(null),
    db.sharedWorkspaceOpinion.findMany({
      where: { workspaceId, decisionBlockId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, content: true, createdAt: true },
    }),
  ]);

  const votes: Record<string, number> = {};

  voteGroups.forEach((group) => {
    votes[group.optionId] = group._count._all;
  });

  return {
    votes,
    myOptionId: myVote?.optionId,
    opinions: opinionRows.map((opinion) => ({
      id: opinion.id,
      content: opinion.content,
      createdAt: opinion.createdAt.toISOString(),
    })),
  };
}
