import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb, isDatabaseConfigured } from '@/server/db';
import { resolveParticipantKey } from '@/server/participantKey';
import {
  getSharedWorkspaceAccessStatus,
  isManageTokenMatch,
  isValidWorkspaceId,
  SHARED_WORKSPACE_UNAVAILABLE_ERROR,
} from '@/server/sharedWorkspace';

const MAX_ANONYMOUS_KEY_LENGTH = 160;

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    draftId: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function parsePatchBody(body: unknown) {
  if (!isRecord(body)) {
    return {
      valid: false as const,
      errors: ['요청 본문은 객체여야 합니다.'],
    };
  }

  const status = body.status;

  if (status !== 'imported' && status !== 'dismissed') {
    return {
      valid: false as const,
      errors: ['status는 imported 또는 dismissed여야 합니다.'],
    };
  }

  if (typeof body.anonymousKey === 'string' && body.anonymousKey.trim().length > MAX_ANONYMOUS_KEY_LENGTH) {
    return {
      valid: false as const,
      errors: [`anonymousKey는 ${MAX_ANONYMOUS_KEY_LENGTH}자 이하여야 합니다.`],
    };
  }

  return {
    valid: true as const,
    status,
    anonymousKey: readOptionalString(body.anonymousKey, MAX_ANONYMOUS_KEY_LENGTH),
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { errors: ['데이터베이스가 설정되지 않아 공유 기능을 사용할 수 없습니다.'] },
      { status: 503 },
    );
  }

  const { workspaceId, draftId } = await context.params;
  const session = await auth();

  if (!isValidWorkspaceId(workspaceId)) {
    return NextResponse.json({ errors: ['잘못된 워크스페이스 ID입니다.'] }, { status: 400 });
  }

  if (!isValidWorkspaceId(draftId)) {
    return NextResponse.json({ errors: ['잘못된 초안 ID입니다.'] }, { status: 400 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ['request body must be valid JSON'] }, { status: 400 });
  }

  const parsedBody = parsePatchBody(body);

  if (!parsedBody.valid) {
    return NextResponse.json({ errors: parsedBody.errors }, { status: 400 });
  }

  try {
    const db = getDb();
    const draft = await db.sharedWorkspaceDraft.findFirst({
      where: { id: draftId, workspaceId },
      select: {
        id: true,
        anonymousKey: true,
        status: true,
        workspace: {
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            manageTokenHash: true,
          },
        },
      },
    });

    if (!draft) {
      return NextResponse.json({ errors: ['공유 초안을 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (getSharedWorkspaceAccessStatus(draft.workspace) === 'expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    const manageToken = request.headers.get('x-manage-token')?.trim();
    const hasManageToken = Boolean(
      manageToken && isManageTokenMatch(manageToken, draft.workspace.manageTokenHash),
    );
    const submitterCanDismiss =
      !manageToken &&
      parsedBody.status === 'dismissed' &&
      draft.status === 'pending' &&
      // 제출 시점과 같은 규칙으로 키를 정해야 비교가 맞는다. 로그인 사용자는 파생 키다.
      resolveParticipantKey({
        userId: session?.user?.id,
        workspaceId,
        clientKey: parsedBody.anonymousKey,
      }) === draft.anonymousKey;

    if (!hasManageToken && !submitterCanDismiss) {
      return NextResponse.json(
        { errors: ['공유 초안 상태를 변경할 권한이 없습니다.'] },
        { status: 401 },
      );
    }

    const updatedDraft = await db.sharedWorkspaceDraft.update({
      where: { id: draft.id },
      data: { status: parsedBody.status },
      select: { id: true, status: true },
    });

    return NextResponse.json(updatedDraft);
  } catch (error) {
    console.error('[workspaces] shared draft status update failed:', error);

    return NextResponse.json(
      { errors: ['공유 초안 상태 변경에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
