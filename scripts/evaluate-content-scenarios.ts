import { mkdirSync, writeFileSync } from 'node:fs';
import { runLocalPlanMergeHarness, validatePlanMergeAnalysis, type PlanMergeAnalysisPayload, type PlanMergeAnalysisResult } from '../src/planmerge/lib/ai/planmergeProtocol';
import { applyDecisionOptionOverride } from '../src/planmerge/lib/analysisOverride';
import { createDocumentSectionsFromAnalysis } from '../src/planmerge/lib/analysisViewModel';
import { buildMarkdownExport } from '../src/planmerge/lib/exportMarkdown';

const live = process.argv.includes('--live');
const directory = `docs/experiments/content-planning/${live ? 'live' : 'offline'}`;
mkdirSync(directory, { recursive: true });
const project = {
  title: '가상 신규 예능 소개 콘텐츠', goal: '처음 보는 시청자가 출연자 관계를 이해하도록 소개 콘텐츠의 제작안을 결정한다.',
  documentType: 'service_plan' as const, contextPack: '2명, 3일 작업. 본편 결말은 공개하지 않는다. 타깃은 프로그램을 보지 않은 20대다.',
  forbiddenDirection: '결말 스포일러와 미확보 출연자 인터뷰 사용 금지', outputStyle: '짧은 한국어 설명과 결정이 필요한 질문',
};
function draft(id: string, rawText: string) {
  return { id, rawText, authorName: id, authorRole: '기획', aiModel: 'Other' as const, taskTitle: '소개 콘텐츠 기획', status: 'submitted' as const, createdAtLabel: '합성 테스트 자료' };
}
const cases: { id: string; payload: PlanMergeAnalysisPayload }[] = [
  { id: 'sparse-brief', payload: { project, drafts: [draft('memo', '출연자 사이의 어색한 첫 만남을 짧은 영상으로 소개하고 싶다.')] } },
  { id: 'conflicting-proposals', payload: { project, drafts: [
    draft('editor', '타깃은 첫 시청자다. 핵심 기능: 출연자 소개 영상은 세로 30초로 제작한다. 기존 예고편 소재만 사용한다. MVP 범위는 인물 2명 소개와 관계 질문 하나다.'),
    draft('producer', '타깃은 기존 팬이다. 핵심 기능: 출연자 소개 영상은 가로 3분으로 제작한다. 신규 인터뷰를 촬영한다. MVP 범위에 결말 스포일러를 포함한다.'),
  ] } },
  { id: 'changed-constraints', payload: { project: { ...project, contextPack: '1명, 1일 작업. 기존 예고편 소재만 사용. 첫 시청자용 세로 30초를 우선한다.' }, drafts: [
    draft('short', '핵심 기능: 세로 30초 소개 영상. 기존 예고편을 편집한다. MVP 범위는 인물 소개 2명이다.'),
    draft('long', '핵심 기능: 가로 3분 소개 영상. 신규 인터뷰를 촬영한다. MVP 범위는 출연자 전원 인터뷰다.'),
  ] } },
];
async function main() {
  const summaries = [];
  for (const scenario of cases) {
    const start = Date.now();
    let result: PlanMergeAnalysisResult;
    if (live) {
      const response = await fetch(`${process.env.SCENARIO_BASE_URL || 'http://127.0.0.1:4190'}/api/analyze/planmerge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scenario.payload), signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`Analysis returned ${response.status}`);
      result = await response.json();
    } else result = runLocalPlanMergeHarness(scenario.payload);
    const validation = validatePlanMergeAnalysis(scenario.payload, result);
    const block = result.decisionBlocks.find(b => b.options.length > 1);
    const alternative = block?.options.find(o => o.id !== block.selectedOptionId);
    const originalSnapshot = JSON.stringify(result);
    const after = block && alternative ? applyDecisionOptionOverride(result, block.id, alternative.id) : result;
    const unaffected = result.finalDocumentSections.filter(s => s.sectionKey !== block?.sectionKey);
    const checks = {
      validStructure: validation.valid,
      originalNotMutated: JSON.stringify(result) === originalSnapshot,
      fallbackRequiresReview: result.source !== 'local_harness' || result.decisionBlocks.every(b => b.needsHumanReview),
      selectionApplied: block && alternative ? after.decisionBlocks.find(b => b.id === block.id)?.selectedOptionId === alternative.id : null,
      unrelatedSectionsPreserved: unaffected.every(s => JSON.stringify(s) === JSON.stringify(after.finalDocumentSections.find(a => a.sectionKey === s.sectionKey))),
      sourceExcerptsExact: result.normalizedIdeas.every(i => scenario.payload.drafts.find(d => d.id === i.sourceDraftId)?.rawText.includes(i.sourceExcerpt)),
    };
    const summary = { id: scenario.id, source: result.source, durationMs: Date.now() - start, checks, conflictBlocks: result.decisionBlocks.filter(b => b.conflictLevel !== 'none').length, missingSections: result.missingSections, reviewBlocks: result.decisionBlocks.filter(b => b.needsHumanReview).length };
    summaries.push(summary);
    writeFileSync(`${directory}/${scenario.id}.json`, JSON.stringify({ syntheticInputs: true, input: scenario.payload, before: result, after, summary }, null, 2));
    writeFileSync(`${directory}/${scenario.id}.md`, buildMarkdownExport({ projectTitle: project.title, sections: createDocumentSectionsFromAnalysis(after, scenario.payload.drafts), analysisResult: after }));
    console.log(JSON.stringify(summary));
  }
  writeFileSync(`${directory}/summary.json`, JSON.stringify({ generatedAt: new Date().toISOString(), syntheticInputs: true, mode: live ? 'http-api' : 'deterministic-offline', summaries }, null, 2));
  if (summaries.some(s => Object.values(s.checks).some(value => value === false))) process.exitCode = 1;
  else if (live && summaries.some(s => s.source === 'local_harness')) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
