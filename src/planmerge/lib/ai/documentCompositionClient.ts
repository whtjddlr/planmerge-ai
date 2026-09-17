import { analysisAuthHeaders, loadAnalysisCredentials } from '../analysisKeyStore';
import type { LocalDraftSubmission, ProjectSettings } from '../localWorkspace';
import { AnalysisFailureError, createAnalysisFailure } from './planmergeAnalysisClient';
import type { PlanMergeAnalysisResult, ProtocolFinalDocumentSection } from './planmergeProtocol';

export type RecomposeSectionInput = {
  project: ProjectSettings;
  drafts: LocalDraftSubmission[];
  analysisResult: PlanMergeAnalysisResult;
  sectionKey: string;
};

/**
 * 결정이 바뀐 섹션의 본문을 모델이 다시 쓴다.
 *
 * 사람이 선택안을 바꾸거나 Decision Room이 여러 결정 중 하나를 고치면 본문은 이전
 * 선택안을 기준으로 쓰인 상태로 남는다. 서버는 그 본문을 고쳐 쓰지 않는다 — 산문을
 * 만드는 건 판단이고, 채택안 문장으로 덮어쓰면 같은 섹션의 다른 결정 내용이 사라진다.
 * 그래서 사용자가 누를 때 이 호출로 그 섹션 하나만 다시 쓴다.
 */
export async function recomposeDocumentSection(
  input: RecomposeSectionInput,
): Promise<ProtocolFinalDocumentSection> {
  let response: Response;

  try {
    response = await fetch('/api/document-sections/compose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...analysisAuthHeaders(loadAnalysisCredentials()),
      },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new AnalysisFailureError(
      'network_error',
      '문서 작성 서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      true,
      error instanceof Error ? error.message : undefined,
    );
  }

  if (!response.ok) {
    throw await createAnalysisFailure(response);
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new AnalysisFailureError('response_validation_failed', '문서 작성 응답이 올바른 JSON 형식이 아닙니다.', true);
  }

  if (!isRecord(body) || !isRecord(body.section) || typeof body.section.content !== 'string') {
    throw new AnalysisFailureError('response_validation_failed', '문서 작성 응답에 섹션이 없습니다.', true);
  }

  return body.section as unknown as ProtocolFinalDocumentSection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
