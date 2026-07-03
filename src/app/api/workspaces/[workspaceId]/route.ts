import { NextResponse } from 'next/server';
import { getDb, isDatabaseConfigured } from '@/server/db';
import { isValidWorkspaceId } from '@/server/sharedWorkspace';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const rateLimit = checkRateLimit('workspaces-read', getClientKey(request), RATE_LIMIT);

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

  try {
    const workspace = await getDb().sharedWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, title: true, snapshot: true },
    });

    if (!workspace) {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    return NextResponse.json({
      id: workspace.id,
      title: workspace.title,
      workspace: workspace.snapshot,
    });
  } catch (error) {
    console.error('[workspaces] read failed:', error);

    return NextResponse.json(
      { errors: ['공유 워크스페이스 조회에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
