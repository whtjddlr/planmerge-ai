import { NextResponse } from 'next/server';
import {
  buildOpinionClusteringPrompt,
  createLocalFallbackClusters,
  parseOpinionClusteringPayload,
  validateOpinionClusters,
} from '@/planmerge/lib/ai/opinionClustering';
import type {
  OpinionCluster,
  OpinionClusteringPayload,
  OpinionClusteringResult,
} from '@/planmerge/lib/ai/opinionClustering';
import { callGmsJson, getGmsConfig } from '@/planmerge/lib/ai/gmsServer';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

type RouteContext = {
  params: Promise<{
    decisionBlockId: string;
  }>;
};

function fallbackResponse(payload: OpinionClusteringPayload, warning: string) {
  const result: OpinionClusteringResult = {
    clusters: createLocalFallbackClusters(payload),
    source: 'local_fallback',
    model: 'local-rules',
    warning,
  };

  return NextResponse.json(result);
}

function readClusterResponse(response: { clusters?: OpinionCluster[] }) {
  return response.clusters ?? [];
}

export async function POST(request: Request, context: RouteContext) {
  const rateLimit = checkRateLimit('opinion-clusters', getClientKey(request), RATE_LIMIT);

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

  if (payload.opinions.length === 0) {
    return NextResponse.json({
      clusters: [],
      source: 'local_fallback',
      model: 'local-rules',
    } satisfies OpinionClusteringResult);
  }

  const { apiKey, model } = getGmsConfig();

  if (!apiKey) {
    return fallbackResponse(payload, 'GMS_API_KEY가 없어 로컬 규칙 기반 요약을 사용했습니다.');
  }

  try {
    const prompt = buildOpinionClusteringPrompt(payload);
    const rawResult = await callGmsJson<{ clusters?: OpinionCluster[] }>(
      prompt,
      {
        maxOutputTokens: 2400,
        model,
      },
    );
    const clusters = readClusterResponse(rawResult);
    const validation = validateOpinionClusters(payload, clusters);

    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    return NextResponse.json({
      clusters,
      source: 'gms',
      model,
    } satisfies OpinionClusteringResult);
  } catch (error) {
    // 업스트림 오류 본문에는 게이트웨이 내부 정보가 섞일 수 있어 서버 로그에만 남긴다.
    console.error('[opinion-clusters] GMS clustering failed:', error);

    return fallbackResponse(payload, 'GMS 요약 검증에 실패해 로컬 규칙 기반 요약을 사용했습니다.');
  }
}
