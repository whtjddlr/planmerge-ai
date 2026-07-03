import { NextResponse } from 'next/server';
import { getDb, isDatabaseConfigured } from '@/server/db';
import {
  findSharedWorkspaceId,
  getBlockParticipation,
  isValidWorkspaceId,
  readRequiredString,
} from '@/server/sharedWorkspace';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const rateLimit = checkRateLimit('workspaces-vote', getClientKey(request), RATE_LIMIT);

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
  const anonymousKey = readRequiredString(record.anonymousKey, 80);

  if (!decisionBlockId || !optionId || !anonymousKey) {
    return NextResponse.json(
      { errors: ['decisionBlockId, optionId, anonymousKey가 모두 필요합니다.'] },
      { status: 400 },
    );
  }

  try {
    if (!(await findSharedWorkspaceId(workspaceId))) {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    // 참여자(anonymousKey)당 블록별 1표. 다시 투표하면 선택만 바뀐다.
    await getDb().sharedWorkspaceVote.upsert({
      where: {
        workspaceId_decisionBlockId_anonymousKey: {
          workspaceId,
          decisionBlockId,
          anonymousKey,
        },
      },
      update: { optionId },
      create: {
        workspaceId,
        decisionBlockId,
        optionId,
        anonymousKey,
      },
    });

    return NextResponse.json(await getBlockParticipation(workspaceId, decisionBlockId, anonymousKey));
  } catch (error) {
    console.error('[workspaces] vote failed:', error);

    return NextResponse.json(
      { errors: ['투표 저장에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
