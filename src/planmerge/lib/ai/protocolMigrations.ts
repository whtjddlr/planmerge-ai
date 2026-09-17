/**
 * 저장된 결과의 버전 올리기와, 서버가 소유하는 봉투·출처 필드.
 *
 * 마이그레이션은 유도할 수 있는 정보만 유도하고 날조해야 하는 정보는 포기한다
 * (AGENTS.md 규칙 6). `selectionSource`·`protocolVersion`·`source`는 모델이 아니라
 * 서버가 쓴다(규칙 11).
 */
import { isRecord } from './protocolInternals';
import type {
  DecisionSelectionSource,
  PlanMergeAnalysisResult,
  ProtocolDecisionBlock,
  ProtocolFinalDocumentSection,
} from './protocolTypes';

/**
 * 저장된 이전 버전 결과를 현재 프로토콜로 올린다.
 *
 * 버전이 오를 때마다 저장된 병합 결과를 버리면 사용자는 매번 다시 분석해야 한다.
 * 유도할 수 있는 정보는 유도하고, 날조해야 하는 정보만 포기한다.
 *
 * - v0.3 → v0.4: 섹션마다 `composedFrom`을 현재 블록의 `selectedOptionId`에서
 *   유도한다. 저장 시점에 본문과 선택안이 어긋나 있었는지는 알 수 없으므로
 *   일치한다고 본다 — 그래야 이후의 변경부터 낡음을 잡을 수 있다.
 * - v0.2 → v0.3: `selectionSource`를 기존 `selectionReason` 접두사에서 유도하고
 *   접두사를 벗긴다. 파싱이 렌더 시점이 아니라 로드 1회로 옮겨간다.
 * - v0.1 → : `forbiddenDirectionConflict`는 의미 판정이라 유도할 수 없다.
 *   없는 판정을 만들어 넣는 대신 그대로 두어 검증에서 떨어지게 한다.
 */
export function upgradeStoredAnalysisResult(value: unknown): unknown {
  return upgradeV03ToV04(upgradeV02ToV03(value));
}

function upgradeV03ToV04(value: unknown): unknown {
  if (
    !isRecord(value)
    || value.protocolVersion !== '0.3'
    || !Array.isArray(value.decisionBlocks)
    || !Array.isArray(value.finalDocumentSections)
  ) {
    return value;
  }

  const selectedByBlock = new Map<string, string>();

  value.decisionBlocks.forEach((block) => {
    if (isRecord(block) && typeof block.id === 'string' && typeof block.selectedOptionId === 'string') {
      selectedByBlock.set(block.id, block.selectedOptionId);
    }
  });

  return {
    ...value,
    protocolVersion: '0.4',
    finalDocumentSections: value.finalDocumentSections.map((section) => {
      if (!isRecord(section) || !Array.isArray(section.sourceDecisionBlockIds) || section.composedFrom !== undefined) {
        return section;
      }

      return {
        ...section,
        composedFrom: section.sourceDecisionBlockIds
          .filter((blockId): blockId is string => typeof blockId === 'string' && selectedByBlock.has(blockId))
          .map((blockId) => ({ decisionBlockId: blockId, selectedOptionId: selectedByBlock.get(blockId)! })),
      };
    }),
  };
}

function upgradeV02ToV03(value: unknown): unknown {
  if (!isRecord(value) || value.protocolVersion !== '0.2' || !Array.isArray(value.decisionBlocks)) {
    return value;
  }

  return {
    ...value,
    protocolVersion: '0.3',
    decisionBlocks: value.decisionBlocks.map((block) => {
      if (!isRecord(block)) {
        return block;
      }

      const reason = typeof block.selectionReason === 'string' ? block.selectionReason : '';
      const legacyConsensusPrefix = 'GPT-5.6 consensus:';

      if (reason.startsWith(legacyConsensusPrefix)) {
        return {
          ...block,
          selectionSource: 'decision_room' satisfies DecisionSelectionSource,
          selectionReason: reason.slice(legacyConsensusPrefix.length).trim(),
        };
      }

      if (reason.startsWith('사용자가 ')) {
        return { ...block, selectionSource: 'human' satisfies DecisionSelectionSource };
      }

      return { ...block, selectionSource: 'merge' satisfies DecisionSelectionSource };
    }),
  };
}

/** 섹션 본문을 쓸 때 어떤 선택안을 보고 썼는지 기록한다. */
export function composedFromBlocks(blocks: ProtocolDecisionBlock[]) {
  return blocks.map((block) => ({ decisionBlockId: block.id, selectedOptionId: block.selectedOptionId }));
}

/**
 * 본문이 현재 결정과 어긋나 있는가.
 *
 * 기록된 선택안과 지금 선택안이 다르거나, 근거 블록인데 기록이 없으면 낡았다.
 * `composedFrom` 자체가 없으면(v0.4 이전에 만들어져 마이그레이션도 거치지 않은
 * 결과) 알 수 없는 것이고, 알 수 없는 것을 낡았다고 표시하지 않는다.
 */
export function sectionIsStale(
  section: ProtocolFinalDocumentSection,
  blocks: ProtocolDecisionBlock[],
): boolean {
  if (!section.composedFrom) {
    return false;
  }

  const blocksById = new Map(blocks.map((block) => [block.id, block] as const));
  const recorded = new Map(section.composedFrom.map((entry) => [entry.decisionBlockId, entry.selectedOptionId] as const));

  return section.sourceDecisionBlockIds.some((blockId) => {
    const block = blocksById.get(blockId);

    if (!block) {
      return false;
    }

    return recorded.get(blockId) !== block.selectedOptionId;
  });
}

/**
 * 결과 봉투의 `protocolVersion`과 `source`를 서버가 찍는다.
 *
 * 둘 다 이 배포에 대한 사실이다 — 어떤 프로토콜로 검증하는가, 어느 제공자를 불렀는가.
 * 모델이 판단할 일이 아니고, 모델이 말하게 두면 틀리거나 빠진다. 실측: 복구 프롬프트가
 * "decisionBlocks와 warnings만 반환"하라고 하자 모델이 두 필드를 생략했고, 그 응답은
 * 결정 블록이 멀쩡해도 `protocolVersion must be 0.4`로 검증에서 떨어졌다. 그 전까지는
 * 모델이 우연히 echo해 준 값에 기대고 있었던 것이다. `ensureServerOwnedSelectionSource`와
 * 같은 원칙이다.
 */
export function ensureServerOwnedEnvelope(
  result: PlanMergeAnalysisResult,
  source: PlanMergeAnalysisResult['source'],
): PlanMergeAnalysisResult {
  if (result.protocolVersion === '0.4' && result.source === source) {
    return result;
  }

  return { ...result, protocolVersion: '0.4', source };
}

/**
 * 병합 모델이 돌려준 결정 블록에 서버가 출처를 기록한다.
 *
 * 모델은 이 필드를 쓸 수 없으므로(프롬프트 규칙 2a) 서버가 붙여야 한다.
 * 모델이 굳이 값을 넣어 보냈다면 무시하고 `merge`로 덮는다 — 자기가 한 결정을
 * 사람이 했다고 주장할 수 있으면 출처 추적이 무의미해진다.
 */
export function ensureServerOwnedSelectionSource(
  result: PlanMergeAnalysisResult,
): PlanMergeAnalysisResult {
  const needsFix = result.decisionBlocks.some((block) => block.selectionSource !== 'merge');

  if (!needsFix) {
    return result;
  }

  return {
    ...result,
    decisionBlocks: result.decisionBlocks.map((block) => ({ ...block, selectionSource: 'merge' })),
  };
}
