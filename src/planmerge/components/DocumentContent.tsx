import { useLayoutEffect, useMemo, useRef } from 'react';
import { DocumentSection } from './DocumentSection';
import { StatusBadge } from './StatusBadge';
import { sections as defaultSections, type DocumentSectionData } from '../data/mergeResult';
import type { LocalDraftSubmission, ProjectSettings } from '../lib/localWorkspace';
import { evaluateAnalysisQuality } from '../lib/analysisQuality';
import type { AnalysisQualityReport, QualityLevel, QualityMetric } from '../lib/analysisQuality';
import type { PlanMergeAnalysisResult } from '../lib/ai/planmergeProtocol';

type DocumentContentProps = {
  activeSection: number;
  analysisResult?: PlanMergeAnalysisResult;
  documentSections?: DocumentSectionData[];
  drafts: LocalDraftSubmission[];
  onSectionSelect: (sectionNumber: number) => void;
  project: ProjectSettings;
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
  documentSections = defaultSections,
  drafts,
  onSectionSelect,
  project,
}: DocumentContentProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeSectionRef = useRef<HTMLDivElement | null>(null);
  const conflictCount = analysisResult
    ? analysisResult.decisionBlocks.filter((block) => block.conflictLevel !== 'none').length
    : documentSections.filter((section) => section.status === 'conflict').length;
  const reviewCount = analysisResult
    ? analysisResult.decisionBlocks.filter((block) => block.needsHumanReview).length
    : documentSections.filter((section) => section.status === 'review').length;
  const qualityReport = useMemo(() => {
    if (!analysisResult) {
      return undefined;
    }

    return evaluateAnalysisQuality({ project, drafts }, analysisResult);
  }, [analysisResult, drafts, project]);

  useLayoutEffect(() => {
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
    <div ref={scrollContainerRef} className="flex-1 min-w-0 bg-white xl:h-full xl:min-h-0 xl:overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-8">
          <h1 className="text-2xl text-gray-900 mb-4">{project.title.trim() || '새 프로젝트'} 기획서</h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 sm:gap-4">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">문서 타입:</span>
              <span>{documentTypeLabels[project.documentType]}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">기준:</span>
              <span>{summarizeCriteria(project.contextPack)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">충돌:</span>
              <StatusBadge variant={conflictCount > 0 ? 'danger' : 'default'}>{conflictCount}개</StatusBadge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">검토 필요:</span>
              <StatusBadge variant={reviewCount > 0 ? 'warning' : 'default'}>{reviewCount}개</StatusBadge>
            </div>
          </div>
        </div>

        {analysisResult && qualityReport && (
          <AnalysisQualityStrip
            analysisResult={analysisResult}
            qualityReport={qualityReport}
          />
        )}

        <div className="border-t border-gray-200">
          {documentSections.map((section) => (
            <div
              key={section.number}
              ref={activeSection === section.number ? activeSectionRef : null}
              className="border-b border-gray-100"
            >
              <DocumentSection
                number={section.number}
                title={section.title}
                content={section.content}
                status={section.status}
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
  const unresolvedDecisionCount = analysisResult.decisionBlocks.filter(
    (block) => block.needsHumanReview || block.conflictLevel !== 'none',
  ).length;

  return (
    <section className="sticky top-0 z-10 mb-6 rounded-md border border-gray-200 bg-white/95 px-4 py-4 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Evidence Quality</span>
            <StatusBadge variant={qualityBadgeVariant(qualityReport.level)}>
              {qualityLevelLabel(qualityReport.level)}
            </StatusBadge>
            <StatusBadge variant={unresolvedDecisionCount > 0 ? 'danger' : 'success'}>
              {unresolvedDecisionCount > 0
                ? `Decision Blocked · ${unresolvedDecisionCount}`
                : 'Decision Ready'}
            </StatusBadge>
            <StatusBadge variant={analysisResult.source === 'local_harness' ? 'warning' : 'success'}>
              {analysisSourceLabel(analysisResult.source)}
            </StatusBadge>
          </div>
          <div className="text-lg text-gray-900">Evidence score {qualityReport.score}</div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">{qualityReport.summary}</p>
          {primaryAction && (
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              다음 조치: {primaryAction.title} — {primaryAction.expectedImpact}
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
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-sm text-gray-900">
        {metric ? `${metric.value}/${metric.total}` : '-'}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-gray-900"
          style={{ width: `${metric?.score ?? 0}%` }}
        />
      </div>
    </div>
  );
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
    return 'Ready';
  }

  if (level === 'review') {
    return 'Review';
  }

  return 'Blocked';
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

  return 'Local Harness';
}

function summarizeCriteria(contextPack: string) {
  const firstLine = contextPack
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return '기준 없음';
  }

  return firstLine.length > 34 ? `${firstLine.slice(0, 34)}...` : firstLine;
}
