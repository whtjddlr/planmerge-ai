import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { parseWorkspaceImport } from '@/planmerge/lib/localWorkspace';
import { getDb, isDatabaseConfigured } from '@/server/db';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';
import { hashManageToken } from '@/server/sharedWorkspace';
import { getWorkspacePublicationReadiness } from '@/server/workspacePublication';

const RATE_LIMIT = { limit: 5, windowMs: 60_000 };
const MAX_SNAPSHOT_CHARS = 1_500_000;
const DEFAULT_SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function createManageToken() {
  return randomBytes(32).toString('hex');
}

export async function POST(request: Request) {
  const session = await auth();
  const sessionUserId = session?.user?.id?.trim() || undefined;
  const rateLimit = await checkRateLimit(
    'workspaces-create',
    getClientKey(request, sessionUserId),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['공유 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { errors: ['데이터베이스가 설정되지 않아 공유 기능을 사용할 수 없습니다.'] },
      { status: 503 },
    );
  }

  const rawBody = await request.text();

  if (rawBody.length > MAX_SNAPSHOT_CHARS) {
    return NextResponse.json(
      { errors: ['워크스페이스가 너무 커서 공유할 수 없습니다.'] },
      { status: 413 },
    );
  }

  // 워크스페이스 가져오기와 동일한 검증을 거친 상태만 저장한다.
  const parsed = parseWorkspaceImport(rawBody);

  if (!parsed.valid) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }

  const publicationReadiness = getWorkspacePublicationReadiness(parsed.state);

  if (!publicationReadiness.canShare) {
    return NextResponse.json(
      { errors: [`공유 준비가 완료되지 않았습니다. ${publicationReadiness.detail}`] },
      { status: 409 },
    );
  }

  try {
    const manageToken = createManageToken();
    const expiresAt = new Date(Date.now() + DEFAULT_SHARE_EXPIRY_MS);
    const workspace = await getDb().sharedWorkspace.create({
      data: {
        title: parsed.state.project.title.slice(0, 200) || 'PlanMerge 워크스페이스',
        snapshot: parsed.state as unknown as Prisma.InputJsonValue,
        expiresAt,
        manageTokenHash: hashManageToken(manageToken),
        createdById: sessionUserId,
      },
      select: { id: true, expiresAt: true, snapshotVersion: true },
    });

    return NextResponse.json(
      {
        id: workspace.id,
        manageToken,
        snapshotVersion: workspace.snapshotVersion,
        expiresAt: (workspace.expiresAt ?? expiresAt).toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[workspaces] create failed:', error);

    return NextResponse.json(
      { errors: ['공유 워크스페이스 저장에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
