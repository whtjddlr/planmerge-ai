export type SectionStatus = 'completed' | 'review' | 'conflict' | 'pending';
export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger';

export type DocumentSectionData = {
  number: number;
  sectionKey?: string;
  title: string;
  content: string;
  status: SectionStatus;
  decisionTrace?: DecisionTrace;
  // 한 섹션에 Decision Block이 여러 개일 때 전체 목록. decisionTrace는 대표(첫 번째) 블록.
  decisionTraces?: DecisionTrace[];
  /**
   * 이 섹션의 선택안이 프로젝트 금지 방향을 제안하고 있는가.
   *
   * 충돌 의견이 남아 있는 것과는 다른 상태다. 충돌은 "고르지 못한 것"이고 이것은
   * "고른 것이 기준을 어긴 것"이다. Review Queue가 둘을 구분해 안내해야 한다.
   */
  violatesForbiddenDirection?: boolean;
  /**
   * 본문이 이전 선택안을 기준으로 쓰여 있어 갱신이 필요한가.
   * `ProtocolFinalDocumentSection.composedFrom`과 현재 결정을 비교해 파생한다.
   */
  stale?: boolean;
};

export type DecisionSource = {
  authorName: string;
  aiModel: string;
  sourceDraftId?: string;
  sourceIdeaId?: string;
  taskTitle?: string;
  sourceExcerpt?: string;
};

export type DecisionOpinion = {
  optionId?: string;
  title: string;
  description: string;
  sources: DecisionSource[];
  severity?: 'low' | 'medium' | 'high';
};

export type AnonymousOpinion = {
  id: string;
  content: string;
  createdAtLabel: string;
  anonymousKey?: string;
};

export type DecisionTrace = {
  decisionBlockId: string;
  selectedOptionId?: string;
  sectionNumber: number;
  sectionTitle: string;
  topic: string;
  badges: {
    label: string;
    variant: BadgeVariant;
  }[];
  selectedContent: string;
  selectionReason: string;
  selectedSources?: DecisionSource[];
  alternatives: DecisionOpinion[];
  conflicts: DecisionOpinion[];
  opinions: AnonymousOpinion[];
};

/**
 * 섹션에 붙일 결정 trace. 실제 Decision Block이 없으면 "없다"고만 말한다.
 *
 * 예전에는 여기 시연용 고정 trace 5개가 있었고, 그것도 없으면 섹션 본문을
 * "자동 선택"으로 포장해 "여러 초안에서 의미가 유사한 내용을 묶어 정리했습니다"라는
 * 근거를 붙였다. 둘 다 서버가 지어낸 말이다. 결정이 없는 섹션은 결정이 없다고
 * 보여야 한다 — 이유를 추측해서 적으면(초안이 부족했다 등) 그것도 날조다.
 */
export function getDecisionTrace(section: DocumentSectionData): DecisionTrace {
  if (section.decisionTrace) {
    return section.decisionTrace;
  }

  return {
    decisionBlockId: `decision-block-section-${section.number}`,
    sectionNumber: section.number,
    sectionTitle: section.title,
    topic: '결정 없음',
    badges: [{ label: '결정 없음', variant: 'default' }],
    selectedContent: '이 섹션에 대응하는 Decision Block이 없습니다.',
    selectionReason: '분석 결과에 이 섹션의 결정이 포함되지 않았습니다. 초안을 보강하거나 다시 분석하면 채워질 수 있습니다.',
    alternatives: [],
    conflicts: [],
    opinions: [],
  };
}
