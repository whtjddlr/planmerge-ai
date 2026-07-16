import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { applyDecisionResolutionProposal } from '@/planmerge/lib/analysisOverride';
import {
  buildDecisionResolutionPrompt,
  createNonApplicableDecisionResolution,
  decisionResolutionProposalJsonSchema,
  parseDecisionResolutionPayload,
  parseDecisionResolutionResult,
  validateDecisionResolutionProposal,
} from '@/planmerge/lib/ai/decisionResolution';
import type {
  DecisionResolutionPayload,
  DecisionResolutionResult,
} from '@/planmerge/lib/ai/decisionResolution';
import {
  callResponsesJsonWithMetadata,
  getGmsConfig,
} from '@/planmerge/lib/ai/gmsServer';
import { validatePlanMergeAnalysis } from '@/planmerge/lib/ai/planmergeProtocol';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const DEFAULT_DECISION_MODEL = 'gpt-5.6';
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

  const provider = getDecisionProviderConfig();

  if (!provider) {
    return fallbackResponse(
      payload,
      'GMS_API_KEY와 OPENAI_API_KEY가 없어 GPT-5.6 합의안을 생성하지 못했습니다.',
    );
  }

  try {
    const response = await callResponsesJsonWithMetadata<unknown>(
      buildDecisionResolutionPrompt(payload),
      {
        apiKey: provider.apiKey,
        apiUrl: provider.apiUrl,
        model: provider.model,
        maxOutputTokens: 3_200,
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

      return fallbackResponse(
        payload,
        'GPT-5.6 응답이 Decision Room 구조 검증을 통과하지 못해 적용 가능한 변경안을 제공하지 않습니다.',
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

      return fallbackResponse(
        payload,
        'GPT-5.6 응답 메타데이터 검증에 실패해 적용 가능한 변경안을 제공하지 않습니다.',
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

        return fallbackResponse(
          payload,
          'GPT-5.6 합의안을 적용한 결과가 PlanMerge 출처 검증을 통과하지 못했습니다.',
        );
      }
    }

    return NextResponse.json(resultValidation.result);
  } catch (error) {
    // Upstream response bodies may contain gateway details, so expose only a stable warning.
    console.error('[decision-resolution] GPT-5.6 request failed:', error);

    return fallbackResponse(
      payload,
      'GPT-5.6 호출에 실패해 현재 결정과 출처를 그대로 유지합니다.',
    );
  }
}

function getDecisionProviderConfig(): DecisionProviderConfig | null {
  const model = firstNonEmpty(
    process.env.DECISION_MODEL,
    process.env.GMS_DECISION_MODEL,
    DEFAULT_DECISION_MODEL,
  );
  const gms = getGmsConfig();
  const gmsApiKey = normalizeSecret(gms.apiKey);

  if (gmsApiKey) {
    return {
      source: 'gms',
      apiKey: gmsApiKey,
      apiUrl: gms.apiUrl,
      model,
      providerLabel: 'GMS Responses API',
    };
  }

  const openAiApiKey = normalizeSecret(process.env.OPENAI_API_KEY);

  if (openAiApiKey) {
    return {
      source: 'openai',
      apiKey: openAiApiKey,
      apiUrl: firstNonEmpty(
        process.env.OPENAI_RESPONSES_URL,
        DEFAULT_OPENAI_RESPONSES_URL,
      ),
      model,
      providerLabel: 'OpenAI Responses API',
    };
  }

  return null;
}

function fallbackResponse(payload: DecisionResolutionPayload, warning: string) {
  return NextResponse.json(createNonApplicableDecisionResolution(payload, warning));
}

function normalizeSecret(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? '';
}
