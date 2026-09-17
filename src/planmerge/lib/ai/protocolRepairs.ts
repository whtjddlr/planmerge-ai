/**
 * 서버 보정 — 모델 출력의 형식 오류를 결정적으로 고치는 순수 함수들.
 *
 * 되돌리기·라벨 교정·ID 오타 복구·파생값만 한다. "어떤 의견이 한 결정인가",
 * "무엇이 충돌인가"는 판단이라 여기서 하지 않는다(AGENTS.md 규칙 3).
 */
import { sectionKeys } from './protocolInternals';
import type {
  NormalizedIdea,
  PlanMergeAnalysisResult,
  ProtocolDecisionBlock,
} from './protocolTypes';

/**
 * 배치 판정 호출로 메울 수 있는 누락의 상한(비율).
 *
 * merge가 아이디어 몇 개를 빠뜨리는 건 흔하다. 실측(루나 7회)에서 깨끗한 실행조차
 * 20개 중 2개를 인용하지 않았다. 그 규모는 `buildIdeaPlacementPrompt`로 모델에
 * 되물어 메운다 — 입력이 작아 merge를 다시 돌리는 것보다 훨씬 싸다.
 *
 * 하지만 누락이 절반을 넘으면 그건 몇 개 빠진 게 아니라 **merge가 실패한 것**이다.
 * 실측에서 모델이 스스로 "모든 sourceIdeaIds 연결을 제거했다"는 경고를 쓴 응답이
 * 3회 나왔다. 그때 아이디어 전부를 배치 판정으로 메우면 merge를 배치 호출로
 * 대신하는 셈이고, 그 호출은 블록 요약만 보기 때문에 전체 구조를 볼 수 없다.
 * 그런 응답은 repair 프롬프트로 다시 만들게 하고, 그것도 실패하면 `502`다(규칙 4).
 *
 * 이 상한이 없을 때 서버가 룰로 배치했고, 결과는 블록 20~24개가 전부 옵션 1개,
 * **충돌 0**이었다. 스키마는 완벽해서 검증기가 통과시키고 Quality Gate도 못 잡는다 —
 * 충돌 0은 "이견이 없었다"와 구분되지 않는다.
 */
export const PLACEMENT_RECOVERABLE_IDEA_LIMIT = 0.5;

/** 누락 규모가 배치 판정으로 메울 수 있는 선을 넘었는가. */
export function exceedsPlacementRecoveryLimit(unplacedIdeaCount: number, ideaCount: number): boolean {
  return ideaCount > 0 && unplacedIdeaCount > ideaCount * PLACEMENT_RECOVERABLE_IDEA_LIMIT;
}

/**
 * 결정 블록의 구조 오류를 서버가 고친다.
 *
 * 실측(루나 merge 5회)에서 나온 실패 두 종류를 다룬다. 둘 다 판단이 아니라 라벨이라
 * repair 프롬프트로 merge급 호출을 한 번 더 낼 이유가 없다.
 *
 * - `must include exactly one selected option`: `selectedOptionId`가 가리키는 옵션을
 *   `selected`로 만들고 나머지는 `alternative`로 내린다. **어느 옵션을 채택했는지는
 *   바꾸지 않는다** — 모델이 고른 것을 그대로 두고 타입 표기만 맞춘다.
 * - `has invalid sectionKey`: 되돌릴 방법이 없으므로 블록을 버린다. 그러면 그
 *   아이디어들이 "인용 안 됨"이 되어 `ensureDecisionBlockCoverage`가 아이디어의
 *   실제 `sectionKey`로 블록을 다시 세운다.
 */
export function ensureDecisionBlockShape(result: PlanMergeAnalysisResult): PlanMergeAnalysisResult {
  let retypedCount = 0;
  let droppedBlockCount = 0;
  let promotedConflictCount = 0;

  const decisionBlocks = result.decisionBlocks
    .filter((block) => {
      if (sectionKeys.has(block.sectionKey)) {
        return true;
      }

      droppedBlockCount += 1;
      return false;
    })
    .map((block) => {
      const selectedCount = block.options.filter((option) => option.optionType === 'selected').length;
      const pointsAtSelected = block.options.some((option) => (
        option.id === block.selectedOptionId && option.optionType === 'selected'
      ));

      if (selectedCount === 1 && pointsAtSelected) {
        return block;
      }

      // selectedOptionId가 아무 옵션도 가리키지 않으면 어느 것을 채택했는지 알 수 없다.
      // 그 블록은 ensureOptionsCiteKnownIdeas와 같은 이유로 버려 재건 대상이 된다.
      if (!block.options.some((option) => option.id === block.selectedOptionId)) {
        droppedBlockCount += 1;
        return undefined;
      }

      retypedCount += 1;

      // selectedOptionId가 충돌 옵션을 가리키는 자기모순 출력도 있다. 이때 블록을
      // 버려 재건하면 ensureDecisionBlockCoverage가 금지 아닌 아이디어를 골라서
      // "모델이 모순을 냈다"는 사실 자체가 사라진다. 그래서 모델의 선택을 그대로
      // 두고 별도 경고를 남긴다. 금지 방향 위반은 optionType이 아니라 아이디어
      // 판정으로 판단하므로(규칙 9) Quality Gate가 그대로 차단한다.
      if (block.options.some((option) => (
        option.id === block.selectedOptionId && option.optionType === 'conflict'
      ))) {
        promotedConflictCount += 1;
      }

      return {
        ...block,
        options: block.options.map((option) => (
          option.id === block.selectedOptionId
            ? { ...option, optionType: 'selected' as const, severity: undefined }
            : option.optionType === 'selected'
              ? { ...option, optionType: 'alternative' as const }
              : option
        )),
      };
    })
    .filter((block): block is ProtocolDecisionBlock => block !== undefined);

  if (!retypedCount && !droppedBlockCount && !promotedConflictCount) {
    return result;
  }

  const notes: string[] = [];

  if (retypedCount) {
    notes.push(`${retypedCount}개 결정의 선택안 표기를 selectedOptionId에 맞춰 교정했습니다.`);
  }

  if (promotedConflictCount) {
    notes.push(`${promotedConflictCount}개 결정은 모델이 충돌 의견을 선택안으로 지정했습니다. 기준 위반 여부는 Quality Gate에서 확인해 주세요.`);
  }

  if (droppedBlockCount) {
    notes.push(`${droppedBlockCount}개 결정은 섹션이나 선택안을 확정할 수 없어 제거하고 검증된 아이디어로 다시 세웁니다.`);
  }

  return {
    ...result,
    decisionBlocks,
    warnings: [...result.warnings, ...notes],
  };
}

/**
 * 옵션이 실존하지 않는 아이디어 ID를 인용했을 때 서버가 고친다.
 *
 * 관측된 실패는 판단이 아니라 형식이었다: `draft-jihun_idea_idea_1` — 실제 ID
 * `draft-jihun_idea_1`에 `_idea`가 한 번 더 붙은 것. 이걸 만나면 라우트는 repair
 * 프롬프트로 merge급 호출을 한 번 더 내는데, 서버가 결정적으로 고칠 수 있는 것을
 * 토큰으로 사는 셈이다.
 *
 * **추측하지 않는다.** 반복된 `_idea` 구간을 접어서 실존 ID와 정확히 일치할 때만
 * 받아들인다. 그 외에는 해당 ID를 지운다 — 엉뚱한 작성자에게 의견을 귀속시키는 것은
 * 출처 추적 도구에서 옵션을 잃는 것보다 나쁘다.
 *
 * 인용이 전부 사라진 옵션은 제거하고, 선택안이 사라졌다면 뒤따르는
 * `ensureDecisionBlockCoverage`가 canonical 아이디어로 블록을 다시 세운다.
 */
export function ensureOptionsCiteKnownIdeas(
  result: PlanMergeAnalysisResult,
  normalizedIdeas: NormalizedIdea[],
): PlanMergeAnalysisResult {
  const knownIds = new Set(normalizedIdeas.map((idea) => idea.id));
  let repairedCount = 0;
  let droppedIdCount = 0;
  let droppedOptionCount = 0;
  let droppedBlockCount = 0;

  /**
   * 형식만 고친다. 실존 ID와 정확히 일치하지 않으면 포기한다.
   *
   * 관측된 오류는 구간이 한 번 더 붙는 형태였다(`..._idea_idea_1`). 밑줄로 자른 뒤
   * 인접한 중복 토큰을 접어 실존 ID가 되는지만 본다. 다른 어떤 추론도 하지 않는다.
   */
  const resolveId = (ideaId: string) => {
    if (knownIds.has(ideaId)) {
      return ideaId;
    }

    const collapsed = ideaId
      .split('_')
      .filter((token, index, tokens) => index === 0 || token !== tokens[index - 1])
      .join('_');

    if (collapsed !== ideaId && knownIds.has(collapsed)) {
      repairedCount += 1;
      return collapsed;
    }

    droppedIdCount += 1;
    return undefined;
  };

  const decisionBlocks = result.decisionBlocks
    .map((block) => {
      const options = block.options
        .map((option) => {
          const sourceIdeaIds = (option.sourceIdeaIds ?? [])
            .map(resolveId)
            .filter((ideaId): ideaId is string => ideaId !== undefined);

          return { ...option, sourceIdeaIds };
        })
        .filter((option) => {
          if (option.sourceIdeaIds.length) {
            return true;
          }

          droppedOptionCount += 1;
          return false;
        });

      return { ...block, options };
    })
    // 옵션이 없거나 선택안을 잃은 블록은 여기서 버린다.
    //
    // 남겨 두면 "옵션이 없다" / "selectedOptionId가 옵션과 맞지 않는다"로 검증이
    // 더 크게 깨진다. 대안을 선택안으로 승격시키는 방법도 있지만 그건 서버가
    // 조용히 기획 내용을 바꾸는 것이라 하지 않는다.
    //
    // 버리면 그 아이디어들이 다시 "인용 안 됨" 상태가 되고, 뒤따르는
    // ensureDecisionBlockCoverage가 canonical 아이디어로 블록을 새로 세운다.
    .filter((block) => {
      const keptSelected = block.options.some((option) => option.id === block.selectedOptionId);

      if (block.options.length && keptSelected) {
        return true;
      }

      droppedBlockCount += 1;
      return false;
    });

  if (!repairedCount && !droppedIdCount && !droppedOptionCount && !droppedBlockCount) {
    return result;
  }

  const notes: string[] = [];

  if (repairedCount) {
    notes.push(`${repairedCount}개 출처 ID의 형식 오류를 서버에서 교정했습니다.`);
  }

  if (droppedIdCount) {
    notes.push(`${droppedIdCount}개 출처 ID는 실존하지 않아 제거했습니다.`);
  }

  if (droppedOptionCount) {
    notes.push(`${droppedOptionCount}개 옵션은 근거가 남지 않아 제거했습니다.`);
  }

  if (droppedBlockCount) {
    notes.push(`${droppedBlockCount}개 결정은 근거가 남지 않아 제거하고 검증된 아이디어로 다시 세웁니다.`);
  }

  return {
    ...result,
    decisionBlocks,
    warnings: [...result.warnings, ...notes],
  };
}

/**
 * 선택안이 가정·질문에만 기대고 있으면 사람 검토 대상으로 표시한다.
 *
 * confidence는 "초안에 그렇게 쓰여 있는가"를 재지 "그 판단이 확인됐는가"를 재지 않는다.
 * 한 줄짜리 추측을 충실히 옮기면 confidence는 높게 나오면서 needsHumanReview는 false가
 * 될 수 있다. 출처 추적이 핵심인 도구에서 확인되지 않은 가정 위의 결정이 확정된 것처럼
 * 보이면 안 되므로, 모델 판단과 무관하게 서버가 보장한다.
 */
export function ensureAssumptionBackedBlocksAreReviewed(
  result: PlanMergeAnalysisResult,
): PlanMergeAnalysisResult {
  const ideasById = new Map(result.normalizedIdeas.map((idea) => [idea.id, idea]));
  let flaggedCount = 0;

  const decisionBlocks = result.decisionBlocks.map((block) => {
    if (block.needsHumanReview) {
      return block;
    }

    const selected = block.options.find((option) => option.id === block.selectedOptionId);
    const sourceIdeas = (selected?.sourceIdeaIds ?? [])
      .map((ideaId) => ideasById.get(ideaId))
      .filter((idea): idea is NormalizedIdea => Boolean(idea));

    if (!sourceIdeas.length) {
      return block;
    }

    const restsOnlyOnAssumptions = sourceIdeas.every(
      (idea) => idea.intent === 'assume' || idea.intent === 'question',
    );

    if (!restsOnlyOnAssumptions) {
      return block;
    }

    flaggedCount += 1;

    return { ...block, needsHumanReview: true };
  });

  if (!flaggedCount) {
    return result;
  }

  return {
    ...result,
    decisionBlocks,
    warnings: [
      ...result.warnings,
      `${flaggedCount}개 결정은 확인되지 않은 가정에만 근거해 사람 검토 대상으로 표시했습니다.`,
    ],
  };
}

/**
 * 금지 방향 충돌 여부. 정규화 단계에서 모델이 내린 판정을 읽을 뿐 다시 판단하지 않는다.
 * 서버 복구 경로와 Decision Room 안전 게이트가 모두 이 함수를 쓰므로, 한 아이디어는
 * 어느 단계에서 보든 같은 판정을 받는다.
 */
export function conflictsWithForbiddenDirection(idea: NormalizedIdea) {
  // 리스크 경고는 "그 방향으로 가면 위험하다"는 말이므로 금지 방향 제안이 아니다.
  if (idea.intent === 'warn') {
    return false;
  }

  // 세 로드 경로가 모두 검증을 거치므로 판정이 없는 아이디어는 화면까지 오지 않는다.
  // 그래도 옵셔널 체이닝으로 읽는다. 판정이 없다는 것이 "충돌 아님"을 뜻하지는 않지만,
  // 여기서 true를 돌려주면 근거 없이 위반이라고 주장하게 된다. 판정 누락 자체는
  // Quality Gate가 별도 항목으로 잡는다.
  return idea.forbiddenDirectionConflict?.conflicts === true;
}

/** 프로토콜 v0.2 판정이 실제로 들어 있는가. 버전 이전 데이터를 가려낸다. */
export function hasForbiddenDirectionJudgement(idea: NormalizedIdea) {
  return typeof idea.forbiddenDirectionConflict?.conflicts === 'boolean';
}
