/**
 * 분석 자격증명 해석.
 *
 * 키는 두 곳에서 올 수 있다.
 *
 * 1. 서버 환경변수 — 운영자가 배포에 심어 둔 키. 항상 우선한다.
 * 2. 요청 헤더 — 사용자가 브라우저에 보관한 자기 키(BYOK).
 *
 * 2번 키는 **서버에 저장하지 않는다.** 그 요청을 처리하는 동안 메모리에만 있고,
 * 로그·DB·응답 어디에도 남기지 않는다. 웹에서 받은 키를 서버 `.env`에 쓰는 설계는
 * 방문자 누구나 배포 전체의 자격증명을 덮어쓸 수 있다는 뜻이라 쓰지 않는다.
 */

export const ANALYSIS_KEY_HEADER = 'x-planmerge-openai-key';
export const ANALYSIS_MODEL_HEADER = 'x-planmerge-openai-model';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * 분석·Decision Room에 쓸 모델 선호 순서.
 * 키가 접근할 수 있는 것 중 첫 번째를 고른다. CLI 셋업과 앱 내 셋업이 같은 목록을 쓴다.
 */
export const ANALYSIS_MODEL_PREFERENCE = [
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5',
  'gpt-4.1',
] as const;

/** 형식 검사. 통과한다고 유효한 키라는 뜻은 아니고, 명백한 오입력을 거를 뿐이다. */
export function looksLikeOpenAiKey(value: string) {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(value);
}

/** 모델 ID로 쓸 수 있는 형태인지. 헤더로 들어오므로 그대로 믿지 않는다. */
export function looksLikeModelId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

export function selectAnalysisModel(available: ReadonlySet<string>) {
  return ANALYSIS_MODEL_PREFERENCE.find((model) => available.has(model));
}

export type RequestAnalysisCredentials = {
  apiKey: string;
  model?: string;
};

/**
 * 요청 헤더에서 사용자 키를 읽는다. 형식이 맞지 않으면 없는 것으로 취급한다.
 * 값은 절대 로그에 남기지 않는다.
 */
export function readRequestCredentials(request: Request): RequestAnalysisCredentials | undefined {
  const apiKey = request.headers.get(ANALYSIS_KEY_HEADER)?.trim();

  if (!apiKey || !looksLikeOpenAiKey(apiKey)) {
    return undefined;
  }

  const model = request.headers.get(ANALYSIS_MODEL_HEADER)?.trim();

  return {
    apiKey,
    ...(model && looksLikeModelId(model) ? { model } : {}),
  };
}

type ModelListResponse = { data?: Array<{ id?: unknown }> };

export type KeyVerificationResult =
  | { ok: true; model: string; availableCount: number }
  | { ok: false; reason: 'rejected' | 'no_models' | 'no_supported_model' | 'unreachable' };

/** 키가 실제로 동작하는지 확인하고, 쓸 수 있는 모델을 고른다. */
export async function verifyOpenAiKey(apiKey: string): Promise<KeyVerificationResult> {
  let response: Response;

  try {
    response = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'rejected' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'unreachable' };
  }

  const body = await response.json().catch(() => undefined) as ModelListResponse | undefined;
  const available = new Set(
    (body?.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string'),
  );

  if (!available.size) {
    return { ok: false, reason: 'no_models' };
  }

  const model = selectAnalysisModel(available);

  if (!model) {
    return { ok: false, reason: 'no_supported_model' };
  }

  return { ok: true, model, availableCount: available.size };
}
