/**
 * 분석 502의 사유 코드.
 *
 * 502 본문은 "분석에 실패했습니다" 한 줄이었다. 업스트림 오류 본문을 노출하지 않는 건
 * 맞지만(게이트웨이 내부 정보가 섞인다, 규칙 4), 그 결과 사용자는 "모델이 흔들렸으니
 * 다시 누르면 된다"와 "내 입력이 문제다"를 구분할 수 없었다. 실측에서 502의 대부분은
 * 복구 응답이 검증에 떨어진 모델 편차였고, 재시도로 풀렸다.
 *
 * 그래서 서버가 **자기가 만든 오류 메시지**를 보고 사유를 고른다. 업스트림 텍스트를
 * 그대로 내보내지 않고, 우리가 통제하는 enum만 나간다. 안내 문구는 화면 쪽 사전이다.
 */

export type AnalysisFailureReason =
  | 'normalize_invalid'
  | 'repair_invalid'
  | 'upstream_transient'
  | 'upstream_timeout'
  | 'upstream_rejected'
  | 'response_incomplete'
  | 'unknown';

export const analysisFailureReasons: readonly AnalysisFailureReason[] = [
  'normalize_invalid',
  'repair_invalid',
  'upstream_transient',
  'upstream_timeout',
  'upstream_rejected',
  'response_incomplete',
  'unknown',
];

/** 라우트가 던진 오류를 사유로 분류한다. 메시지 접두사는 전부 이 리포가 만든 것이다. */
export function classifyAnalysisFailure(error: unknown): AnalysisFailureReason {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  // fetch의 AbortSignal.timeout이 던진다. 실측: 5회 중 1회가 호출 한 건이 120초를 넘겨 여기로 왔다.
  if (name === 'TimeoutError' || name === 'AbortError') return 'upstream_timeout';
  if (name === 'TransientUpstreamError') return 'upstream_transient';
  if (message.startsWith('Normalize validation failed')) return 'normalize_invalid';
  if (message.startsWith('Repair validation failed')) return 'repair_invalid';
  if (/response incomplete/.test(message)) return 'response_incomplete';
  if (/failed with 4\d\d/.test(message) || /rejected every supported parameter/.test(message)) return 'upstream_rejected';

  return 'unknown';
}

export function isAnalysisFailureReason(value: unknown): value is AnalysisFailureReason {
  return typeof value === 'string' && (analysisFailureReasons as readonly string[]).includes(value);
}

/** 사유별로 사용자가 다음에 할 수 있는 일. 'unknown'은 안내가 없다 — 지어내지 않는다. */
export const analysisFailureHints: Record<Exclude<AnalysisFailureReason, 'unknown'>, string> = {
  repair_invalid:
    '모델이 결정 구조를 다시 세우지 못했습니다. 입력 문제가 아니라 모델 편차인 경우가 대부분이어서, 다시 시도하면 보통 성공합니다.',
  normalize_invalid:
    '초안 하나의 정규화 결과가 검증을 통과하지 못했습니다. 다시 시도해 보고, 반복되면 너무 짧거나 형식이 특이한 초안이 있는지 확인해 주세요.',
  upstream_transient:
    '모델 제공자가 일시적으로 응답하지 못했습니다(요청 한도 또는 서버 오류). 잠시 후 다시 시도해 주세요.',
  upstream_timeout:
    '모델 호출 한 건이 120초 안에 끝나지 않았습니다. 모델 쪽 지연이라 다시 시도하면 보통 성공합니다. 반복되면 초안 수를 줄여 보세요.',
  upstream_rejected:
    '모델 제공자가 요청을 거절했습니다. API 키의 권한과 모델 접근 범위를 확인해 주세요.',
  response_incomplete:
    '모델 응답이 출력 한도에서 잘렸습니다. 초안 수를 줄이거나 다시 시도해 주세요.',
};

export function analysisFailureHint(reason: unknown): string | undefined {
  if (!isAnalysisFailureReason(reason) || reason === 'unknown') {
    return undefined;
  }

  return analysisFailureHints[reason];
}
