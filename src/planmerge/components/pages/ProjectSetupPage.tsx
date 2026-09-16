import { type FormEvent, useState } from 'react';
import { verifiedSampleSummary, type ProjectSettings } from '../../lib/localWorkspace';

type ProjectSetupPageProps = {
  project: ProjectSettings;
  onLoadSample: () => void;
  onSave: (project: ProjectSettings) => void;
};

const PROJECT_FIELD_LIMITS = {
  title: 120,
  goal: 2000,
  contextPack: 4000,
  forbiddenDirection: 2000,
  outputStyle: 1000,
} as const;

export function ProjectSetupPage({ project, onLoadSample, onSave }: ProjectSetupPageProps) {
  const [form, setForm] = useState(project);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const updateForm = (field: keyof ProjectSettings, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveProject = () => {
    onSave(form);
    setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
  };

  const submitProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveProject();
  };

  return (
    <main className="h-full min-h-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <section>
          <div className="mb-8">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">PlanMerge v0.1</div>
            <h2 className="text-2xl text-gray-900">새 병합 프로젝트 만들기</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
              같은 주제로 작성한 기획 초안들을 비교하고, 사용할 내용을 선택해 하나의 문서로 정리합니다.
              먼저 목표와 제외할 내용을 입력하세요. 분석 후에는 각 제안의 원문을 확인하고 선택을 바꿀 수 있습니다.
            </p>
          </div>

          <form className="space-y-6" onSubmit={submitProject}>
            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">프로젝트명</span>
              <input
                value={form.title}
                maxLength={PROJECT_FIELD_LIMITS.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="예: AI 공동 기획서 병합 도구"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">기획서 타입</span>
              <select
                value={form.documentType}
                onChange={(event) => updateForm('documentType', event.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="service_plan">서비스 기획서</option>
                <option value="prd">PRD</option>
                <option value="business_plan">사업 계획서</option>
                <option value="feature_spec">기능 명세서</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">기획서 목표</span>
              <textarea
                value={form.goal}
                maxLength={PROJECT_FIELD_LIMITS.goal}
                onChange={(event) => updateForm('goal', event.target.value)}
                placeholder="예: 여러 사람이 각자 AI로 만든 기획서 초안을 하나의 문서로 병합한다."
                className="min-h-24 w-full rounded-md border border-gray-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">공통 기준</span>
              <textarea
                value={form.contextPack}
                maxLength={PROJECT_FIELD_LIMITS.contextPack}
                onChange={(event) => updateForm('contextPack', event.target.value)}
                placeholder="예: MVP는 2주 안에 만들 수 있어야 한다. 초기에는 텍스트 붙여넣기 기반으로 한다."
                className="min-h-24 w-full rounded-md border border-gray-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">금지할 방향</span>
              <input
                value={form.forbiddenDirection}
                maxLength={PROJECT_FIELD_LIMITS.forbiddenDirection}
                onChange={(event) => updateForm('forbiddenDirection', event.target.value)}
                placeholder="예: 초기 MVP에 실시간 공동 편집, 외부 문서 연동, 팀 초대를 포함하지 않는다."
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-gray-700">원하는 출력 스타일</span>
              <input
                value={form.outputStyle}
                maxLength={PROJECT_FIELD_LIMITS.outputStyle}
                onChange={(event) => updateForm('outputStyle', event.target.value)}
                placeholder="예: 노션처럼 간결하고 읽기 쉬운 서비스 기획서 톤"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                설정 저장 후 초안 입력
              </button>
              <button
                type="button"
                className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                onClick={onLoadSample}
              >
                샘플 워크스페이스 둘러보기
              </button>
              {savedAt && <span className="text-xs text-gray-500">{savedAt} 저장됨</span>}
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="rounded-md border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500">검증 샘플</div>
                <h3 className="mt-1 text-base text-gray-900">{verifiedSampleSummary.title}</h3>
              </div>
              <div className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Ready</div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              회의록 기반 B2B SaaS 기획서를 13개 역할별 초안으로 구성했습니다.
              섹션 누락 없이 충돌 의견까지 확인할 수 있는 포폴용 기준 데이터입니다.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <SampleMetric label="AI 초안" value={`${verifiedSampleSummary.draftCount}개`} />
              <SampleMetric label="문서 섹션" value={`${verifiedSampleSummary.sectionCount}개`} />
              <SampleMetric label="충돌 의견" value={`${verifiedSampleSummary.conflictCount}개`} />
              <SampleMetric label="품질 점수" value={`${verifiedSampleSummary.qualityScore}`} />
            </div>

            <button
              type="button"
              className="mt-5 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
              onClick={onLoadSample}
            >
              검증 샘플 바로 열기
            </button>
          </section>

          <section className="rounded-md border border-gray-200 p-5">
            <div className="text-sm text-gray-900">분석 파이프라인</div>
            <div className="mt-4 space-y-3">
              <PipelineStep number="1" title="초안 정규화" description="서로 다른 AI 답변을 공통 섹션과 아이디어 타입으로 변환" />
              <PipelineStep number="2" title="Decision Block 생성" description="선택안, 대안, 충돌 의견을 출처 ID와 함께 묶음" />
              <PipelineStep number="3" title="Quality Gate" description="섹션 커버리지, 출처 추적, 선택 근거 품질을 검사" />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function SampleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-gray-200 pt-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg text-gray-900">{value}</div>
    </div>
  );
}

function PipelineStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-600">
        {number}
      </div>
      <div>
        <div className="text-sm text-gray-900">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>
      </div>
    </div>
  );
}
