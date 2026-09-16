/**
 * 사용자 API 키의 브라우저 보관소.
 *
 * 키는 이 브라우저의 localStorage에만 있고, 분석을 요청할 때 헤더로 실려 나간다.
 * 서버는 그 요청을 처리하는 동안만 쓰고 저장하지 않는다. 공유 워크스페이스 스냅샷,
 * 내보내기 파일, 어떤 DB에도 들어가지 않는다.
 *
 * 저장된 값은 절대 화면에 그대로 보여주지 않는다. 마스킹한 형태만 노출한다.
 */
import {
  ANALYSIS_KEY_HEADER,
  ANALYSIS_MODEL_HEADER,
  looksLikeModelId,
  looksLikeOpenAiKey,
} from './ai/analysisCredentials';

const STORAGE_KEY = 'planmerge_analysis_credentials_v1';

export type StoredAnalysisCredentials = {
  apiKey: string;
  model: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadAnalysisCredentials(): StoredAnalysisCredentials | null {
  if (typeof window === 'undefined') {
    return null;
  }

  let raw: string | null;

  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // 사생활 보호 모드나 저장소 차단 환경에서는 접근 자체가 던질 수 있다.
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      !isRecord(parsed) ||
      typeof parsed.apiKey !== 'string' ||
      typeof parsed.model !== 'string' ||
      !looksLikeOpenAiKey(parsed.apiKey) ||
      !looksLikeModelId(parsed.model)
    ) {
      return null;
    }

    return { apiKey: parsed.apiKey, model: parsed.model };
  } catch {
    return null;
  }
}

export function saveAnalysisCredentials(credentials: StoredAnalysisCredentials) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // 저장에 실패해도 이번 세션 동안은 메모리 상태로 동작한다.
  }
}

export function clearAnalysisCredentials() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 지우지 못해도 호출자는 상태를 비운다.
  }
}

/** 화면 표시용. 키 본문은 드러내지 않는다. */
export function maskApiKey(apiKey: string) {
  if (apiKey.length <= 12) {
    return '***';
  }

  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

/**
 * 분석 요청에 붙일 헤더.
 * 서버에 키가 설정돼 있으면 서버 키가 우선하므로 이 헤더는 무시된다.
 */
export function analysisAuthHeaders(
  credentials: StoredAnalysisCredentials | null,
): Record<string, string> {
  if (!credentials) {
    return {};
  }

  return {
    [ANALYSIS_KEY_HEADER]: credentials.apiKey,
    [ANALYSIS_MODEL_HEADER]: credentials.model,
  };
}

export type KeyVerificationOutcome =
  | { ok: true; model: string; availableCount: number }
  | { ok: false; message: string };

/** 서버를 거쳐 키를 검증한다. 브라우저에서 OpenAI를 직접 부르지 않는다. */
export async function verifyAnalysisKey(apiKey: string): Promise<KeyVerificationOutcome> {
  let response: Response;

  try {
    response = await fetch('/api/analysis-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
  } catch {
    return { ok: false, message: '서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.' };
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const errors = isRecord(body) && Array.isArray(body.errors)
      ? body.errors.filter((error): error is string => typeof error === 'string')
      : [];

    return { ok: false, message: errors[0] ?? '키를 확인하지 못했습니다.' };
  }

  if (!isRecord(body) || typeof body.model !== 'string') {
    return { ok: false, message: '서버 응답을 이해하지 못했습니다.' };
  }

  return {
    ok: true,
    model: body.model,
    availableCount: typeof body.availableCount === 'number' ? body.availableCount : 0,
  };
}

export async function fetchServerAnalysisStatus() {
  try {
    const response = await fetch('/api/analysis-config');

    if (!response.ok) {
      return { serverConfigured: false };
    }

    const body: unknown = await response.json();

    return {
      serverConfigured: isRecord(body) && body.serverConfigured === true,
    };
  } catch {
    return { serverConfigured: false };
  }
}
