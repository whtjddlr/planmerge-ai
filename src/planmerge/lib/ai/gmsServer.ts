import {
  OPENAI_RESPONSES_URL,
  readRequestCredentials,
} from './analysisCredentials';

export type GmsConfig = {
  provider: 'openai' | 'gms';
  apiKey?: string;
  apiUrl: string;
  model: string;
  /** 키의 출처. 'request'는 사용자가 브라우저에서 보낸 키이며 서버에 저장하지 않는다. */
  keySource: 'server' | 'request' | 'none';
};

type GmsResponseContent = {
  text?: unknown;
};

type GmsResponsesApiResponse = {
  id?: unknown;
  model?: unknown;
  status?: unknown;
  incomplete_details?: unknown;
  output_text?: unknown;
  output?: unknown;
  choices?: unknown;
  usage?: unknown;
};

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ResponsesJsonSchema = {
  name: string;
  schema: object;
};

type GmsJsonCallOptions = {
  maxOutputTokens: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  jsonSchema?: ResponsesJsonSchema;
  signal?: AbortSignal;
};

export type ResponsesJsonCallOptions = GmsJsonCallOptions & {
  apiKey: string;
  apiUrl: string;
  providerLabel?: string;
  temperature?: number;
  /** 호출자가 중단시킬 수 있는 신호. 한 건이 실패하면 남은 병렬 호출을 끊는 데 쓴다. */
  signal?: AbortSignal;
};

export type ResponsesJsonResult<T> = {
  data: T;
  responseId?: string;
  model?: string;
  reasoningTokens?: number;
};

const DEFAULT_GMS_API_URL = 'https://gms.ssafy.io/gmsapi/api.openai.com/v1/responses';
const DEFAULT_GMS_MODEL = 'gpt-4.1';
// 업스트림이 응답을 물고 있으면 분석 라우트가 초안 수만큼의 병렬 요청을
// 함수 타임아웃까지 잡고 있게 되므로 요청 단위로 끊는다. 추론 모델은 기존
// 60초 안에 끝나지 않는 경우가 있어 한도를 올린다.
const GMS_REQUEST_TIMEOUT_MS = 120_000;

// 추론 모델(gpt-5 계열 등)은 temperature 같은 샘플링 파라미터를 400으로 거부한다.
// 모델명을 정규식으로 분기하면 새 모델이 나올 때마다 같은 버그가 재발하므로,
// 업스트림이 실제로 거부한 파라미터를 응답에서 학습해 캐시하고 이후 요청에서 뺀다.
const unsupportedParamsByModel = new Map<string, Set<string>>();
// 지원 여부를 모르는 첫 호출이 동시에 여러 건 나가면 같은 400을 요청 수만큼 맞는다.
// 모델별로 첫 프로브를 직렬화해 학습 결과를 공유한다.
const capabilityProbeByModel = new Map<string, Promise<void>>();

const ADAPTIVE_PARAMS = new Set(['temperature', 'reasoning', 'top_p', 'max_output_tokens']);

// 초안 수만큼 병렬 호출이 나가므로 일시적 429/5xx를 한 번이라도 맞을 확률이 높다.
// 재시도가 없으면 그 한 건이 분석 전체를 실패시킨다.
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 20_000;

class TransientUpstreamError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'TransientUpstreamError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** `Retry-After`는 초 단위 숫자 또는 HTTP date로 온다. */
function parseRetryAfter(header: string | null) {
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, RETRY_MAX_DELAY_MS);
  }

  const date = Date.parse(header);

  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), RETRY_MAX_DELAY_MS);
  }

  return undefined;
}

function backoffDelayMs(attempt: number, retryAfterMs?: number) {
  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }

  const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);

  // 병렬 호출이 같은 순간에 함께 재시도해 다시 429를 맞지 않도록 지터를 넣는다.
  return exponential / 2 + Math.random() * (exponential / 2);
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function unsupportedParamsFor(model: string) {
  return unsupportedParamsByModel.get(model) ?? new Set<string>();
}

function rememberUnsupportedParam(model: string, param: string) {
  const current = unsupportedParamsByModel.get(model) ?? new Set<string>();
  current.add(param);
  unsupportedParamsByModel.set(model, current);
}

/** 학습 캐시를 비우기 위한 훅. 회귀 케이스와 운영 중 모델 교체에 쓴다. */
export function resetModelCapabilityCache() {
  unsupportedParamsByModel.clear();
  capabilityProbeByModel.clear();
}

export function getGmsConfig(): GmsConfig {
  const direct = process.env.ANALYSIS_PROVIDER === 'openai' || (!process.env.ANALYSIS_PROVIDER && Boolean(process.env.OPENAI_API_KEY));
  const apiKey = (direct ? process.env.OPENAI_API_KEY : process.env.GMS_API_KEY)?.trim() || undefined;

  return {
    provider: direct ? 'openai' : 'gms',
    apiKey,
    apiUrl: direct ? OPENAI_RESPONSES_URL : (process.env.GMS_API_URL ?? DEFAULT_GMS_API_URL),
    model: (direct ? process.env.OPENAI_ANALYSIS_MODEL : process.env.GMS_DEFAULT_MODEL)
      ?? process.env.MODEL_NAME
      ?? DEFAULT_GMS_MODEL,
    keySource: apiKey ? 'server' : 'none',
  };
}

/**
 * 이 요청에 쓸 분석 설정.
 *
 * 서버에 키가 있으면 그것을 쓴다. 없으면 사용자가 헤더로 보낸 자기 키를 쓴다.
 * 사용자 키는 이 요청 동안만 존재하며 저장하거나 로그에 남기지 않는다.
 */
export function getAnalysisConfig(request: Request): GmsConfig {
  const serverConfig = getGmsConfig();

  if (serverConfig.apiKey) {
    return serverConfig;
  }

  const credentials = readRequestCredentials(request);

  if (!credentials) {
    return serverConfig;
  }

  return {
    provider: 'openai',
    apiKey: credentials.apiKey,
    apiUrl: OPENAI_RESPONSES_URL,
    model: credentials.model ?? serverConfig.model,
    keySource: 'request',
  };
}

export function extractJsonObject(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error('Responses API did not contain a JSON object.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractIncompleteReason(data: GmsResponsesApiResponse) {
  const details = data.incomplete_details;

  if (isRecord(details) && typeof details.reason === 'string' && details.reason.trim()) {
    return details.reason.trim();
  }

  return 'unknown';
}

function extractReasoningTokens(data: GmsResponsesApiResponse) {
  const usage = data.usage;

  if (!isRecord(usage) || !isRecord(usage.output_tokens_details)) {
    return undefined;
  }

  const reasoningTokens = usage.output_tokens_details.reasoning_tokens;

  return typeof reasoningTokens === 'number' ? reasoningTokens : undefined;
}

function extractOutputText(data: GmsResponsesApiResponse) {
  if (typeof data.output_text === 'string' && data.output_text) {
    return data.output_text;
  }

  const outputText = (Array.isArray(data.output) ? data.output : [])
    .flatMap((output): GmsResponseContent[] => {
      if (!isRecord(output) || !Array.isArray(output.content)) {
        return [];
      }

      return output.content
        .filter(isRecord)
        .map((content) => ({ text: content.text }));
    })
    .map((content) => content.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('');

  if (outputText) {
    return outputText;
  }

  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message = isRecord(firstChoice) && isRecord(firstChoice.message)
    ? firstChoice.message
    : undefined;
  const chatContent = typeof message?.content === 'string' ? message.content : undefined;
  if (chatContent) {
    return chatContent;
  }

  throw new Error('Responses API response did not include text content.');
}

/**
 * "Unsupported parameter: 'temperature' is not supported with this model." 형태의
 * 업스트림 400 본문에서 문제가 된 파라미터 이름을 뽑는다. OpenAI는 구조화된
 * error.param을 주지만 게이트웨이를 거치면 문자열만 남는 경우가 있어 둘 다 본다.
 */
export function extractUnsupportedParam(status: number, errorText: string) {
  if (status !== 400) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(errorText);

    if (isRecord(parsed) && isRecord(parsed.error)) {
      const param = parsed.error.param;
      const message = typeof parsed.error.message === 'string' ? parsed.error.message : '';

      if (typeof param === 'string' && ADAPTIVE_PARAMS.has(param) && /unsupported|not supported/i.test(message)) {
        return param;
      }
    }
  } catch {
    // 본문이 JSON이 아니면 아래 문자열 매칭으로 넘어간다.
  }

  const match = errorText.match(/[Uu]nsupported parameter: '([a-z_]+)'/);

  if (match?.[1] && ADAPTIVE_PARAMS.has(match[1])) {
    return match[1];
  }

  return undefined;
}

export async function callGmsJson<T>(
  prompt: string,
  options: GmsJsonCallOptions & { config?: GmsConfig },
): Promise<T> {
  const { apiKey, apiUrl, model, provider } = options.config ?? getGmsConfig();

  if (!apiKey) {
    throw new Error('Analysis API key is missing.');
  }

  const result = await callResponsesJsonWithMetadata<T>(prompt, {
    ...options,
    apiKey,
    apiUrl,
    model: options.model ?? model,
    providerLabel: provider === 'openai' ? 'OpenAI API' : 'GMS API',
    // 샘플링을 지원하는 모델에서는 결정성을 위해 낮게 둔다. 추론 모델이 거부하면
    // 아래 어댑티브 재시도가 파라미터를 빼고 그 사실을 모델별로 기억한다.
    temperature: 0.1,
  });

  return result.data;
}

function buildRequestBody(
  prompt: string,
  options: ResponsesJsonCallOptions,
  model: string,
  omit: Set<string>,
) {
  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    text: {
      format: options.jsonSchema
        ? {
          type: 'json_schema',
          name: options.jsonSchema.name,
          strict: true,
          schema: options.jsonSchema.schema,
        }
        : {
          type: 'json_object',
        },
    },
  };

  if (!omit.has('max_output_tokens')) {
    body.max_output_tokens = options.maxOutputTokens;
  }

  if (options.temperature !== undefined && !omit.has('temperature')) {
    body.temperature = options.temperature;
  }

  if (options.reasoningEffort && !omit.has('reasoning')) {
    body.reasoning = { effort: options.reasoningEffort };
  }

  return body;
}

export async function callResponsesJsonWithMetadata<T>(
  prompt: string,
  options: ResponsesJsonCallOptions,
): Promise<ResponsesJsonResult<T>> {
  const selectedModel = options.model ?? DEFAULT_GMS_MODEL;
  const providerLabel = options.providerLabel?.trim() || 'Responses API';

  // 같은 모델의 첫 호출들이 동시에 같은 400을 맞지 않도록 프로브를 직렬화한다.
  const inFlightProbe = capabilityProbeByModel.get(selectedModel);

  if (inFlightProbe) {
    await inFlightProbe.catch(() => undefined);
  }

  const attempt = async (): Promise<ResponsesJsonResult<T>> => {
    // 업스트림이 거부하는 파라미터를 학습할 때까지 최대 ADAPTIVE_PARAMS 수만큼 재시도한다.
    for (let round = 0; round <= ADAPTIVE_PARAMS.size; round += 1) {
      const omit = unsupportedParamsFor(selectedModel);
      const timeoutSignal = AbortSignal.timeout(GMS_REQUEST_TIMEOUT_MS);
      const response = await fetch(options.apiUrl, {
        method: 'POST',
        signal: options.signal
          ? AbortSignal.any([timeoutSignal, options.signal])
          : timeoutSignal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody(prompt, options, selectedModel, omit)),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const unsupportedParam = extractUnsupportedParam(response.status, errorText);

        if (unsupportedParam && !omit.has(unsupportedParam)) {
          console.warn(
            `[responses] ${selectedModel} rejected '${unsupportedParam}'; retrying without it.`,
          );
          rememberUnsupportedParam(selectedModel, unsupportedParam);
          continue;
        }

        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new TransientUpstreamError(
            `${providerLabel} failed with ${response.status}`,
            response.status,
            parseRetryAfter(response.headers.get('retry-after')),
          );
        }

        throw new Error(`${providerLabel} failed with ${response.status}: ${errorText.slice(0, 300)}`);
      }

      const responseBody: unknown = await response.json();

      if (!isRecord(responseBody)) {
        throw new Error(`${providerLabel} response envelope was not an object.`);
      }

      const data: GmsResponsesApiResponse = responseBody;

      if (data.status === 'incomplete') {
        throw new Error(`${providerLabel} response incomplete: ${extractIncompleteReason(data)}`);
      }

      const content = extractOutputText(data);
      const reasoningTokens = extractReasoningTokens(data);

      return {
        data: JSON.parse(extractJsonObject(content)) as T,
        ...(typeof data.id === 'string' && data.id.trim()
          ? { responseId: data.id.trim() }
          : {}),
        ...(typeof data.model === 'string' && data.model.trim()
          ? { model: data.model.trim() }
          : {}),
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      };
    }

    throw new Error(`${providerLabel} rejected every supported parameter combination for ${selectedModel}.`);
  };

  // 일시적 업스트림 오류는 지수 백오프로 되살린다. 파라미터 학습 루프와는 별개다.
  const attemptWithRetry = async (): Promise<ResponsesJsonResult<T>> => {
    for (let transientAttempt = 0; ; transientAttempt += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof TransientUpstreamError) || transientAttempt >= MAX_TRANSIENT_RETRIES) {
          throw error;
        }

        const waitMs = backoffDelayMs(transientAttempt, error.retryAfterMs);
        console.warn(
          `[responses] ${selectedModel} returned ${error.status}; retry ${transientAttempt + 1}/${MAX_TRANSIENT_RETRIES} in ${Math.round(waitMs)}ms.`,
        );
        await delay(waitMs, options.signal);
      }
    }
  };

  // 이 모델을 아직 한 번도 성공시키지 못했다면 이 호출이 프로브 역할을 한다.
  if (!unsupportedParamsByModel.has(selectedModel)) {
    let release: () => void = () => undefined;
    const probe = new Promise<void>((resolve) => {
      release = resolve;
    });
    capabilityProbeByModel.set(selectedModel, probe);

    try {
      const result = await attemptWithRetry();

      // 거부된 파라미터가 없었다는 사실도 학습 결과다.
      if (!unsupportedParamsByModel.has(selectedModel)) {
        unsupportedParamsByModel.set(selectedModel, new Set<string>());
      }

      return result;
    } finally {
      release();
      capabilityProbeByModel.delete(selectedModel);
    }
  }

  return attemptWithRetry();
}
