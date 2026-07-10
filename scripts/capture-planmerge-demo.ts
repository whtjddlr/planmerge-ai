import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

type CliOptions = {
  analysisFile?: string;
  baseUrl?: string;
  gmsMode: 'auto' | 'force' | 'off';
  headless: boolean;
  model: string;
  outDir: string;
  paceMs: number;
  port: number;
  presentation: boolean;
  slowMo: number;
  stopRemain: number;
};

type LocalWorkspaceState = {
  analysisRunId: number;
  project: {
    title: string;
    goal: string;
    documentType: 'service_plan' | 'prd' | 'business_plan' | 'feature_spec';
    contextPack: string;
    forbiddenDirection: string;
    outputStyle: string;
  };
  drafts: Array<{
    id: string;
    authorName: string;
    authorRole: string;
    aiModel: 'ChatGPT' | 'Claude' | 'Gemini' | 'Cursor' | 'Other';
    taskTitle: string;
    rawText: string;
    status: 'submitted' | 'parsed' | 'failed';
    createdAtLabel: string;
  }>;
  approvedBlockIds: string[];
  decisionLogs: [];
};

type GmsCreditSnapshot = {
  remainCredit?: number;
  usedCredit?: number;
  expiredDate?: string;
};

const repoRoot = path.resolve(__dirname, '..');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const demoWorkspaceState: LocalWorkspaceState = {
  analysisRunId: 0,
  project: {
    title: 'PlanMerge 멀티 모델 MVP 기획',
    goal: '서로 다른 AI 도구로 작성한 기획 초안을 하나의 검토 가능한 MVP 계획서로 병합하고, 선택 근거와 원문 출처를 함께 남긴다.',
    documentType: 'service_plan',
    contextPack: [
      '데모 대상은 해커톤 심사위원과 3~5명 내부 파일럿 사용자다.',
      '팀은 ChatGPT, Claude, Gemini에서 각각 작성한 초안을 갖고 있다.',
      '최종 결과는 충돌 의견, 원문 근거, 사람 검토 필요 상태를 보존해야 한다.',
      '초기 MVP는 외부 연동 없이 해커톤 현장에서 바로 시연 가능해야 한다.',
    ].join('\n'),
    forbiddenDirection: '초기 MVP에는 Slack, Notion, 결제, 실시간 공동 편집을 포함하지 않는다.',
    outputStyle: '선택안, 대안, 충돌 의견, 검토 메모가 드러나는 간결한 서비스 기획서',
  },
  drafts: [
    {
      id: 'demo-draft-chatgpt',
      authorName: 'PM',
      authorRole: 'Product',
      aiModel: 'ChatGPT',
      taskTitle: 'MVP 범위',
      rawText: [
        'MVP는 붙여넣기 기반 초안 수집, AI 초안별 아이디어 정규화, 결정 근거 병합, Markdown 내보내기에 집중해야 한다.',
        '첫 파일럿에서는 외부 연동을 피한다. 가장 강한 데모 포인트는 왜 특정 선택안이 채택됐고 어떤 원문 초안이 이를 뒷받침했는지 보여주는 것이다.',
      ].join('\n'),
      status: 'submitted',
      createdAtLabel: 'Demo',
    },
    {
      id: 'demo-draft-claude',
      authorName: 'Tech Lead',
      authorRole: 'Engineering',
      aiModel: 'Claude',
      taskTitle: '품질과 리스크 통제',
      rawText: [
        '공유나 승인 전에 품질 게이트가 필요하다. 출처 반영이 부족하거나 검증이 실패하거나 충돌이 남아 있으면 결과는 검토 상태에 머물러야 한다.',
        '시연에서는 분석 검토 지표, 원문 발췌, 누락 섹션, 경고를 보여줘서 리뷰어가 병합 결과를 신뢰할 수 있어야 한다.',
      ].join('\n'),
      status: 'submitted',
      createdAtLabel: 'Demo',
    },
    {
      id: 'demo-draft-gemini',
      authorName: 'Growth',
      authorRole: 'Marketing',
      aiModel: 'Gemini',
      taskTitle: '도입 요구',
      rawText: [
        '도입 관점에서는 Slack 가져오기, Notion 내보내기, 참여자 공유 링크 요구가 나올 가능성이 높다.',
        '이런 연동은 데모에서 매력적이지만 2주 MVP 범위와 충돌할 수 있다. 제외한다면 파일럿 기간 동안 무엇으로 대체할지 계획서에 설명해야 한다.',
      ].join('\n'),
      status: 'submitted',
      createdAtLabel: 'Demo',
    },
  ],
  approvedBlockIds: [],
  decisionLogs: [],
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(repoRoot, options.outDir);
  const screenshotDir = path.join(outDir, `screenshots-${timestamp}`);
  const videoWorkDir = path.join(outDir, `video-work-${timestamp}`);
  const baseUrl = options.baseUrl ?? `http://127.0.0.1:${options.port}`;
  const apiKey = process.env.GMS_API_KEY ?? process.env.GMS_KEY;
  const replayAnalysis = options.analysisFile
    ? await readAnalysisReplay(options.analysisFile)
    : undefined;
  const requestedGms = !replayAnalysis && (
    options.gmsMode === 'force' || (options.gmsMode === 'auto' && Boolean(apiKey))
  );

  if (options.gmsMode === 'force' && !apiKey && !replayAnalysis) {
    throw new Error('GMS_API_KEY is required for --gms. Set it in the shell; do not paste it into a command.');
  }

  await mkdir(screenshotDir, { recursive: true });
  await mkdir(videoWorkDir, { recursive: true });

  const creditBefore = requestedGms ? await readGmsCredit(apiKey) : undefined;
  if (requestedGms && creditBefore?.remainCredit !== undefined && creditBefore.remainCredit <= options.stopRemain) {
    throw new Error(
      `GMS remainCredit=${creditBefore.remainCredit} is at or below stopRemain=${options.stopRemain}. ` +
      'Use --local to record without spending credits.',
    );
  }

  const server = options.baseUrl ? undefined : startDevServer(options, requestedGms, apiKey);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const browserIssues: string[] = [];
  let analysisPayload: unknown;

  try {
    if (server) {
      await waitForServer(baseUrl, 120_000);
    }

    browser = await chromium.launch({
      headless: options.headless,
      slowMo: options.slowMo,
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: {
        dir: videoWorkDir,
        size: { width: 1440, height: 900 },
      },
    });
    page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        browserIssues.push(`console error: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      browserIssues.push(`page error: ${error.message}`);
    });

    await seedDemoWorkspace(page);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    if (replayAnalysis) {
      await page.route('**/api/analyze/planmerge', async (route) => {
        await presentationPause(options, 0.8);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(replayAnalysis),
        });
      });
    }
    await expectVisible(page.getByTestId('nav-setup'), 'project setup navigation');
    await expectVisible(page.getByTestId('project-brief-panel'), 'project brief panel');
    await wait(850);
    await page.screenshot({ path: path.join(screenshotDir, '00-project-brief.png'), fullPage: true });
    await presentationPause(options, 1.6);
    await expectVisible(page.getByTestId('nav-drafts'), 'draft navigation');
    await page.getByTestId('nav-drafts').click();
    await expectVisible(page.getByTestId('draft-intake-form'), 'draft intake form');
    await expectVisible(page.getByTestId('run-analysis-button'), 'run analysis button');
    await wait(850);
    await page.screenshot({ path: path.join(screenshotDir, '01-drafts-ready.png'), fullPage: true });
    await presentationPause(options, 1.4);

    const analysisResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/analyze/planmerge') && response.request().method() === 'POST',
      { timeout: 180_000 },
    );
    await page.getByTestId('run-analysis-button').click();
    const analysisResponse = await analysisResponsePromise;
    analysisPayload = await safeJson(analysisResponse);
    await presentationPause(options, 0.8);
    await page.getByTestId('nav-merge').click();
    await expectVisible(page.getByTestId('decision-panel'), 'decision panel');
    await wait(650);
    await page.screenshot({ path: path.join(screenshotDir, '02-merge-result.png'), fullPage: true });
    await presentationPause(options, 1.6);

    await clickIfPresent(page.locator('[data-testid^="document-section-"]').nth(6));
    await wait(350);
    await clickIfPresent(page.getByTestId('apply-decision-option').first());
    await page.screenshot({ path: path.join(screenshotDir, '03-decision-trace.png'), fullPage: true });
    await presentationPause(options, 1.4);

    await page.getByTestId('nav-inspector').click();
    await expectVisible(page.getByTestId('inspector-tab-quality'), 'quality tab');
    await page.screenshot({ path: path.join(screenshotDir, '04-quality-gate.png'), fullPage: true });
    await presentationPause(options, 1.8);
    await presentationScroll(page, options);
    await page.getByTestId('inspector-tab-decisions').click();
    await page.screenshot({ path: path.join(screenshotDir, '05-decision-blocks.png'), fullPage: true });
    await presentationPause(options, 1.8);
    await presentationScroll(page, options);
    await page.getByTestId('inspector-tab-validation').click();
    await page.screenshot({ path: path.join(screenshotDir, '06-validation.png'), fullPage: true });
    await presentationPause(options, 1.8);

    if (options.presentation) {
      await page.getByTestId('toolbar-menu-button').click();
      await presentationPause(options, 0.8);
      await page.screenshot({ path: path.join(screenshotDir, '07-export-actions.png'), fullPage: true });
      await presentationPause(options, 1.4);
      await page.keyboard.press('Escape');
    }

    const video = page.video();
    await page.close();
    const finalVideoPath = path.join(outDir, `planmerge-demo-${timestamp}.webm`);
    if (video) {
      await video.saveAs(finalVideoPath);
    }

    const creditAfter = requestedGms ? await readGmsCredit(apiKey) : undefined;
    const summary = buildSummary({
      analysisPayload,
      browserIssues,
      creditAfter,
      creditBefore,
      finalVideoPath,
      requestedGms,
      screenshotDir,
      model: requestedGms ? options.model : undefined,
      presentation: options.presentation,
      replayAnalysisFile: options.analysisFile,
    });

    const analysisPath = path.join(outDir, `planmerge-demo-analysis-${timestamp}.json`);
    const summaryPath = path.join(outDir, `planmerge-demo-summary-${timestamp}.md`);
    await writeFile(analysisPath, `${JSON.stringify(analysisPayload ?? null, null, 2)}\n`, 'utf8');
    await writeFile(summaryPath, summary, 'utf8');

    console.log(`Demo capture complete: ${summaryPath}`);
    console.log(`Screenshots: ${screenshotDir}`);
    console.log(`Video: ${finalVideoPath}`);
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (server) {
      stopDevServer(server);
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    gmsMode: 'auto',
    headless: true,
    model: process.env.GMS_DEFAULT_MODEL ?? 'gpt-5.5',
    outDir: 'docs/demo/output',
    paceMs: 0,
    port: 3100,
    presentation: false,
    slowMo: 0,
    stopRemain: 50_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--base-url' && next) {
      options.baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === '--analysis-file' && next) {
      options.analysisFile = next;
      index += 1;
      continue;
    }
    if (arg === '--gms') {
      options.gmsMode = 'force';
      continue;
    }
    if (arg === '--local') {
      options.gmsMode = 'off';
      continue;
    }
    if (arg === '--headed') {
      options.headless = false;
      continue;
    }
    if (arg === '--model' && next) {
      options.model = next;
      index += 1;
      continue;
    }
    if (arg === '--out' && next) {
      options.outDir = next;
      index += 1;
      continue;
    }
    if (arg === '--port' && next) {
      options.port = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--presentation') {
      options.presentation = true;
      if (options.paceMs === 0) {
        options.paceMs = 2500;
      }
      continue;
    }
    if (arg === '--pace-ms' && next) {
      options.paceMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--slow-mo' && next) {
      options.slowMo = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--stop-remain' && next) {
      options.stopRemain = Number(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error('--port must be a positive number.');
  }
  if (!Number.isFinite(options.stopRemain) || options.stopRemain < 0) {
    throw new Error('--stop-remain must be zero or greater.');
  }
  if (!Number.isFinite(options.slowMo) || options.slowMo < 0) {
    throw new Error('--slow-mo must be zero or greater.');
  }
  if (!Number.isFinite(options.paceMs) || options.paceMs < 0) {
    throw new Error('--pace-ms must be zero or greater.');
  }

  return options;
}

function startDevServer(
  options: CliOptions,
  requestedGms: boolean,
  apiKey: string | undefined,
): ChildProcess {
  const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    DIRECT_URL: process.env.DIRECT_URL ?? '',
    GMS_DEFAULT_MODEL: requestedGms ? options.model : process.env.GMS_DEFAULT_MODEL,
  };

  if (requestedGms && apiKey) {
    serverEnv.GMS_API_KEY = apiKey;
  }
  if (!requestedGms) {
    delete serverEnv.GMS_API_KEY;
    delete serverEnv.GMS_KEY;
  }

  const server = spawn(
    process.execPath,
    [nextBin, 'dev', '--port', String(options.port), '--hostname', '127.0.0.1'],
    {
      cwd: repoRoot,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  server.stdout?.on('data', () => undefined);
  server.stderr?.on('data', () => undefined);

  return server;
}

function stopDevServer(server: ChildProcess) {
  if (!server.killed) {
    server.kill();
  }
}

async function waitForServer(baseUrl: string, timeoutMs: number) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still booting.
    }

    await wait(750);
  }

  throw new Error(`Timed out waiting for dev server: ${baseUrl}`);
}

async function seedDemoWorkspace(page: Page) {
  await page.addInitScript((state: LocalWorkspaceState) => {
    const workspaceId = 'demo-gms-flow';
    const updatedAt = new Date().toISOString();

    window.localStorage.clear();
    window.localStorage.setItem('planmerge_workspace_v1:demo-gms-flow', JSON.stringify(state));
    window.localStorage.setItem('planmerge_active_workspace_v1', workspaceId);
    window.localStorage.setItem(
      'planmerge_workspaces_v1',
      JSON.stringify([{ id: workspaceId, title: state.project.title, updatedAt }]),
    );
  }, demoWorkspaceState);
}

async function readAnalysisReplay(analysisFile: string) {
  const fullPath = path.resolve(repoRoot, analysisFile);
  const raw = await readFile(fullPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!isRecord(parsed)) {
    throw new Error(`Analysis replay file must contain a JSON object: ${analysisFile}`);
  }

  return normalizeReplayAnalysis(parsed);
}

async function readGmsCredit(apiKey: string | undefined): Promise<GmsCreditSnapshot | undefined> {
  if (!apiKey) {
    return undefined;
  }

  try {
    const response = await fetch('https://gms.ssafy.io/gmsapi/key-info', {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json() as GmsCreditSnapshot;
    return {
      remainCredit: asNumber(payload.remainCredit),
      usedCredit: asNumber(payload.usedCredit),
      expiredDate: typeof payload.expiredDate === 'string' ? payload.expiredDate : undefined,
    };
  } catch {
    return undefined;
  }
}

async function safeJson(response: { json: () => Promise<unknown> }) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function presentationPause(options: CliOptions, multiplier = 1) {
  if (!options.presentation && options.paceMs === 0) {
    return;
  }

  await wait(Math.round(options.paceMs * multiplier));
}

async function presentationScroll(page: Page, options: CliOptions) {
  if (!options.presentation) {
    return;
  }

  await page.mouse.wheel(0, 520);
  await presentationPause(options, 0.8);
  await page.mouse.wheel(0, -520);
  await presentationPause(options, 0.6);
}

function buildSummary({
  analysisPayload,
  browserIssues,
  creditAfter,
  creditBefore,
  finalVideoPath,
  requestedGms,
  screenshotDir,
  model,
  presentation,
  replayAnalysisFile,
}: {
  analysisPayload: unknown;
  browserIssues: string[];
  creditAfter?: GmsCreditSnapshot;
  creditBefore?: GmsCreditSnapshot;
  finalVideoPath: string;
  requestedGms: boolean;
  screenshotDir: string;
  model?: string;
  presentation: boolean;
  replayAnalysisFile?: string;
}) {
  const analysis = isRecord(analysisPayload) ? analysisPayload : {};
  const source = typeof analysis.source === 'string' ? analysis.source : 'unknown';
  const normalizedIdeas = Array.isArray(analysis.normalizedIdeas) ? analysis.normalizedIdeas.length : 0;
  const decisionBlocks = Array.isArray(analysis.decisionBlocks) ? analysis.decisionBlocks.length : 0;
  const finalSections = Array.isArray(analysis.finalDocumentSections) ? analysis.finalDocumentSections.length : 0;
  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings.length : 0;
  const creditDelta =
    creditBefore?.remainCredit !== undefined && creditAfter?.remainCredit !== undefined
      ? creditBefore.remainCredit - creditAfter.remainCredit
      : undefined;

  return [
    '# PlanMerge Demo Capture Summary',
    '',
    `- Captured at: ${new Date().toISOString()}`,
    `- Requested GMS: ${requestedGms ? 'yes' : 'no'}`,
    `- Model: ${model ?? 'local fallback'}`,
    `- Presentation mode: ${presentation ? 'yes' : 'no'}`,
    `- Replay analysis file: ${replayAnalysisFile ?? 'none'}`,
    `- Result source: ${source}`,
    `- Normalized ideas: ${normalizedIdeas}`,
    `- Decision blocks: ${decisionBlocks}`,
    `- Final sections: ${finalSections}`,
    `- Warnings: ${warnings}`,
    `- Credit before: ${formatCredit(creditBefore)}`,
    `- Credit after: ${formatCredit(creditAfter)}`,
    `- Credit delta: ${creditDelta ?? 'unknown'}`,
    `- Screenshots: ${path.relative(repoRoot, screenshotDir)}`,
    `- Video: ${path.relative(repoRoot, finalVideoPath)}`,
    `- Browser issues: ${browserIssues.length}`,
    '',
    '## Screenshots',
    '',
    '- 00-project-brief.png',
    '- 01-drafts-ready.png',
    '- 02-merge-result.png',
    '- 03-decision-trace.png',
    '- 04-quality-gate.png',
    '- 05-decision-blocks.png',
    '- 06-validation.png',
    ...(presentation ? ['- 07-export-actions.png'] : []),
    '',
    '## Notes',
    '',
    source === 'gms'
      ? '- This capture includes a real GMS analysis response.'
      : '- This capture did not use a successful GMS response. Use `npm run demo:capture -- --gms` after setting GMS_API_KEY.',
    browserIssues.length
      ? browserIssues.map((issue) => `- ${issue}`).join('\n')
      : '- No browser console errors or page errors were captured.',
    '',
  ].join('\n');
}

function formatCredit(snapshot: GmsCreditSnapshot | undefined) {
  if (!snapshot) {
    return 'unknown';
  }

  const remain = snapshot.remainCredit ?? 'unknown';
  const used = snapshot.usedCredit ?? 'unknown';
  const expires = snapshot.expiredDate ?? 'unknown';

  return `remain=${remain}, used=${used}, expires=${expires}`;
}

function normalizeReplayAnalysis(analysis: Record<string, unknown>) {
  return {
    ...analysis,
    warnings: normalizeWarningList(analysis.warnings),
  };
}

function normalizeWarningList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(formatWarningText)
    .filter((warning): warning is string => Boolean(warning?.trim()));
}

function formatWarningText(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (isRecord(value)) {
    const type = typeof value.type === 'string' && value.type.trim()
      ? `[${value.type.trim()}] `
      : '';
    const message = typeof value.message === 'string' && value.message.trim()
      ? value.message.trim()
      : JSON.stringify(value);

    return `${type}${message}`.trim();
  }

  return undefined;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function clickIfPresent(locator: ReturnType<Page['locator']>) {
  if (await locator.count()) {
    await locator.click();
  }
}

async function expectVisible(locator: ReturnType<Page['getByTestId']>, label: string) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    throw new Error(`Expected visible ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
