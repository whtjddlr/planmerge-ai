import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { applyDecisionResolutionProposal } from '@/planmerge/lib/analysisOverride';
import {
  buildDecisionResolutionPrompt,
  decisionResolutionProposalJsonSchema,
  parseDecisionResolutionPayload,
  parseDecisionResolutionResult,
  validateDecisionResolutionProposal,
} from '@/planmerge/lib/ai/decisionResolution';
import type { DecisionResolutionResult } from '@/planmerge/lib/ai/decisionResolution';
import {
  callResponsesJsonWithMetadata,
  getAnalysisConfig,
} from '@/planmerge/lib/ai/gmsServer';
import { validatePlanMergeAnalysis } from '@/planmerge/lib/ai/planmergeProtocol';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

// 추론 모델 한 번 호출이므로 분석보다 짧지만, 플랫폼 기본 타임아웃보다는 길어야 한다.
export const maxDuration = 120;

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const DEFAULT_DECISION_MODEL = 'gpt-5.6-luna';
const DEFAULT_OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

type RouteContext = {
  params: Promise<{
    decisionBlockId: string;
  }>;
};

type DecisionProviderConfig = {
  source: 'gms' | 'openai';
  apiKey: string;
  apiUrl: string;
  model: string;
  providerLabel: string;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'decision-resolution',
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

  const parsedPayload = parseDecisionResolutionPayload(body);

  if (!parsedPayload.valid) {
    return NextResponse.json(
      { errors: parsedPayload.errors },
      { status: 400 },
    );
  }

  const { payload } = parsedPayload;

  if (payload.decisionBlockId !== decisionBlockId) {
    return NextResponse.json(
      { errors: ['decisionBlockId does not match request body.'] },
      { status: 400 },
    );
  }

  const provider = getDecisionProviderConfig(request);

  if (!provider) {
    return failureResponse(
      503,
      'decision_provider_unconfigured',
      '합의안 생성에 사용할 API 키가 없습니다. 화면에서 키를 등록하거나 서버에 OPENAI_API_KEY를 설정해 주세요.',
    );
  }

  try {
    const response = await callResponsesJsonWithMetadata<unknown>(
      buildDecisionResolutionPrompt(payload),
      {
        apiKey: provider.apiKey,
        apiUrl: provider.apiUrl,
        model: provider.model,
        // 옵션이 많고 의견이 긴 블록에서 3,200으로는 응답이 incomplete로 잘린다.
        // merge에서 같은 방식으로 실패한 적이 있어 여유를 둔다.
        maxOutputTokens: 8_000,
        providerLabel: provider.providerLabel,
        reasoningEffort: 'medium',
        jsonSchema: {
          name: 'planmerge_decision_resolution',
          schema: decisionResolutionProposalJsonSchema,
        },
      },
    );
    const proposalValidation = validateDecisionResolutionProposal(payload, response.data);

    if (!proposalValidation.valid) {
      console.error(
        '[decision-resolution] GPT-5.6 proposal validation failed:',
        proposalValidation.errors,
      );

      return failureResponse(
        502,
        'proposal_validation_failed',
        `${provider.model} 응답이 Decision Room 구조 검증을 통과하지 못했습니다.`,
      );
    }

    const result: DecisionResolutionResult = {
      proposal: proposalValidation.proposal,
      source: provider.source,
      model: response.model ?? provider.model,
      ...(response.responseId ? { responseId: response.responseId } : {}),
      generatedAt: new Date().toISOString(),
      applicable: proposalValidation.proposal.status === 'ready',
    };
    const resultValidation = parseDecisionResolutionResult(payload, result);

    if (!resultValidation.valid) {
      console.error(
        '[decision-resolution] response envelope validation failed:',
        resultValidation.errors,
      );

      return failureResponse(
        502,
        'envelope_validation_failed',
        `${provider.model} 응답 메타데이터 검증에 실패했습니다.`,
      );
    }

    if (resultValidation.result.applicable) {
      const patchedResult = applyDecisionResolutionProposal(
        payload.analysisResult,
        resultValidation.result,
      );
      const patchedValidation = validatePlanMergeAnalysis(
        { project: payload.project, drafts: payload.drafts },
        patchedResult,
      );

      if (patchedResult === payload.analysisResult || !patchedValidation.valid) {
        console.error(
          '[decision-resolution] virtual consensus patch validation failed:',
          patchedValidation.errors,
        );

        return failureResponse(
          502,
          'patch_validation_failed',
          `${provider.model} 합의안을 적용한 결과가 PlanMerge 출처 검증을 통과하지 못했습니다.`,
        );
      }
    }

    return NextResponse.json(resultValidation.result);
  } catch (error) {
    // Upstream response bodies may contain gateway details, so expose only a stable message.
    console.error('[decision-resolution] resolution request failed:', error);

    return failureResponse(
      502,
      'upstream_request_failed',
      `${provider.model} 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`,
    );
  }
}

function getDecisionProviderConfig(request: Request): DecisionProviderConfig | null {
  const serverModel = firstNonEmpty(
    process.env.DECISION_MODEL,
    process.env.OPENAI_DECISION_MODEL,
    process.env.GMS_DECISION_MODEL,
  );
  const openAiApiKey = normalizeSecret(process.env.OPENAI_API_KEY);

  if (openAiApiKey) {
    return {
      source: 'openai',
      apiKey: openAiApiKey,
      apiUrl: firstNonEmpty(
        process.env.OPENAI_RESPONSES_URL,
        DEFAULT_OPENAI_RESPONSES_URL,
      ),
      model: serverModel || DEFAULT_DECISION_MODEL,
      providerLabel: 'OpenAI Responses API',
    };
  }

  // 서버 키가 없으면 사용자가 브라우저에서 보낸 자기 키로 해결한다.
  // 그 키가 접근할 수 있는 모델은 등록 시점에 확인해 두었으므로 함께 온 모델을 쓴다.
  const config = getAnalysisConfig(request);
  const apiKey = normalizeSecret(config.apiKey);

  if (!apiKey) {
    return null;
  }

  return {
    source: config.provider,
    apiKey,
    apiUrl: config.apiUrl,
    model: config.keySource === 'request'
      ? config.model
      : (serverModel || DEFAULT_DECISION_MODEL),
    providerLabel: config.provider === 'openai' ? 'OpenAI Responses API' : 'GMS Responses API',
  };
}

// 생성 실패를 200 응답으로 포장하면 UI가 그것을 하나의 "결과"로 렌더링하고, 사용자는
// 모델이 판단한 것과 규칙이 포기한 것을 구분할 수 없다. 실패는 실패 상태 코드로 노출해
// 클라이언트가 재시도나 수동 결정을 선택하게 한다.
function failureResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, errors: [message] }, { status });
}

function normalizeSecret(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? '';
}
