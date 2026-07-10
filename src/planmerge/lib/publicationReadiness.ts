import type { QualityLevel } from './analysisQuality';
import type { PlanMergeAnalysisResult, ProtocolDecisionBlock } from './ai/planmergeProtocol';

export type PublicationReadinessLevel = 'idle' | 'blocked' | 'review' | 'ready';

export type PublicationReadiness = {
  level: PublicationReadinessLevel;
  label: string;
  detail: string;
  canShare: boolean;
  reviewCompletion: number;
  requiredBlockIds: string[];
  approvedBlockIds: string[];
  unresolvedBlockIds: string[];
  requiredCount: number;
  approvedCount: number;
  unresolvedCount: number;
};

type EvaluatePublicationReadinessInput = {
  analysisResult?: PlanMergeAnalysisResult;
  approvedBlockIds?: string[];
  qualityLevel: QualityLevel | null;
};

export function isDecisionReviewRequired(block: ProtocolDecisionBlock) {
  return block.needsHumanReview || block.conflictLevel !== 'none' || block.confidence < 0.65;
}

export function evaluatePublicationReadiness({
  analysisResult,
  approvedBlockIds = [],
  qualityLevel,
}: EvaluatePublicationReadinessInput): PublicationReadiness {
  if (!analysisResult) {
    return createReadiness({
      level: 'idle',
      label: '검증 대기',
      detail: '병합 분석을 실행하면 공유 준비 상태를 확인할 수 있습니다.',
      requiredBlockIds: [],
      approvedBlockIds: [],
      unresolvedBlockIds: [],
    });
  }

  const blocksById = new Map(analysisResult.decisionBlocks.map((block) => [block.id, block]));
  const approvedSet = new Set(approvedBlockIds.filter((blockId) => blocksById.has(blockId)));
  const currentlyRequiredIds = analysisResult.decisionBlocks
    .filter(isDecisionReviewRequired)
    .map((block) => block.id);
  const requiredSet = new Set([...currentlyRequiredIds, ...approvedSet]);
  const unresolvedBlockIds = currentlyRequiredIds.filter((blockId) => !approvedSet.has(blockId));
  const requiredBlockIds = [...requiredSet];
  const approvedRequiredIds = requiredBlockIds.filter((blockId) => approvedSet.has(blockId));

  if (qualityLevel === 'blocked') {
    return createReadiness({
      level: 'blocked',
      label: '사용 보류',
      detail: '문서 구조 또는 근거 품질이 차단 상태입니다. 분석 검토에서 오류를 먼저 해결해야 합니다.',
      requiredBlockIds,
      approvedBlockIds: approvedRequiredIds,
      unresolvedBlockIds,
    });
  }

  if (qualityLevel === 'review') {
    return createReadiness({
      level: 'review',
      label: '공유 보류',
      detail: unresolvedBlockIds.length
        ? `문서 품질 보완과 결정 검토 ${unresolvedBlockIds.length}건이 남아 있습니다.`
        : '문서 품질 보완 항목이 남아 있습니다. 분석 검토에서 누락 또는 출처 반영 상태를 확인하세요.',
      requiredBlockIds,
      approvedBlockIds: approvedRequiredIds,
      unresolvedBlockIds,
    });
  }

  if (unresolvedBlockIds.length > 0) {
    return createReadiness({
      level: 'review',
      label: '공유 보류',
      detail: `사람이 확인해야 할 결정 ${unresolvedBlockIds.length}건이 남아 있습니다. 선택안과 충돌안을 비교한 뒤 승인하세요.`,
      requiredBlockIds,
      approvedBlockIds: approvedRequiredIds,
      unresolvedBlockIds,
    });
  }

  return createReadiness({
    level: 'ready',
    label: '공유 가능',
    detail: '문서 품질과 필수 결정 검토가 완료됐습니다. 최종본을 내보내거나 공유할 수 있습니다.',
    requiredBlockIds,
    approvedBlockIds: approvedRequiredIds,
    unresolvedBlockIds,
  });
}

function createReadiness({
  level,
  label,
  detail,
  requiredBlockIds,
  approvedBlockIds,
  unresolvedBlockIds,
}: {
  level: PublicationReadinessLevel;
  label: string;
  detail: string;
  requiredBlockIds: string[];
  approvedBlockIds: string[];
  unresolvedBlockIds: string[];
}): PublicationReadiness {
  const requiredCount = requiredBlockIds.length;
  const approvedCount = approvedBlockIds.length;

  return {
    level,
    label,
    detail,
    canShare: level === 'ready',
    reviewCompletion: requiredCount > 0 ? Math.round((approvedCount / requiredCount) * 100) : 100,
    requiredBlockIds,
    approvedBlockIds,
    unresolvedBlockIds,
    requiredCount,
    approvedCount,
    unresolvedCount: unresolvedBlockIds.length,
  };
}
