export type SectionStatus = 'completed' | 'review' | 'conflict' | 'pending';
export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger';

export type DocumentSectionData = {
  number: number;
  sectionKey?: string;
  title: string;
  content: string;
  status: SectionStatus;
  decisionTrace?: DecisionTrace;
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

export const sections: DocumentSectionData[] = [
  {
    number: 1,
    title: '개요',
    content: 'PlanMerge는 여러 명이 각자 AI로 작성한 기획 초안을 하나로 병합하고, 어떤 아이디어가 선택되었고 어떤 의견이 충돌하는지 투명하게 보여주는 협업 도구다.',
    status: 'completed',
  },
  {
    number: 2,
    title: '문제 정의',
    content: '팀원들이 각자 AI 도구로 기획서를 작성하면, 중복·상충되는 내용을 수작업으로 정리해야 하고, 누구의 의견이 반영되었는지 추적하기 어렵다.',
    status: 'completed',
  },
  {
    number: 3,
    title: '타깃 사용자',
    content: 'AI 도구를 활용해 기획·제안서를 작성하는 2~5인 규모 프로젝트팀',
    status: 'completed',
  },
  {
    number: 4,
    title: '사용자 Pain Point',
    content: '초안 병합에 시간이 많이 들고, 누구 의견이 반영됐는지 불명확하며, 충돌 지점을 찾기 어렵다.',
    status: 'completed',
  },
  {
    number: 5,
    title: '솔루션',
    content: 'AI가 여러 초안을 비교·분석해 최종안을 제시하고, 각 선택의 근거와 대안, 충돌 의견을 섹션별로 보여준다.',
    status: 'completed',
  },
  {
    number: 6,
    title: '핵심 기능',
    content: '초안 텍스트 붙여넣기, AI 기반 섹션별 병합, 선택 근거 및 대안 표시, 충돌 의견 하이라이트',
    status: 'completed',
  },
  {
    number: 7,
    title: 'MVP 범위',
    content: '초기 MVP는 여러 AI 초안을 붙여넣고, 섹션별로 아이디어를 추출한 뒤, 최종 기획서와 선택 근거를 함께 보여주는 범위로 제한한다. 외부 문서 연동, 실시간 공동 편집, 팀 초대 기능은 이후 단계에서 검토한다.',
    status: 'review',
  },
  {
    number: 8,
    title: '사용자 플로우',
    content: '프로젝트 생성 → 초안 붙여넣기 → AI 분석 실행 → 병합 결과 확인 → 섹션별 선택 검토 → 최종안 승인 → 내보내기',
    status: 'completed',
  },
  {
    number: 9,
    title: '요구사항',
    content: '',
    status: 'pending',
  },
  {
    number: 10,
    title: '성공 지표',
    content: '',
    status: 'pending',
  },
  {
    number: 11,
    title: '리스크',
    content: '',
    status: 'conflict',
  },
  {
    number: 12,
    title: '미결정 사항',
    content: '',
    status: 'pending',
  },
];

export const decisionTraces: Record<number, DecisionTrace> = {
  1: {
    decisionBlockId: 'decision-block-overview',
    sectionNumber: 1,
    sectionTitle: '개요',
    topic: '서비스 정의',
    badges: [{ label: '자동 선택', variant: 'success' }],
    selectedContent: '여러 AI 초안을 하나의 기획서로 병합하면서 선택 근거와 제외된 의견을 함께 보여주는 도구로 정의한다.',
    selectionReason: '세 초안 모두 최종 문서 생성보다 선택 과정의 투명성을 핵심 가치로 제안했습니다.',
    alternatives: [],
    conflicts: [],
    // 데모용 가짜 익명 의견은 실제 사용자 의견과 섞여 저장·AI 요약되므로 시드하지 않는다.
    opinions: [],
  },
  2: {
    decisionBlockId: 'decision-block-problem',
    sectionNumber: 2,
    sectionTitle: '문제 정의',
    topic: '초안 병합 문제',
    badges: [{ label: '자동 선택', variant: 'success' }],
    selectedContent: 'AI로 작성한 여러 초안 사이의 중복, 누락, 충돌을 수작업으로 정리해야 하는 문제를 해결한다.',
    selectionReason: '초안 간 충돌을 찾는 비용과 반영 근거 추적의 어려움이 반복적으로 등장했습니다.',
    alternatives: [
      {
        title: '최종 기획서 품질 문제를 중심으로 정의하자',
        description: '병합 과정보다 완성 문서의 품질 개선을 문제로 강조',
        sources: [{ authorName: '민수', aiModel: 'ChatGPT' }],
      },
    ],
    conflicts: [],
    opinions: [],
  },
  6: {
    decisionBlockId: 'decision-block-core-features',
    sectionNumber: 6,
    sectionTitle: '핵심 기능',
    topic: '초기 핵심 기능',
    badges: [{ label: '자동 선택', variant: 'success' }],
    selectedContent: '초안 입력, 섹션별 아이디어 추출, 선택 근거 표시, 충돌 의견 하이라이트를 핵심 기능으로 둔다.',
    selectionReason: '기능 제안 중 Decision Trace를 직접 강화하는 항목만 초기 핵심 기능으로 정리했습니다.',
    alternatives: [
      {
        title: '문서 내보내기를 핵심 기능으로 올리자',
        description: '검토 이후 결과 활용성을 더 강조',
        sources: [{ authorName: '지현', aiModel: 'Claude' }],
      },
    ],
    conflicts: [],
    opinions: [],
  },
  7: {
    decisionBlockId: 'decision-block-mvp-scope',
    sectionNumber: 7,
    sectionTitle: 'MVP 범위',
    topic: '초기 기능 범위',
    badges: [
      { label: '검토 필요', variant: 'warning' },
      { label: '충돌 높음', variant: 'warning' },
    ],
    selectedContent: '텍스트 붙여넣기, AI 병합 분석, 선택 근거 표시, 최종 기획서 초안 생성까지만 포함한다.',
    selectionReason: '초기 검증 목표는 병합 기능의 유용성을 확인하는 것이므로, 외부 연동이나 공동 편집보다 핵심 병합 흐름을 먼저 검증하는 것이 적절합니다.',
    alternatives: [
      {
        title: 'Notion 연동까지 포함하자',
        description: '외부 문서 도구 연동을 초기 범위에 포함',
        sources: [{ authorName: '지현', aiModel: 'Claude' }],
      },
      {
        title: 'Slack 공유 기능을 넣자',
        description: '결과 공유 기능을 MVP에 포함',
        sources: [{ authorName: '민수', aiModel: 'ChatGPT' }],
      },
    ],
    conflicts: [
      {
        title: '실시간 공동 편집 기능까지 포함하자',
        description: 'MVP 개발 범위를 크게 확장하고, 병합 검증보다 협업 편집 구현에 리소스가 이동함',
        severity: 'high',
        sources: [{ authorName: '현우', aiModel: 'Gemini' }],
      },
    ],
    opinions: [],
  },
  11: {
    decisionBlockId: 'decision-block-risk',
    sectionNumber: 11,
    sectionTitle: '리스크',
    topic: 'AI 판단 신뢰성',
    badges: [
      { label: '충돌 있음', variant: 'warning' },
      { label: '검토 필요', variant: 'warning' },
    ],
    selectedContent: 'AI가 원문에 없는 출처나 근거를 만들어내지 않도록 모든 선택지를 추출 아이디어와 원문 발췌에 연결한다.',
    selectionReason: 'PlanMerge의 신뢰는 최종 문서보다 출처 추적에 의해 결정되므로, 출처 없는 선택안은 MVP에서 허용하지 않는 방향이 적절합니다.',
    alternatives: [
      {
        title: 'AI 판단 품질을 사용자가 수동으로 검토하게 하자',
        description: '자동 검증보다 사용자 리뷰 플로우를 우선',
        sources: [{ authorName: '민수', aiModel: 'ChatGPT' }],
      },
    ],
    conflicts: [
      {
        title: '빠른 MVP를 위해 출처 연결은 나중에 하자',
        description: '핵심 신뢰 장치가 빠져 제품 차별점 검증이 어려워짐',
        severity: 'medium',
        sources: [{ authorName: '현우', aiModel: 'Gemini' }],
      },
    ],
    opinions: [],
  },
};

export function getDecisionTrace(section: DocumentSectionData): DecisionTrace {
  if (section.decisionTrace) {
    return section.decisionTrace;
  }

  const trace = decisionTraces[section.number];

  if (trace) {
    return trace;
  }

  if (!section.content) {
    return {
      decisionBlockId: `decision-block-section-${section.number}`,
      sectionNumber: section.number,
      sectionTitle: section.title,
      topic: '추가 작성 필요',
      badges: [{ label: '내용 없음', variant: 'default' }],
      selectedContent: '아직 이 섹션의 최종 선택안이 생성되지 않았습니다.',
      selectionReason: '제출된 초안에서 이 섹션에 대응하는 충분한 아이디어가 발견되지 않았습니다.',
      alternatives: [],
      conflicts: [],
      opinions: [],
    };
  }

  return {
    decisionBlockId: `decision-block-section-${section.number}`,
    sectionNumber: section.number,
    sectionTitle: section.title,
    topic: '섹션 요약',
    badges: [{ label: '자동 선택', variant: 'success' }],
    selectedContent: section.content,
    selectionReason: '여러 초안에서 의미가 유사한 내용을 묶어 최종 섹션 문장으로 정리했습니다.',
    alternatives: [],
    conflicts: [],
    opinions: [],
  };
}
