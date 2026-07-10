import { AlertTriangle, ClipboardCheck, FileText, GitMerge, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import { DocumentSection } from './DocumentSection';
import { StatusBadge } from './StatusBadge';
import { sections as defaultSections, type DocumentSectionData } from '../data/mergeResult';
import type { LocalDraftSubmission, ProjectSettings } from '../lib/localWorkspace';
import { evaluateAnalysisQuality } from '../lib/analysisQuality';
import type { AnalysisQualityReport, QualityLevel, QualityMetric } from '../lib/analysisQuality';
import type { PlanMergeAnalysisResult } from '../lib/ai/planmergeProtocol';
import type { PublicationReadiness } from '../lib/publicationReadiness';

type DocumentContentProps = {
  activeSection: number;
  analysisResult?: PlanMergeAnalysisResult;
  documentSections?: DocumentSectionData[];
  approvedBlockIds: string[];
  drafts: LocalDraftSubmission[];
  onSectionSelect: (sectionNumber: number) => void;
  project: ProjectSettings;
  publicationReadiness: PublicationReadiness;
};

const documentTypeLabels: Record<ProjectSettings['documentType'], string> = {
  service_plan: '서비스 기획서',
  prd: 'PRD',
  business_plan: '사업 계획서',
  feature_spec: '기능 명세서',
};

export function DocumentContent({
  activeSection,
  analysisResult,
  approvedBlockIds,
  documentSections = defaultSections,
  drafts,
  onSectionSelect,
  project,
  publicationReadiness,
}: DocumentContentProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeSectionRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledSectionRef = useRef(activeSection);
  const qualityReport = useMemo(() => {
    if (!analysisResult) {
      return undefined;
    }

    return evaluateAnalysisQuality({ project, drafts }, analysisResult, approvedBlockIds);
  }, [analysisResult, approvedBlockIds, drafts, project]);
  const documentTitle = formatDocumentTitle(project.title, documentTypeLabels[project.documentType]);

  useLayoutEffect(() => {
    if (lastScrolledSectionRef.current === activeSection) {
      return;
    }
    lastScrolledSectionRef.current = activeSection;

    const container = scrollContainerRef.current;
    const activeNode = activeSectionRef.current;

    if (!container || !activeNode) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeNode.getBoundingClientRect();
    const targetScrollTop =
      container.scrollTop +
      activeRect.top -
      containerRect.top -
      (container.clientHeight - activeRect.height) / 2;

    container.scrollTop = Math.max(targetScrollTop, 0);
  }, [activeSection]);

  return (
    <div ref={scrollContainerRef} className="min-w-0 flex-1 xl:h-full xl:min-h-0 xl:overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        <header className="motion-panel mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="border-b border-slate-100 bg-slate-950 p-4 text-white sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-md border border-white/14 bg-white/8 px-3 py-1 text-xs font-medium text-slate-200">
                  <FileText className="h-3.5 w-3.5 text-emerald-300" />
                  병합 기획서
                </div>
                <h1 className="mt-3 text-xl font-semibold leading-tight text-white sm:text-2xl">
                  {documentTitle}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  여러 AI 초안에서 선택안, 대안, 충돌 근거를 보존해 만든 검토 가능한 산출물입니다.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <DocumentHeroStat label="타입" value={documentTypeLabels[project.documentType]} />
                <DocumentHeroStat label="검토 완료" value={`${publicationReadiness.approvedCount}/${publicationReadiness.requiredCount}`} />
                <DocumentHeroStat label="남은 검토" value={`${publicationReadiness.unresolvedCount}개`} />
              </div>
            </div>
          </div>
          <div className="grid gap-3 p-4 text-sm text-slate-600 lg:grid-cols-[1fr_1fr]">
            <HeaderFact icon={<Target className="h-4 w-4" />} label="기준" value={summarizeCriteria(project.contextPack)} />
            <HeaderFact icon={<ShieldCheck className="h-4 w-4" />} label="출처" value={`${drafts.length}개 초안 기반`} />
          </div>
        </header>

        {analysisResult && qualityReport && (
          <>
            <OutputReadinessPanel
              analysisResult={analysisResult}
              documentSections={documentSections}
              drafts={drafts}
              publicationReadiness={publicationReadiness}
              qualityReport={qualityReport}
            />
            <AnalysisQualityStrip
              analysisResult={analysisResult}
              qualityReport={qualityReport}
            />
          </>
        )}

        <div className="space-y-3">
          {documentSections.map((section) => (
            <div
              key={section.number}
              ref={activeSection === section.number ? activeSectionRef : null}
            >
              <DocumentSection
                number={section.number}
                title={section.title}
                content={section.content}
                status={displaySectionStatus(section, publicationReadiness)}
                active={activeSection === section.number}
                onClick={() => onSectionSelect(section.number)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OutputReadinessPanel({
  analysisResult,
  documentSections,
  drafts,
  publicationReadiness,
  qualityReport,
}: {
  analysisResult: PlanMergeAnalysisResult;
  documentSections: DocumentSectionData[];
  drafts: LocalDraftSubmission[];
  publicationReadiness: PublicationReadiness;
  qualityReport: AnalysisQualityReport;
}) {
  const completedSections = documentSections.filter((section) => section.content.trim()).length;

  return (
    <section className="mb-5 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-950">출력 요약</h2>
              <StatusBadge variant={publicationBadgeVariant(publicationReadiness.level)}>
                {publicationReadiness.label}
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              {drafts.length}개 초안에서 {analysisResult.normalizedIdeas.length}개 아이디어를 추출했고,
              {analysisResult.decisionBlocks.length}개 결정 근거로 최종 문서를 구성했습니다.
              {' '}{publicationReadiness.detail}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <OutputMetric label="문서 품질" value={`${qualityReport.score}점`} />
          <OutputMetric label="완성 섹션" value={`${completedSections}/${documentSections.length}`} />
          <OutputMetric label="검토 완료" value={`${publicationReadiness.approvedCount}/${publicationReadiness.requiredCount}`} />
          <OutputMetric label="남은 결정" value={`${publicationReadiness.unresolvedCount}개`} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
          <GitMerge className="h-4 w-4 text-emerald-600" />
          공유 전 체크
        </div>
        <div className="divide-y divide-slate-100 text-sm leading-6 text-slate-600">
          <OutputChecklistItem done={completedSections === documentSections.length}>
            비어 있는 문서 섹션 보강
          </OutputChecklistItem>
          <OutputChecklistItem done={qualityReport.level === 'ready'}>
            문서 품질 게이트 통과
          </OutputChecklistItem>
          <OutputChecklistItem done={publicationReadiness.unresolvedCount === 0}>
            필수 결정 검토와 승인
          </OutputChecklistItem>
        </div>
      </div>
    </section>
  );
}

function OutputMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function OutputChecklistItem({ children, done }: { children: ReactNode; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span>{children}</span>
      <StatusBadge variant={done ? 'success' : 'warning'}>
        {done ? '완료' : '남음'}
      </StatusBadge>
    </div>
  );
}

function AnalysisQualityStrip({
  analysisResult,
  qualityReport,
}: {
  analysisResult: PlanMergeAnalysisResult;
  qualityReport: AnalysisQualityReport;
}) {
  const sectionCoverage = metricById(qualityReport.metrics, 'section_coverage');
  const sourceCoverage = metricById(qualityReport.metrics, 'source_coverage');
  const traceability = metricById(qualityReport.metrics, 'option_traceability');
  const primaryAction = qualityReport.nextActions[0];

  return (
    <section className="sticky top-3 z-10 mb-5 rounded-lg border border-slate-200 bg-white/96 px-4 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.09)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              문서 품질
            </span>
            <StatusBadge variant={qualityBadgeVariant(qualityReport.level)}>
              {qualityLevelLabel(qualityReport.level)}
            </StatusBadge>
            <StatusBadge variant={analysisResult.source === 'local_harness' ? 'warning' : 'success'}>
              {analysisSourceLabel(analysisResult.source)}
            </StatusBadge>
          </div>
          <div className="text-2xl font-semibold text-slate-950">{qualityReport.score}점</div>
          <p className="mt-1 max-w-2xl text-sm leading-7 text-slate-600">{qualityReport.summary}</p>
          {primaryAction && (
            <p className="mt-2 flex items-start gap-2 text-xs leading-6 text-slate-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
              다음 조치: {primaryAction.title} - {primaryAction.expectedImpact}
            </p>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-3 gap-3 lg:min-w-80">
          <QualityMiniMetric label="섹션" metric={sectionCoverage} />
          <QualityMiniMetric label="출처" metric={sourceCoverage} />
          <QualityMiniMetric label="추적성" metric={traceability} />
        </div>
      </div>
    </section>
  );
}

function QualityMiniMetric({
  label,
  metric,
}: {
  label: string;
  metric?: QualityMetric;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">
        {metric ? `${metric.value}/${metric.total}` : '-'}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-slate-950 via-blue-600 to-emerald-500"
          style={{ width: `${metric?.score ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function DocumentHeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20 rounded-lg border border-white/12 bg-white/8 p-3">
      <div className="text-slate-400">{label}</div>
      <div className="mt-1 truncate font-semibold text-white">{value}</div>
    </div>
  );
}

function HeaderFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-slate-400">{icon}</span>
      <span className="font-medium text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-slate-800">{value}</span>
    </div>
  );
}

function formatDocumentTitle(title: string, documentTypeLabel: string) {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    return `새 프로젝트 ${documentTypeLabel}`;
  }

  if (trimmedTitle.endsWith('기획')) {
    return `${trimmedTitle}서`;
  }

  if (
    trimmedTitle.endsWith(documentTypeLabel) ||
    trimmedTitle.endsWith('기획서') ||
    trimmedTitle.endsWith('계획서') ||
    trimmedTitle.endsWith('명세서') ||
    trimmedTitle.endsWith('PRD')
  ) {
    return trimmedTitle;
  }

  return `${trimmedTitle} ${documentTypeLabel}`;
}

function metricById(metrics: QualityMetric[], id: string) {
  return metrics.find((metric) => metric.id === id);
}

function qualityBadgeVariant(level: QualityLevel) {
  if (level === 'ready') {
    return 'success';
  }

  if (level === 'review') {
    return 'warning';
  }

  return 'danger';
}

function qualityLevelLabel(level: QualityLevel) {
  if (level === 'ready') {
    return '양호';
  }

  if (level === 'review') {
    return '보완 필요';
  }

  return '차단';
}

function publicationBadgeVariant(level: PublicationReadiness['level']) {
  if (level === 'ready') return 'success';
  if (level === 'blocked') return 'danger';
  return 'warning';
}

function displaySectionStatus(
  section: DocumentSectionData,
  publicationReadiness: PublicationReadiness,
): DocumentSectionData['status'] {
  if (section.status === 'pending') {
    return section.status;
  }

  const traces = section.decisionTraces?.length
    ? section.decisionTraces
    : section.decisionTrace
      ? [section.decisionTrace]
      : [];
  const requiredBlockIds = new Set(publicationReadiness.requiredBlockIds);
  const unresolvedBlockIds = new Set(publicationReadiness.unresolvedBlockIds);
  const sectionRequiredIds = traces
    .map((trace) => trace.decisionBlockId)
    .filter((blockId) => requiredBlockIds.has(blockId));

  if (sectionRequiredIds.length > 0 && sectionRequiredIds.every((blockId) => !unresolvedBlockIds.has(blockId))) {
    return 'completed';
  }

  return section.status;
}

function analysisSourceLabel(source: PlanMergeAnalysisResult['source']) {
  if (source === 'gms') {
    return 'GMS';
  }

  if (source === 'gemini') {
    return 'Gemini';
  }

  if (source === 'solar') {
    return 'Solar';
  }

  return '로컬 검증';
}

function summarizeCriteria(contextPack: string) {
  const firstLine = contextPack
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return '기준 없음';
  }

  return firstLine.length > 46 ? `${firstLine.slice(0, 46)}...` : firstLine;
}
