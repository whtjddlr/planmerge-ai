import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb, isDatabaseConfigured } from '@/server/db';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';
import { resolveParticipantKey } from '@/server/participantKey';
import {
  findSharedWorkspaceAccessStatus,
  isValidWorkspaceId,
  SHARED_WORKSPACE_UNAVAILABLE_ERROR,
} from '@/server/sharedWorkspace';

const SUBMIT_RATE_LIMIT = { limit: 5, windowMs: 60_000 };
const READ_RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const PENDING_DRAFT_LIMIT = 50;
const MAX_AUTHOR_NAME_LENGTH = 80;
const MAX_AI_MODEL_LENGTH = 40;
const MAX_TASK_TITLE_LENGTH = 160;
const MAX_RAW_TEXT_LENGTH = 50000;
const MAX_ANONYMOUS_KEY_LENGTH = 160;

const aiModels = new Set(['ChatGPT', 'Claude', 'Gemini', 'Cursor', 'Other']);

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

type SharedDraftSubmitBody = {
  authorName: string;
  aiModel: string;
  taskTitle: string;
  rawText: string;
  anonymousKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  options: {
    required?: boolean;
    maxLength: number;
  },
) {
  const value = record[key];

  if (typeof value !== 'string') {
    if (options.required) {
      errors.push(`${key}은(는) 문자열이어야 합니다.`);
    }

    return '';
  }

  const trimmedValue = value.trim();

  if (options.required && !trimmedValue) {
    errors.push(`${key}은(는) 비어 있을 수 없습니다.`);
  }

  if (trimmedValue.length > options.maxLength) {
    errors.push(`${key}은(는) ${options.maxLength.toLocaleString('ko-KR')}자 이하여야 합니다.`);
  }

  return trimmedValue;
}

function parseSubmitBody(body: unknown) {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return {
      valid: false as const,
      errors: ['요청 본문은 객체여야 합니다.'],
    };
  }

  const aiModel = readString(body, 'aiModel', errors, {
    required: true,
    maxLength: MAX_AI_MODEL_LENGTH,
  });

  if (aiModel && !aiModels.has(aiModel)) {
    errors.push('사용한 AI는 ChatGPT, Claude, Gemini, Cursor, Other 중 하나여야 합니다.');
  }

  const parsed: SharedDraftSubmitBody = {
    authorName: readString(body, 'authorName', errors, {
      required: true,
      maxLength: MAX_AUTHOR_NAME_LENGTH,
    }),
    aiModel,
    taskTitle: readString(body, 'taskTitle', errors, {
      required: true,
      maxLength: MAX_TASK_TITLE_LENGTH,
    }),
    rawText: readString(body, 'rawText', errors, {
      required: true,
      maxLength: MAX_RAW_TEXT_LENGTH,
    }),
    anonymousKey: readString(body, 'anonymousKey', errors, {
      required: true,
      maxLength: MAX_ANONYMOUS_KEY_LENGTH,
    }),
  };

  if (errors.length > 0) {
    return {
      valid: false as const,
      errors,
    };
  }

  return {
    valid: true as const,
    draft: parsed,
  };
}

async function getActiveWorkspaceOrResponse(workspaceId: string) {
  try {
    const accessStatus = await findSharedWorkspaceAccessStatus(workspaceId);

    if (accessStatus === 'not_found') {
      return NextResponse.json({ errors: ['공유 워크스페이스를 찾을 수 없습니다.'] }, { status: 404 });
    }

    if (accessStatus === 'expired_or_revoked') {
      return NextResponse.json({ errors: [SHARED_WORKSPACE_UNAVAILABLE_ERROR] }, { status: 410 });
    }

    return null;
  } catch (error) {
    console.error('[workspaces] shared draft access check failed:', error);

    return NextResponse.json(
      { errors: ['공유 워크스페이스 확인에 실패했습니다.'] },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
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

  const accessErrorResponse = await getActiveWorkspaceOrResponse(workspaceId);

  if (accessErrorResponse) {
    return accessErrorResponse;
  }

  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspace-drafts-submit',
    getClientKey(request, session?.user?.id),
    SUBMIT_RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['초안 제출 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ['request body must be valid JSON'] }, { status: 400 });
  }

  const parsedBody = parseSubmitBody(body);

  if (!parsedBody.valid) {
    return NextResponse.json({ errors: parsedBody.errors }, { status: 400 });
  }

  try {
    const db = getDb();
    const pendingCount = await db.sharedWorkspaceDraft.count({
      where: { workspaceId, status: 'pending' },
    });

    if (pendingCount >= PENDING_DRAFT_LIMIT) {
      return NextResponse.json(
        { errors: ['제출 대기 초안이 가득 찼습니다. 소유자가 처리한 뒤 다시 시도해 주세요.'] },
        { status: 409 },
      );
    }

    const draft = await db.sharedWorkspaceDraft.create({
      data: {
        workspaceId,
        authorName: parsedBody.draft.authorName,
        aiModel: parsedBody.draft.aiModel,
        taskTitle: parsedBody.draft.taskTitle,
        rawText: parsedBody.draft.rawText,
        // 로그인 사용자는 계정에서 파생한 키로 저장한다. 그래야 나중에 이 초안을 철회할
        // 권한이 localStorage가 아니라 계정에 묶인다.
        anonymousKey: resolveParticipantKey({
          userId: session?.user?.id,
          workspaceId,
          clientKey: parsedBody.draft.anonymousKey,
        }) ?? parsedBody.draft.anonymousKey,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json(
      {
        id: draft.id,
        createdAt: draft.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[workspaces] shared draft submit failed:', error);

    return NextResponse.json(
      { errors: ['초안 제출에 실패했습니다.'] },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
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

  const accessErrorResponse = await getActiveWorkspaceOrResponse(workspaceId);

  if (accessErrorResponse) {
    return accessErrorResponse;
  }

  const session = await auth();
  const rateLimit = await checkRateLimit(
    'workspace-drafts-read',
    getClientKey(request, session?.user?.id),
    READ_RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['초안 목록 조회 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const drafts = await getDb().sharedWorkspaceDraft.findMany({
      where: { workspaceId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: PENDING_DRAFT_LIMIT,
      select: {
        id: true,
        authorName: true,
        aiModel: true,
        taskTitle: true,
        rawText: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      drafts: drafts.map((draft) => ({
        ...draft,
        createdAt: draft.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[workspaces] shared drafts read failed:', error);

    return NextResponse.json(
      { errors: ['제출된 초안 목록 조회에 실패했습니다.'] },
      { status: 500 },
    );
  }
}
