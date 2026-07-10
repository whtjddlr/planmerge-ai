import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { parseWorkspaceImport } from '@/planmerge/lib/localWorkspace';
import { getDb, isDatabaseConfigured } from '@/server/db';
import {
  canManageSharedWorkspace,
  getSharedWorkspaceAccessStatus,
  isValidWorkspaceId,
  SHARED_WORKSPACE_UNAVAILABLE_ERROR,
} from '@/server/sharedWorkspace';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';
import { getWorkspacePublicationReadiness } from '@/server/workspacePublication';

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const UPDATE_RATE_LIMIT = { limit: 5, windowMs: 60_000 };
const REVOKE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const MAX_SNAPSHOT_CHARS = 1_500_000;
const DEFAULT_SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspaces-read',
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

  try {
    const workspace = await getDb().sharedWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, title: true, snapshot: true, snapshotVersion: true, expiresAt: true, revokedAt: true },
    });

    if (!workspace) {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (getSharedWorkspaceAccessStatus(workspace) === 'expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    return NextResponse.json({
      id: workspace.id,
      title: workspace.title,
      snapshotVersion: workspace.snapshotVersion,
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

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspaces-update',
    getClientKey(request, session?.user?.id),
    UPDATE_RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['공유 링크 갱신 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
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

  const rawBody = await request.text();

  if (rawBody.length > MAX_SNAPSHOT_CHARS) {
    return NextResponse.json(
      { errors: ['워크스페이스가 너무 커서 공유할 수 없습니다.'] },
      { status: 413 },
    );
  }

  const parsed = parseWorkspaceImport(rawBody);

  if (!parsed.valid) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }

  try {
    const workspace = await getDb().sharedWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, expiresAt: true, revokedAt: true, manageTokenHash: true, createdById: true },
    });

    if (!workspace) {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (getSharedWorkspaceAccessStatus(workspace) === 'expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    const manageToken = request.headers.get('x-manage-token')?.trim();

    if (!canManageSharedWorkspace({ workspace, session, manageToken })) {
      return NextResponse.json(
        { errors: ['공유 링크를 갱신할 권한이 없습니다.'] },
        { status: 401 },
      );
    }

    const publicationReadiness = getWorkspacePublicationReadiness(parsed.state);

    if (!publicationReadiness.canShare) {
      return NextResponse.json(
        { errors: [`공유 준비가 완료되지 않았습니다. ${publicationReadiness.detail}`] },
        { status: 409 },
      );
    }

    const expiresAt = new Date(Date.now() + DEFAULT_SHARE_EXPIRY_MS);
    const updated = await getDb().sharedWorkspace.update({
      where: { id: workspaceId },
      data: {
        title: parsed.state.project.title.slice(0, 200) || 'PlanMerge 워크스페이스',
        snapshot: parsed.state as unknown as Prisma.InputJsonValue,
        snapshotVersion: { increment: 1 },
        expiresAt,
      },
      select: { id: true, snapshotVersion: true, expiresAt: true },
    });

    return NextResponse.json({
      id: updated.id,
      snapshotVersion: updated.snapshotVersion,
      expiresAt: (updated.expiresAt ?? expiresAt).toISOString(),
    });
  } catch (error) {
    console.error('[workspaces] update failed:', error);

    return NextResponse.json(
      { errors: ['공유 링크 갱신에 실패했습니다.'] },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspace-revoke',
    getClientKey(request, session?.user?.id),
    REVOKE_RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['공유 링크 회수 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
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
      select: { id: true, expiresAt: true, revokedAt: true, manageTokenHash: true, createdById: true },
    });

    if (!workspace) {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (getSharedWorkspaceAccessStatus(workspace) === 'expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    const manageToken = request.headers.get('x-manage-token')?.trim();

    if (!canManageSharedWorkspace({ workspace, session, manageToken })) {
      return NextResponse.json(
        { errors: ['공유 링크를 회수할 권한이 없습니다.'] },
        { status: 401 },
      );
    }

    await getDb().sharedWorkspace.update({
      where: { id: workspaceId },
      data: { revokedAt: new Date() },
      select: { id: true },
    });

    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error('[workspaces] revoke failed:', error);

    return NextResponse.json(
      { errors: ['공유 링크 회수에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
