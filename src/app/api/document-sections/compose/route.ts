import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  buildDocumentCompositionPrompt,
  replaceDocumentSection,
  validateDocumentCompositionResult,
} from '@/planmerge/lib/ai/documentComposition';
import { callGmsJson, getAnalysisConfig } from '@/planmerge/lib/ai/gmsServer';
import {
  isSectionKeyOfType,
  parsePlanMergeAnalysisPayload,
  validatePlanMergeAnalysis,
} from '@/planmerge/lib/ai/planmergeProtocol';
import type { DocumentSectionKey, PlanMergeAnalysisResult } from '@/planmerge/lib/ai/planmergeProtocol';
import { checkRateLimit, getClientKey } from '@/server/rateLimit';

// 섹션 하나를 다시 쓰는 호출 1건이다. 분석(300초)보다 훨씬 짧지만 플랫폼 기본값보다는 길어야 한다.
export const maxDuration = 60;

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };
// 섹션 하나의 산문이라 분석 파이프라인의 문서 작성(16k)보다 훨씬 작다.
const SECTION_MAX_OUTPUT_TOKENS = 4_000;

// 허용 섹션은 기획서 타입이 정한다. 요청마다 payload에서 읽는다.

/**
 * 결정이 바뀐 섹션의 본문을 다시 쓴다.
 *
 * 사람이 선택안을 바꾸면 서버는 본문을 고치지 않는다. 채택안 문장으로 덮어쓰면 같은
 * 섹션의 다른 결정 내용이 사라지고, 산문을 만드는 건 판단이라 룰로 할 수 없다. 대신
 * 화면이 "본문 갱신 필요"를 띄우고, 사용자가 누르면 이 라우트가 그 섹션의 결정들만
 * 모델에 넘겨 다시 쓴다. 분석 파이프라인의 문서 작성 단계와 같은 프롬프트·검증기를 쓴다.
 */
export async function POST(request: Request) {
  const session = await auth();
  const rateLimit = await checkRateLimit(
    'document-compose',
    getClientKey(request, session?.user?.id),
    RATE_LIMIT,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { errors: ['요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'] },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ['request body must be valid JSON'] }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ errors: ['payload must be an object'] }, { status: 400 });
  }

  const parsedPayload = parsePlanMergeAnalysisPayload({ project: body.project, drafts: body.drafts });

  if (!parsedPayload.valid) {
    return NextResponse.json({ errors: parsedPayload.errors }, { status: 400 });
  }

  const sectionKey = typeof body.sectionKey === 'string'
    && isSectionKeyOfType(parsedPayload.payload.project.documentType, body.sectionKey)
    ? (body.sectionKey as DocumentSectionKey)
    : undefined;

  if (!sectionKey) {
    return NextResponse.json({ errors: ['sectionKey must be one of the document section keys'] }, { status: 400 });
  }

  const analysisValidation = validatePlanMergeAnalysis(parsedPayload.payload, body.analysisResult);

  if (!analysisValidation.valid) {
    return NextResponse.json(
      { errors: analysisValidation.errors.map((error) => `analysisResult: ${error}`) },
      { status: 400 },
    );
  }

  const analysisResult = body.analysisResult as unknown as PlanMergeAnalysisResult;
  const blocks = analysisResult.decisionBlocks.filter((block) => block.sectionKey === sectionKey);

  if (!blocks.length) {
    return NextResponse.json(
      { errors: ['이 섹션에는 결정이 없어 본문을 쓸 수 없습니다.'] },
      { status: 400 },
    );
  }

  const config = getAnalysisConfig(request);

  if (!config.apiKey) {
    return failureResponse(
      503,
      'analysis_provider_unconfigured',
      '문서 작성에 사용할 API 키가 없습니다. 화면에서 키를 등록하거나 서버에 OPENAI_API_KEY를 설정해 주세요.',
    );
  }

  try {
    const raw = await callGmsJson<unknown>(
      buildDocumentCompositionPrompt(parsedPayload.payload, blocks),
      // maxDuration 60초. 섹션 하나라 분석의 문서 작성보다 훨씬 작은 호출이다.
      { maxOutputTokens: SECTION_MAX_OUTPUT_TOKENS, config, timeoutMs: 50_000 },
    );
    const composition = validateDocumentCompositionResult(
      raw,
      blocks,
      analysisResult.normalizedIdeas,
      parsedPayload.payload,
    );

    if (!composition.valid) {
      console.error('[document-compose] composition validation failed:', composition.errors);

      return failureResponse(
        502,
        'composition_validation_failed',
        `${config.model} 응답이 문서 작성 검증을 통과하지 못했습니다.`,
      );
    }

    const section = composition.sections.find((entry) => entry.sectionKey === sectionKey);

    if (!section) {
      return failureResponse(502, 'composition_validation_failed', `${config.model} 응답에 요청한 섹션이 없습니다.`);
    }

    const patched = replaceDocumentSection(analysisResult, section);
    const patchedValidation = validatePlanMergeAnalysis(parsedPayload.payload, patched);

    if (!patchedValidation.valid) {
      console.error('[document-compose] patched result validation failed:', patchedValidation.errors);

      return failureResponse(
        502,
        'patch_validation_failed',
        '다시 쓴 섹션을 적용한 결과가 PlanMerge 출처 검증을 통과하지 못했습니다.',
      );
    }

    return NextResponse.json({ section });
  } catch (error) {
    // 업스트림 오류 본문에는 게이트웨이 내부 정보가 섞일 수 있어 서버 로그에만 남긴다.
    console.error('[document-compose] request failed:', error);

    return failureResponse(502, 'analysis_failed', `${config.model} 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`);
  }
}

function failureResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, errors: [message] }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
