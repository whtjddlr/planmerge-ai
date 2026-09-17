import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isDatabaseConfigured } from '@/server/db';
import {
  findSharedWorkspaceAccessDetails,
  getBlockParticipation,
  isValidWorkspaceId,
  readRequiredString,
  SHARED_WORKSPACE_UNAVAILABLE_ERROR,
} from '@/server/sharedWorkspace';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';
import { resolveParticipantKey } from '@/server/participantKey';

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspaces-participation',
    getClientKey(request, session?.user?.id),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
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

  const url = new URL(request.url);
  const decisionBlockId = readRequiredString(url.searchParams.get('decisionBlockId'), 160);
  const clientAnonymousKey = readRequiredString(url.searchParams.get('anonymousKey'), 80);
  // 로그인 사용자는 계정에서 파생한 키로 승격한다 — HMAC(ANON_KEY_SECRET, userId + workspaceId).
  // localStorage를 지워도 계정당 1키다. 게스트는 보낸 키를 그대로 쓴다(설계상 트레이드오프).
  const anonymousKey = clientAnonymousKey
    ? resolveParticipantKey({ userId: session?.user?.id, workspaceId, clientKey: clientAnonymousKey })
    : undefined;
  const requestedVersion = readRequestedVersion(url.searchParams.get('version'));

  if (!decisionBlockId) {
    return NextResponse.json({ errors: ['decisionBlockId가 필요합니다.'] }, { status: 400 });
  }

  if (requestedVersion === 'invalid') {
    return NextResponse.json({ errors: ['version은 1 이상의 정수여야 합니다.'] }, { status: 400 });
  }

  try {
    const accessDetails = await findSharedWorkspaceAccessDetails(workspaceId);

    if (accessDetails.status === 'not_found') {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (accessDetails.status === 'expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    const snapshotVersion = requestedVersion ?? accessDetails.snapshotVersion;

    if (snapshotVersion > accessDetails.snapshotVersion) {
      return NextResponse.json(
        { errors: ['현재 공유본보다 큰 version은 조회할 수 없습니다.'] },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await getBlockParticipation(workspaceId, snapshotVersion, decisionBlockId, anonymousKey),
    );
  } catch (error) {
    console.error('[workspaces] participation read failed:', error);

    return NextResponse.json(
      { errors: ['참여 현황 조회에 실패했습니다.'] },
      { status: 500 },
    );
  }
}

function readRequestedVersion(value: string | null) {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return 'invalid' as const;
  }

  const version = Number(trimmed);

  return Number.isSafeInteger(version) && version > 0 ? version : 'invalid';
}
