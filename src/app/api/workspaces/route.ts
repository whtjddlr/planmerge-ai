import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { parseWorkspaceImport } from '@/planmerge/lib/localWorkspace';
import { getDb, isDatabaseConfigured } from '@/server/db';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

const RATE_LIMIT = { limit: 5, windowMs: 60_000 };
const MAX_SNAPSHOT_CHARS = 1_500_000;

export async function POST(request: Request) {
  const rateLimit = checkRateLimit('workspaces-create', getClientKey(request), RATE_LIMIT);

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

  try {
    const workspace = await getDb().sharedWorkspace.create({
      data: {
        title: parsed.state.project.title.slice(0, 200) || 'PlanMerge 워크스페이스',
        snapshot: parsed.state as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return NextResponse.json({ id: workspace.id }, { status: 201 });
  } catch (error) {
    console.error('[workspaces] create failed:', error);

    return NextResponse.json(
      { errors: ['공유 워크스페이스 저장에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
