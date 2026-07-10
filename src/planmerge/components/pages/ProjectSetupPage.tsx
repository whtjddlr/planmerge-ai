import {
  ArrowRight,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Play,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
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

const documentTypeLabels: Record<ProjectSettings['documentType'], string> = {
  service_plan: '서비스 기획서',
  prd: 'PRD',
  business_plan: '사업 계획서',
  feature_spec: '기능 명세서',
};

export function ProjectSetupPage({ project, onLoadSample, onSave }: ProjectSetupPageProps) {
  const [form, setForm] = useState(project);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const filledCount = useMemo(
    () => [
      form.title,
      form.goal,
      form.contextPack,
      form.forbiddenDirection,
      form.outputStyle,
    ].filter((value) => value.trim()).length,
    [form],
  );
  const progress = Math.round((filledCount / 5) * 100);

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
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:py-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          data-testid="project-brief-panel"
          className="motion-panel overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
        >
          <div>
            <div className="relative overflow-hidden bg-slate-950 p-6 text-white sm:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-400 via-emerald-400 to-amber-300" />
              <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-md border border-white/14 bg-white/8 px-3 py-1 text-xs font-medium text-slate-200">
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    기획 기준 정리
                  </div>
                  <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
                    <span className="block">기준을 먼저 세우고</span>
                    <span className="block">AI 초안을 합칩니다.</span>
                  </h2>
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
                    목표, 공통 배경, 제외 범위가 모델 판단과 품질 검증에 함께 들어갑니다.
                    이 화면이 비어 있으면 결과도 설득력이 약해집니다.
                  </p>
                </div>

                <div className="space-y-3">
                  <ModelLane label="ChatGPT" tone="blue" />
                  <ModelLane label="Claude" tone="emerald" />
                  <ModelLane label="Gemini" tone="amber" />
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs lg:col-span-2">
                  <HeroStat label="완성도" value={`${progress}%`} />
                  <HeroStat label="입력" value={`${filledCount}/5`} />
                  <HeroStat label="출력" value={documentTypeLabels[form.documentType]} />
                </div>
              </div>
            </div>

            <form className="grid gap-5 p-5 sm:p-7" onSubmit={submitProject}>
              <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                <TextField
                  label="프로젝트명"
                  maxLength={PROJECT_FIELD_LIMITS.title}
                  onChange={(value) => updateForm('title', value)}
                  placeholder="예: PlanMerge 멀티 AI 기획 병합"
                  value={form.title}
                />
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">문서 타입</span>
                  <select
                    value={form.documentType}
                    onChange={(event) => updateForm('documentType', event.target.value)}
                    className="focus-ring h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="service_plan">서비스 기획서</option>
                    <option value="prd">PRD</option>
                    <option value="business_plan">사업 계획서</option>
                    <option value="feature_spec">기능 명세서</option>
                  </select>
                </label>
              </div>

              <TextAreaField
                label="기획 목표"
                maxLength={PROJECT_FIELD_LIMITS.goal}
                onChange={(value) => updateForm('goal', value)}
                placeholder="예: 여러 사람이 각자 AI로 만든 기획 초안을 하나의 검토 가능한 문서로 병합한다."
                value={form.goal}
              />

              <TextAreaField
                label="공통 배경"
                maxLength={PROJECT_FIELD_LIMITS.contextPack}
                onChange={(value) => updateForm('contextPack', value)}
                placeholder="예: 해커톤 데모와 3~5명 내부 파일럿이 목표이며, 출처 추적과 충돌 보존이 중요하다."
                value={form.contextPack}
              />

              <TextField
                label="금지 방향"
                maxLength={PROJECT_FIELD_LIMITS.forbiddenDirection}
                onChange={(value) => updateForm('forbiddenDirection', value)}
                placeholder="예: 초기 MVP에는 Slack, Notion, 결제, 실시간 공동 편집을 포함하지 않는다."
                value={form.forbiddenDirection}
              />

              <TextField
                label="원하는 출력 스타일"
                maxLength={PROJECT_FIELD_LIMITS.outputStyle}
                onChange={(value) => updateForm('outputStyle', value)}
                placeholder="예: 심사위원이 빠르게 읽을 수 있는 간결한 서비스 기획서"
                value={form.outputStyle}
              />

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  className="pulse-border inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  기준 저장 후 초안 입력
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="load-sample-workspace-button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  onClick={onLoadSample}
                >
                  <Play className="h-4 w-4" />
                  검증 샘플 열기
                </button>
                {savedAt && <span className="text-xs text-slate-500">{savedAt} 저장됨</span>}
              </div>
            </form>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="motion-panel-delay rounded-lg border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="h-4 w-4" />
                  검증 샘플
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-950">{verifiedSampleSummary.title}</h3>
              </div>
              <div className="whitespace-nowrap rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                시연 가능
              </div>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              13개 역할별 초안으로 구성된 샘플입니다. 출처 추적, 충돌 의견, 12개 문서 섹션을 바로 확인할 수 있습니다.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <SampleMetric icon={<FileText className="h-4 w-4" />} label="AI 초안" value={`${verifiedSampleSummary.draftCount}개`} />
              <SampleMetric icon={<ClipboardCheck className="h-4 w-4" />} label="문서 섹션" value={`${verifiedSampleSummary.sectionCount}개`} />
              <SampleMetric icon={<ShieldCheck className="h-4 w-4" />} label="충돌 의견" value={`${verifiedSampleSummary.conflictCount}개`} />
              <SampleMetric icon={<Sparkles className="h-4 w-4" />} label="품질 점수" value={`${verifiedSampleSummary.qualityScore}`} />
            </div>

            <button
              type="button"
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              onClick={onLoadSample}
            >
              샘플로 바로 시연하기
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>

          <section className="motion-panel-delay rounded-lg border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Workflow className="h-4 w-4 text-blue-600" />
              분석 파이프라인
            </div>
            <div className="mt-4 space-y-4">
              <PipelineStep number="1" title="기획 기준 정리" description="목표, 배경, 금지 방향이 모델 판단 기준이 됩니다." />
              <PipelineStep number="2" title="초안/PDF 수집" description="사람마다 다른 AI 결과물을 같은 형식으로 모읍니다." />
              <PipelineStep number="3" title="결정 근거 병합" description="선택안, 대안, 충돌안을 출처와 함께 묶습니다." />
              <PipelineStep number="4" title="품질 게이트 검증" description="섹션 누락, 출처 커버리지, 경고를 공개합니다." />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function TextField({
  label,
  maxLength,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="focus-ring h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
      />
    </label>
  );
}

function TextAreaField({
  label,
  maxLength,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="focus-ring min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm leading-7 text-slate-900 placeholder:text-slate-400"
      />
    </label>
  );
}

function ModelLane({ label, tone }: { label: string; tone: 'amber' | 'blue' | 'emerald' }) {
  const color = {
    amber: 'from-amber-300 to-orange-300',
    blue: 'from-blue-300 to-cyan-300',
    emerald: 'from-emerald-300 to-teal-300',
  }[tone];

  return (
    <div className="flex items-center gap-3">
      <div className="w-16 text-xs font-medium text-slate-300">{label}</div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`flow-line h-full rounded-full bg-gradient-to-r ${color}`} />
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/12 bg-white/8 p-3">
      <div className="text-slate-400">{label}</div>
      <div className="mt-1 truncate font-semibold text-white">{value}</div>
    </div>
  );
}

function SampleMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="lift-card rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
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
    <div className="grid grid-cols-[30px_1fr] gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-xs font-semibold text-white">
        {number}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-950">{title}</div>
        <p className="mt-1 text-xs leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}
