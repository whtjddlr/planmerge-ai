import { analysisAuthHeaders, loadAnalysisCredentials } from '../analysisKeyStore';
import { isAnalysisFailureReason, type AnalysisFailureReason } from './analysisFailureReason';
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
  /** 서버가 분류한 502 사유. 업스트림 텍스트가 아니라 우리가 통제하는 enum이다. */
  readonly reason?: AnalysisFailureReason;

  constructor(
    code: AnalysisFailureCode,
    message: string,
    retryable: boolean,
    detail?: string,
    reason?: AnalysisFailureReason,
  ) {
    super(message);
    this.name = 'AnalysisFailureError';
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
    this.reason = reason;
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
  /** 서버가 알려준 토큰 사용량. JSON 응답은 헤더로, 스트림은 마지막 result 이벤트로. 없으면 undefined. */
  usage?: AnalysisTokenUsage;
};

export type AnalysisStage = 'normalize' | 'merge' | 'placement' | 'compose' | 'repair';

export type AnalysisProgressEvent = {
  stage: AnalysisStage;
  status: 'started' | 'done';
  completed?: number;
  total?: number;
};

const analysisStages = new Set<AnalysisStage>(['normalize', 'merge', 'placement', 'compose', 'repair']);
const NDJSON_MEDIA_TYPE = 'application/x-ndjson';

type StreamLine =
  | { type: 'progress'; event: AnalysisProgressEvent }
  | { type: 'result'; result: unknown; usage?: AnalysisTokenUsage }
  | { type: 'error'; status: number; payload: unknown };

/**
 * 스트림 한 줄을 읽는다. 모르는 형태는 undefined — 진행 표시 하나 때문에 분석을 깨지 않는다.
 * 순수 함수라 회귀 케이스가 직접 부른다.
 */
export function parseAnalysisStreamLine(line: string): StreamLine | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return undefined;
  }

  if (parsed.type === 'progress') {
    const stage = typeof parsed.stage === 'string' && analysisStages.has(parsed.stage as AnalysisStage)
      ? (parsed.stage as AnalysisStage)
      : undefined;
    const status = parsed.status === 'started' || parsed.status === 'done' ? parsed.status : undefined;

    if (!stage || !status) {
      return undefined;
    }

    const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
    const completed = count(parsed.completed);
    const total = count(parsed.total);

    return {
      type: 'progress',
      event: {
        stage,
        status,
        ...(completed !== undefined ? { completed } : {}),
        ...(total !== undefined ? { total } : {}),
      },
    };
  }

  if (parsed.type === 'result') {
    return {
      type: 'result',
      result: parsed.result,
      ...(isRecord(parsed.usage) ? { usage: readUsage(parsed.usage) } : {}),
    };
  }

  if (parsed.type === 'error') {
    return {
      type: 'error',
      status: typeof parsed.status === 'number' ? parsed.status : 502,
      payload: parsed,
    };
  }

  return undefined;
}

function readUsage(record: Record<string, unknown>): AnalysisTokenUsage {
  const read = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

  return {
    inputTokens: read(record.inputTokens),
    outputTokens: read(record.outputTokens),
    reasoningTokens: read(record.reasoningTokens),
    calls: read(record.calls),
  };
}

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
  options: { onProgress?: (event: AnalysisProgressEvent) => void } = {},
): Promise<AnalysisRun> {
  let response: Response;

  try {
    response = await fetch('/api/analyze/planmerge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 진행 단계를 받고 싶다는 뜻이다. 서버가 JSON으로 답해도(스텁, 옛 배포) 그대로 처리한다.
        Accept: `${NDJSON_MEDIA_TYPE}, application/json`,
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

  const contentType = response.headers.get('content-type') ?? '';
  let usage: AnalysisTokenUsage | undefined;
  let result: PlanMergeAnalysisResult;

  if (contentType.includes(NDJSON_MEDIA_TYPE)) {
    const streamed = await readAnalysisStream(response, options.onProgress);

    usage = streamed.usage;
    result = streamed.result as PlanMergeAnalysisResult;
  } else {
    usage = readUsageHeader(response);

    try {
      result = await response.json() as PlanMergeAnalysisResult;
    } catch {
      throw new AnalysisFailureError(
        'response_validation_failed',
        '분석 응답이 올바른 JSON 형식이 아닙니다.',
        true,
      );
    }
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

/** NDJSON 스트림을 끝까지 읽어 result를 꺼낸다. error 이벤트는 같은 실패 매핑을 탄다. */
async function readAnalysisStream(
  response: Response,
  onProgress?: (event: AnalysisProgressEvent) => void,
): Promise<{ result: unknown; usage?: AnalysisTokenUsage }> {
  if (!response.body) {
    throw new AnalysisFailureError('response_validation_failed', '분석 응답 본문이 비어 있습니다.', true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalLine: StreamLine | undefined;

  const consume = (line: string) => {
    const parsed = parseAnalysisStreamLine(line);

    if (!parsed) {
      return;
    }

    if (parsed.type === 'progress') {
      onProgress?.(parsed.event);
      return;
    }

    finalLine = parsed;
  };

  for (;;) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf('\n');

    while (newline >= 0) {
      consume(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  consume(buffer);

  // finalLine은 클로저에서 대입되므로 TS가 좁히지 못한다. 상수로 받아서 좁힌다.
  const final: StreamLine | undefined = finalLine;

  if (!final || final.type === 'progress') {
    throw new AnalysisFailureError(
      'response_validation_failed',
      '분석 스트림이 결과 없이 끝났습니다. 다시 시도해 주세요.',
      true,
    );
  }

  if (final.type === 'error') {
    throw analysisFailureFrom(final.status, final.payload);
  }

  return { result: final.result, ...(final.usage ? { usage: final.usage } : {}) };
}

export async function createAnalysisFailure(response: Response) {
  return analysisFailureFrom(response.status, await readErrorPayload(response));
}

/** 상태 코드와 `{ code, errors }` 본문을 실패로 옮긴다. HTTP 오류와 스트림 error 이벤트가 같이 쓴다. */
function analysisFailureFrom(status: number, errorPayload: unknown) {
  const errors = extractErrors(errorPayload);
  const serverCode = extractCode(errorPayload);
  const detail = errors.length ? errors.join('; ') : undefined;
  const response = { status };

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

  const reason = isRecord(errorPayload) && isAnalysisFailureReason(errorPayload.reason)
    ? errorPayload.reason
    : undefined;

  return new AnalysisFailureError(
    'analysis_failed',
    detail ?? `분석에 실패했습니다. 서버 응답 상태: ${response.status}`,
    true,
    detail,
    reason,
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
