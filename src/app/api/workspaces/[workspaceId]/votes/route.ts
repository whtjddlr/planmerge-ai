import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb, isDatabaseConfigured } from '@/server/db';
import {
  getBlockParticipation,
  getSharedDecisionBlockTarget,
  isValidWorkspaceId,
  readRequiredString,
  SHARED_WORKSPACE_UNAVAILABLE_ERROR,
} from '@/server/sharedWorkspace';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';
import { resolveParticipantKey } from '@/server/participantKey';

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const SHARED_WORKSPACE_REFRESH_ERROR = '공유본이 갱신되었습니다. 페이지를 새로고침 해주세요.';

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspaces-vote',
    getClientKey(request, session?.user?.id),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['투표 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { errors: ['데이터베이스가 설정되지 않아 공유 기능을 사용할 수 없습니다.'] },
      { status: 503 },
    );
  }

  const { workspaceId } = await context.params;

  if (!isValidWorkspaceId(workspaceId)) {
    return NextResponse.json({ errors: ['잘못된 워크스페이스 ID입니다.'] }, { status: 400 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ['request body must be valid JSON'] }, { status: 400 });
  }

  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  const decisionBlockId = readRequiredString(record.decisionBlockId, 160);
  const optionId = readRequiredString(record.optionId, 200);
  const clientAnonymousKey = readRequiredString(record.anonymousKey, 80);
  // 로그인 사용자는 계정에서 파생한 키로 승격한다 — HMAC(ANON_KEY_SECRET, userId + workspaceId).
  // localStorage를 지워도 계정당 1키다. 게스트는 보낸 키를 그대로 쓴다(설계상 트레이드오프).
  const anonymousKey = clientAnonymousKey
    ? resolveParticipantKey({ userId: session?.user?.id, workspaceId, clientKey: clientAnonymousKey })
    : undefined;
  const snapshotVersion = readSnapshotVersion(record.snapshotVersion);

  if (!decisionBlockId || !optionId || !anonymousKey || !snapshotVersion) {
    return NextResponse.json(
      { errors: ['decisionBlockId, optionId, anonymousKey, snapshotVersion이 모두 필요합니다.'] },
      { status: 400 },
    );
  }

  try {
    const target = await getSharedDecisionBlockTarget(workspaceId, decisionBlockId, snapshotVersion);

    if (target.status === 'workspace_not_found') {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (target.status === 'workspace_expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    if (target.status === 'version_mismatch') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_REFRESH_ERROR] }, { status: 409 });
    }

    if (target.status !== 'found' || !target.votableOptionIds.includes(optionId)) {
      return NextResponse.json({ errors: ['존재하지 않는 결정 블록 또는 선택지입니다.'] }, { status: 400 });
    }

    // 참여자(anonymousKey)당 블록별 1표. 다시 투표하면 선택만 바뀐다.
    await getDb().sharedWorkspaceVote.upsert({
      where: {
        workspaceId_snapshotVersion_decisionBlockId_anonymousKey: {
          workspaceId,
          snapshotVersion,
          decisionBlockId,
          anonymousKey,
        },
      },
      update: { optionId },
      create: {
        workspaceId,
        snapshotVersion,
        decisionBlockId,
        optionId,
        anonymousKey,
      },
    });

    return NextResponse.json(await getBlockParticipation(workspaceId, snapshotVersion, decisionBlockId, anonymousKey));
  } catch (error) {
    console.error('[workspaces] vote failed:', error);

    return NextResponse.json(
      { errors: ['투표 저장에 실패했습니다.'] },
      { status: 500 },
    );
  }
}

function readSnapshotVersion(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
