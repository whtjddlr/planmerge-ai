import assert from 'node:assert/strict';
import { evaluateAnalysisQuality } from '../src/planmerge/lib/analysisQuality';
import { createSampleWorkspaceState } from '../src/planmerge/lib/localWorkspace';
import { evaluatePublicationReadiness } from '../src/planmerge/lib/publicationReadiness';
import { getWorkspacePublicationReadiness } from '../src/server/workspacePublication';

const sample = createSampleWorkspaceState();

if (!sample.analysisResult) {
  throw new Error('Sample analysis result is required.');
}

const payload = { project: sample.project, drafts: sample.drafts };
const initialQuality = evaluateAnalysisQuality(payload, sample.analysisResult);
const initialReadiness = evaluatePublicationReadiness({
  analysisResult: sample.analysisResult,
  approvedBlockIds: [],
  qualityLevel: initialQuality.level,
});

assert.equal(initialQuality.level, 'ready');
assert.equal(initialReadiness.level, 'review');
assert.equal(initialReadiness.canShare, false);
assert.equal(initialReadiness.unresolvedCount, 1);
assert.equal(initialReadiness.requiredCount, 1);
assert.equal(getWorkspacePublicationReadiness(sample).canShare, false);

const reviewedBlockId = initialReadiness.unresolvedBlockIds[0];
const approvedQuality = evaluateAnalysisQuality(payload, sample.analysisResult, [reviewedBlockId]);
const approvedReadiness = evaluatePublicationReadiness({
  analysisResult: sample.analysisResult,
  approvedBlockIds: [reviewedBlockId],
  qualityLevel: approvedQuality.level,
});

assert.equal(approvedReadiness.level, 'ready');
assert.equal(approvedReadiness.canShare, true);
assert.equal(approvedReadiness.reviewCompletion, 100);
assert.equal(approvedReadiness.approvedCount, 1);
assert.equal(approvedReadiness.unresolvedCount, 0);
assert.equal(getWorkspacePublicationReadiness({
  ...sample,
  approvedBlockIds: [reviewedBlockId],
}).canShare, true);
assert.equal(
  approvedQuality.findings.some((finding) => finding.id === `conflict_${reviewedBlockId}`),
  false,
);

const qualityReviewReadiness = evaluatePublicationReadiness({
  analysisResult: sample.analysisResult,
  approvedBlockIds: [reviewedBlockId],
  qualityLevel: 'review',
});

assert.equal(qualityReviewReadiness.level, 'review');
assert.equal(qualityReviewReadiness.canShare, false);

const idleReadiness = evaluatePublicationReadiness({
  qualityLevel: null,
});

assert.equal(idleReadiness.level, 'idle');
assert.equal(idleReadiness.canShare, false);

console.log('Publication readiness cases passed.');
