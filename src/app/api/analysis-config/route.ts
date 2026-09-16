import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { looksLikeOpenAiKey, verifyOpenAiKey } from '@/planmerge/lib/ai/analysisCredentials';
import { getGmsConfig } from '@/planmerge/lib/ai/gmsServer';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

export const maxDuration = 60;

// 키 검증은 외부 호출 1회짜리 가벼운 작업이지만, 무제한이면 키 대입 시도에 쓰일 수 있다.
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/**
 * 서버에 분석 키가 이미 있는지 알려준다.
 *
 * 있으면 화면은 키를 묻지 않는다. 키 값이나 그 일부는 절대 응답에 담지 않는다.
 */
export async function GET() {
  const { apiKey, provider, model } = getGmsConfig();

  return NextResponse.json({
    serverConfigured: Boolean(apiKey),
    ...(apiKey ? { provider, model } : {}),
  });
}

/**
 * 사용자가 입력한 키를 검증하고 쓸 수 있는 모델을 알려준다.
 *
 * 키는 이 요청 동안만 존재한다. 저장하지 않고, 로그에 남기지 않으며, 응답에 되돌려
 * 보내지도 않는다. 브라우저가 키를 보관하고 이후 요청마다 헤더로 보낸다.
 */
export async function POST(request: Request) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'analysis-config-verify',
    getClientKey(request, session?.user?.id),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: 'rate_limited', errors: ['확인 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'invalid_body', errors: ['request body must be valid JSON'] },
      { status: 400 },
    );
  }

  const apiKey = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).apiKey
    : undefined;

  if (typeof apiKey !== 'string' || !looksLikeOpenAiKey(apiKey.trim())) {
    return NextResponse.json(
      {
        code: 'invalid_key_format',
        errors: ['OpenAI API 키 형식이 아닙니다. "sk-"로 시작하는 값을 넣어 주세요.'],
      },
      { status: 400 },
    );
  }

  const verification = await verifyOpenAiKey(apiKey.trim());

  if (!verification.ok) {
    const messages: Record<typeof verification.reason, string> = {
      rejected: '키가 거절되었습니다. 값을 다시 확인해 주세요.',
      no_models: '이 키로 사용할 수 있는 모델이 없습니다.',
      no_supported_model: 'PlanMerge가 지원하는 모델에 접근할 수 없는 키입니다.',
      unreachable: 'OpenAI에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    };

    return NextResponse.json(
      { code: verification.reason, errors: [messages[verification.reason]] },
      { status: verification.reason === 'rejected' ? 400 : 502 },
    );
  }

  return NextResponse.json({
    valid: true,
    model: verification.model,
    availableCount: verification.availableCount,
  });
}
