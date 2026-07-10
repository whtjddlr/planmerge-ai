import type { LocalWorkspaceState } from '@/planmerge/lib/localWorkspace';
import { evaluateAnalysisQuality } from '@/planmerge/lib/analysisQuality';
import { evaluatePublicationReadiness } from '@/planmerge/lib/publicationReadiness';

export function getWorkspacePublicationReadiness(state: LocalWorkspaceState) {
  const qualityReport = state.analysisResult
    ? evaluateAnalysisQuality(
      { project: state.project, drafts: state.drafts },
      state.analysisResult,
      state.approvedBlockIds,
    )
    : undefined;

  return evaluatePublicationReadiness({
    analysisResult: state.analysisResult,
    approvedBlockIds: state.approvedBlockIds,
    qualityLevel: qualityReport?.level ?? null,
  });
}
