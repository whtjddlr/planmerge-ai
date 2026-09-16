import { analysisAuthHeaders, loadAnalysisCredentials } from '../analysisKeyStore';
import { validatePlanMergeAnalysis } from './planmergeProtocol';
import type {
  PlanMergeAnalysisPayload,
  PlanMergeAnalysisResult,
} from './planmergeProtocol';

export type AnalysisFailureCode =
  | 'no_drafts'
  | 'invalid_input'
  | 'rate_limited'
  | 'analysis_provider_unconfigured'
  | 'analysis_failed'
  | 'response_validation_failed'
  | 'network_error';

/**
 * 분석은 성공하거나 실패한다. 규칙 기반 대체 결과를 성공처럼 돌려주면 사용자가
 * 모델의 의미 비교와 키워드 매칭을 구분할 수 없으므로, 실패는 그대로 던진다.
 */
export class AnalysisFailureError extends Error {
  readonly code: AnalysisFailureCode;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(code: AnalysisFailureCode, message: string, retryable: boolean, detail?: string) {
    super(message);
    this.name = 'AnalysisFailureError';
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

export type AnalysisTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  calls: number;
};

export type AnalysisRun = {
  result: PlanMergeAnalysisResult;
  /** 서버가 헤더로 알려준 토큰 사용량. 헤더가 없으면 undefined. */
  usage?: AnalysisTokenUsage;
};

/** 사용량 헤더는 없거나 깨져 있을 수 있다. 그 경우 분석 자체를 실패시키지 않는다. */
function readUsageHeader(response: Response): AnalysisTokenUsage | undefined {
  const raw = response.headers.get('x-planmerge-usage');

  if (!raw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return undefined;
    }

    const read = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

    return {
      inputTokens: read(parsed.inputTokens),
      outputTokens: read(parsed.outputTokens),
      reasoningTokens: read(parsed.reasoningTokens),
      calls: read(parsed.calls),
    };
  } catch {
    return undefined;
  }
}

export async function generatePlanMergeAnalysis(
  payload: PlanMergeAnalysisPayload,
): Promise<AnalysisRun> {
  let response: Response;

  try {
    response = await fetch('/api/analyze/planmerge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 서버에 키가 설정돼 있으면 서버 키가 우선하고 이 헤더는 무시된다.
        ...analysisAuthHeaders(loadAnalysisCredentials()),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new AnalysisFailureError(
      'network_error',
      '분석 서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      true,
      error instanceof Error ? error.message : undefined,
    );
  }

  if (!response.ok) {
    throw await createAnalysisFailure(response);
  }

  const usage = readUsageHeader(response);
  let result: PlanMergeAnalysisResult;

  try {
    result = await response.json() as PlanMergeAnalysisResult;
  } catch {
    throw new AnalysisFailureError(
      'response_validation_failed',
      '분석 응답이 올바른 JSON 형식이 아닙니다.',
      true,
    );
  }

  const validation = validatePlanMergeAnalysis(payload, result);

  if (!validation.valid) {
    // 출처 추적 불변식을 깨는 결과는 화면에 올리지 않는다.
    throw new AnalysisFailureError(
      'response_validation_failed',
      '분석 결과가 출처 검증을 통과하지 못했습니다. 다시 시도해 주세요.',
      true,
      validation.errors.join('; '),
    );
  }

  return { result, ...(usage ? { usage } : {}) };
}

async function createAnalysisFailure(response: Response) {
  const errorPayload = await readErrorPayload(response);
  const errors = extractErrors(errorPayload);
  const serverCode = extractCode(errorPayload);
  const detail = errors.length ? errors.join('; ') : undefined;

  if (response.status === 429) {
    return new AnalysisFailureError(
      'rate_limited',
      '분석 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      true,
      detail,
    );
  }

  if (response.status === 400) {
    return new AnalysisFailureError(
      serverCode === 'no_drafts' ? 'no_drafts' : 'invalid_input',
      detail ?? '서버가 입력을 거절했습니다.',
      false,
      detail,
    );
  }

  if (response.status === 503) {
    return new AnalysisFailureError(
      'analysis_provider_unconfigured',
      detail ?? '분석 모델이 설정되지 않았습니다.',
      false,
      detail,
    );
  }

  return new AnalysisFailureError(
    'analysis_failed',
    detail ?? `분석에 실패했습니다. 서버 응답 상태: ${response.status}`,
    true,
    detail,
  );
}

async function readErrorPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    return text;
  }
}

function extractCode(payload: unknown) {
  if (!isRecord(payload) || typeof payload.code !== 'string') {
    return undefined;
  }

  return payload.code;
}

function extractErrors(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) {
    return [];
  }

  return payload.errors
    .filter((error): error is string => typeof error === 'string' && error.trim().length > 0)
    .map((error) => error.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
