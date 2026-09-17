/**
 * 분석 실행 전에 보여줄 비용 안내.
 *
 * 사용자 키(BYOK)로 돌 수 있으므로 누르기 전에 무엇이 청구될지 알려야 한다. 그런데
 * 토큰 수는 미리 알 수 없다 — 모델이 얼마나 길게 답할지, 배치·복구가 붙을지는 실행해
 * 봐야 안다. 추정치를 숫자로 내놓으면 그 숫자가 화면에서 실측처럼 읽힌다(규칙 8).
 *
 * 그래서 결정적으로 아는 것만 말한다.
 * - 호출 수: 파이프라인 구조에서 나온다. 초안 수만큼 정규화 + 병합 1 + 문서 작성 1,
 *   필요할 때 배치 판정·복구가 각 1회.
 * - 직전 실행의 실측 사용량: 서버가 헤더로 준 실제 값. 워크스페이스에 저장해 새로고침
 *   뒤에도 남는다.
 * - 어느 키로 실행되는가: 서버 키인지 이 브라우저의 내 키인지.
 */

export type StoredAnalysisUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  calls: number;
};

export type AnalysisKeySource = 'server' | 'request' | 'none';

export function estimateAnalysisCalls(draftCount: number) {
  const drafts = Math.max(0, Math.floor(draftCount));

  return {
    min: drafts + 2,
    max: drafts + 4,
    steps: [
      { label: '정규화', calls: `${drafts}` },
      { label: '병합', calls: '1' },
      { label: '문서 작성', calls: '1' },
      { label: '배치 판정', calls: '0~1' },
      { label: '복구', calls: '0~1' },
    ],
  };
}

/** 저장된 값이 깨져 있으면 버린다. 사용량 하나 때문에 워크스페이스를 잃지 않는다. */
export function sanitizeStoredAnalysisUsage(value: unknown): StoredAnalysisUsage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const read = (field: unknown) => (
    typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : undefined
  );
  const inputTokens = read(record.inputTokens);
  const outputTokens = read(record.outputTokens);
  const reasoningTokens = read(record.reasoningTokens);
  const calls = read(record.calls);

  if (inputTokens === undefined || outputTokens === undefined || reasoningTokens === undefined || calls === undefined) {
    return undefined;
  }

  return { inputTokens, outputTokens, reasoningTokens, calls };
}

export function describeAnalysisCost(input: {
  draftCount: number;
  lastUsage?: StoredAnalysisUsage | null;
  keySource: AnalysisKeySource;
}): string[] {
  const drafts = Math.max(0, Math.floor(input.draftCount));
  const { min, max } = estimateAnalysisCalls(drafts);
  const lines = [
    `모델 호출 ${min}~${max}회 예상 — 초안 ${drafts}개 정규화 + 병합 1 + 문서 작성 1, 필요할 때 배치 판정·복구 각 1회`,
  ];

  if (input.lastUsage && input.lastUsage.calls > 0) {
    const total = (input.lastUsage.inputTokens + input.lastUsage.outputTokens).toLocaleString('ko-KR');
    const inputTokens = input.lastUsage.inputTokens.toLocaleString('ko-KR');
    const outputTokens = input.lastUsage.outputTokens.toLocaleString('ko-KR');

    lines.push(`직전 실행 실측: 호출 ${input.lastUsage.calls}회, 토큰 ${total} (입력 ${inputTokens} / 출력 ${outputTokens})`);
  } else {
    lines.push('토큰 사용량은 실행이 끝난 뒤 실측으로 표시합니다. 미리 추정하지 않습니다.');
  }

  if (input.keySource === 'request') {
    lines.push('이 브라우저에 저장된 내 API 키로 실행됩니다. 비용은 그 키의 계정에 청구됩니다.');
  } else if (input.keySource === 'server') {
    lines.push('서버에 설정된 키로 실행됩니다.');
  } else {
    lines.push('실행할 API 키가 없습니다. 키를 등록해야 분석할 수 있습니다.');
  }

  return lines;
}
