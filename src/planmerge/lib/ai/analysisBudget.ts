/**
 * 분석 파이프라인의 시간 예산.
 *
 * 한때 모든 모델 호출이 똑같이 120초를 받았고, 타임아웃은 재시도 대상이 아니었다
 * (재시도는 408/409/425/429/5xx만). 그래서 호출 한 건이 느리면 분석 전체가 실패했다 —
 * 실측 5회 중 1회가 이 경로였는데(초안 7개, `reason: upstream_timeout`), 같은 조건의
 * 성공 실행이 쓴 시간은 80초였다. 라우트의 `maxDuration`은 300초다. 남은 시간이 200초
 * 넘게 있는데 포기한 것이다.
 *
 * 그래서 예산을 단계별로 나눈다. 한 호출의 제한 시간은 **이 단계의 상한**과 **남은
 * 시간에서 뒤에 반드시 올 단계들의 몫(reserve)을 뺀 값** 중 작은 쪽이다. merge는 앞이
 * 빨랐으면 120초보다 더 받고, 뒤가 빠듯하면 덜 받는다.
 *
 * 그리고 deadline이 있으므로 타임아웃 재시도를 **남은 시간이 한 번 더 부를 만큼 있을
 * 때만** 한다. "상한을 올릴까 / 재시도를 붙일까"는 `maxDuration`과 맞바꾸는 판단처럼
 * 보였지만, deadline을 들고 다니면 실행 시점에 아는 사실로 정해진다 — 넘길 위험 없이
 * 남은 시간을 쓴다.
 *
 * 예산을 넘겨 부르지 않는 것 자체가 목적이기도 하다. 플랫폼이 함수를 끊으면 응답이
 * 없고, 사용자는 사유(`upstream_timeout` 등)도 진행 단계도 받지 못한다 — 규칙 4가
 * 요구하는 정직한 실패가 아니라 그냥 끊긴 연결이다.
 */

export type AnalysisStage = 'normalize' | 'merge' | 'placement' | 'compose' | 'repair';

/**
 * `maxDuration` 300초에서 요청 파싱·검증·응답 직렬화 몫을 뺀 파이프라인 예산.
 *
 * 검증은 동기 함수라 빠르지만(수기 검증기), 마지막 호출이 deadline에 딱 맞춰 끝나면
 * 그 뒤에 할 일이 남는다. 30초는 그 여유다.
 */
export const PIPELINE_BUDGET_MS = 270_000;

/** 이보다 짧은 제한 시간은 주지 않는다 — 어차피 못 끝낼 호출에 토큰을 쓰는 셈이다. */
export const MIN_CALL_TIMEOUT_MS = 20_000;

/**
 * 단계별 상한과, 이 단계 뒤에 반드시 올 단계들에 남겨 둘 시간.
 *
 * reserve는 "나 다음에 뭐가 오는가"다. normalize 뒤에는 merge와 문서 작성이 반드시
 * 오고(130초), merge 뒤에는 문서 작성이 온다(70초 — 배치 판정이 끼어들 수 있다).
 * 문서 작성은 마지막이라 0이고, 블록 단위 복구 뒤에는 본문을 다시 쓰므로 60초다.
 *
 * 상한은 실측에서 왔다. 초안 7개 성공 실행이 전체 80초/11호출이었고, normalize는
 * 병렬이라 벽시계로는 가장 느린 한 건이다 — 그 한 건에 110초를 주면 넉넉하다. merge는
 * 입력 13k·출력 최대 32k로 가장 큰 호출이어서 상한을 180초로 올렸다: 120초에서 죽던
 * 호출이 여기서 60초를 더 받는다.
 */
const stageCallBudget: Record<AnalysisStage, { cap: number; reserve: number }> = {
  normalize: { cap: 110_000, reserve: 130_000 },
  merge: { cap: 180_000, reserve: 70_000 },
  placement: { cap: 90_000, reserve: 60_000 },
  compose: { cap: 120_000, reserve: 0 },
  repair: { cap: 120_000, reserve: 60_000 },
};

export type CallBudget = {
  timeoutMs: number;
  deadlineAt: number;
};

/** 순수 함수라 회귀 케이스가 직접 부른다. 남은 시간이 넉넉하면 상한, 빠듯하면 그 몫. */
export function stageCallTimeoutMs(stage: AnalysisStage, remainingMs: number): number {
  const { cap, reserve } = stageCallBudget[stage];

  return Math.max(MIN_CALL_TIMEOUT_MS, Math.min(cap, remainingMs - reserve));
}

export type AnalysisBudget = {
  /** 이 시각 이후로는 새 호출을 내지 않는다. */
  readonly deadlineAt: number;
  remainingMs: () => number;
  forStage: (stage: AnalysisStage) => CallBudget;
};

export function createAnalysisBudget(
  startedAt: number = Date.now(),
  budgetMs: number = PIPELINE_BUDGET_MS,
): AnalysisBudget {
  const deadlineAt = startedAt + budgetMs;

  return {
    deadlineAt,
    remainingMs: () => deadlineAt - Date.now(),
    forStage: (stage) => ({
      timeoutMs: stageCallTimeoutMs(stage, deadlineAt - Date.now()),
      deadlineAt,
    }),
  };
}
