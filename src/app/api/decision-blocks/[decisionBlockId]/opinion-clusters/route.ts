import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  buildOpinionClusteringPrompt,
  parseOpinionClusteringPayload,
  validateOpinionClusters,
} from '@/planmerge/lib/ai/opinionClustering';
import type {
  OpinionCluster,
  OpinionClusteringResult,
} from '@/planmerge/lib/ai/opinionClustering';
import { callGmsJson, getAnalysisConfig } from '@/planmerge/lib/ai/gmsServer';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

export const maxDuration = 60;

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

type RouteContext = {
  params: Promise<{
    decisionBlockId: string;
  }>;
};

// 의견 클러스터링은 "비슷한 의견을 묶는" 의미 작업이다. 규칙 기반 묶음을 같은
// 자리에 끼워 넣으면 사용자는 모델이 읽고 묶은 것으로 오해한다. 실패는 실패로 알린다.
function failureResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, errors: [message] }, { status });
}

function readClusterResponse(response: { clusters?: OpinionCluster[] }) {
  return response.clusters ?? [];
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'opinion-clusters',
    getClientKey(request, session?.user?.id),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { decisionBlockId } = await context.params;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: ['request body must be valid JSON'] },
      { status: 400 },
    );
  }

  const parsedPayload = parseOpinionClusteringPayload(body);

  if (!parsedPayload.valid) {
    return NextResponse.json(
      { errors: parsedPayload.errors },
      { status: 400 },
    );
  }

  const { payload } = parsedPayload;

  if (payload.decisionBlock.id !== decisionBlockId) {
    return NextResponse.json(
      { error: 'decisionBlockId does not match request body.' },
      { status: 400 },
    );
  }

  const config = getAnalysisConfig(request);
  const { apiKey, model, provider } = config;

  // 의견이 없는 것은 실패가 아니라 정상적인 빈 결과다. 모델 호출 없이 비어 있음을 알린다.
  if (payload.opinions.length === 0) {
    return NextResponse.json({
      clusters: [],
      source: 'empty',
      model: 'none',
    } satisfies OpinionClusteringResult);
  }

  if (!apiKey) {
    return failureResponse(
      503,
      'clustering_provider_unconfigured',
      '의견 요약에 사용할 API 키가 없습니다. 화면에서 키를 등록하거나 서버에 OPENAI_API_KEY를 설정해 주세요.',
    );
  }

  try {
    const prompt = buildOpinionClusteringPrompt(payload);
    const rawResult = await callGmsJson<{ clusters?: OpinionCluster[] }>(
      prompt,
      {
        maxOutputTokens: 2400,
        model,
        config,
        // maxDuration이 60초인데 호출 기본값은 120초였다. 플랫폼이 먼저 함수를
        // 끊으면 응답이 없어서 사용자는 사유도 받지 못한다 — 함수보다 먼저 끊는다.
        timeoutMs: 50_000,
      },
    );
    const clusters = readClusterResponse(rawResult);
    const validation = validateOpinionClusters(payload, clusters);

    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    return NextResponse.json({
      clusters,
      source: provider,
      model,
    } satisfies OpinionClusteringResult);
  } catch (error) {
    // 업스트림 오류 본문에는 게이트웨이 내부 정보가 섞일 수 있어 서버 로그에만 남긴다.
    console.error('[opinion-clusters] clustering failed:', error);

    return failureResponse(
      502,
      'clustering_failed',
      `${model} 의견 요약에 실패했습니다. 잠시 후 다시 시도해 주세요.`,
    );
  }
}
