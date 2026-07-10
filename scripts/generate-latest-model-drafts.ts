import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import type { LocalDraftSubmission, ProjectSettings } from '../src/planmerge/lib/localWorkspace';

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

const MAX_DRAFT_CHARS = Number(process.env.LATEST_MODEL_DRAFT_MAX_CHARS ?? 12000);

type ProviderId = 'openai' | 'anthropic' | 'gemini';

type ProviderSpec = {
  id: ProviderId;
  label: LocalDraftSubmission['aiModel'];
  authorName: string;
  authorRole: string;
  taskTitle: string;
  defaultModel: string;
  envKey: string;
  envModel: string;
  gmsUrl: (model: string) => string;
  prompt: string;
};

type GeneratedPayloadFile = {
  id: string;
  title: string;
  generatedAt: string;
  providers: {
    provider: ProviderId;
    model: string;
    draftId: string;
  }[];
  project: ProjectSettings;
  drafts: LocalDraftSubmission[];
};

const project: ProjectSettings = {
  title: 'PlanMerge multi-company AI draft merge',
  goal: 'Evaluate whether PlanMerge can merge planning drafts written by different people using different frontier AI companies while preserving selected ideas, rejected alternatives, conflicts, and source traceability.',
  documentType: 'service_plan',
  contextPack: 'Prioritize source traceability, conflict preservation, reviewer trust, paste-based MVP validation, and clear section-level decision blocks.',
  forbiddenDirection: 'The first MVP excludes Slack import, Notion export, Google Docs export, billing, team invitations, and realtime co-editing.',
  outputStyle: 'Portfolio-ready product planning memo with explicit decision trace and concise reviewer actions.',
};

const sharedBrief = [
  'Write a planning draft for PlanMerge.',
  'PlanMerge merges multiple AI-written planning drafts into one document while preserving selected ideas, rejected alternatives, conflicts, and source excerpts.',
  'Assume each teammate used a different AI company.',
  'Write in English. Include concrete opinions across overview, problem, target users, solution, core features, MVP scope, user flow, requirements, success metrics, risks, and open questions when relevant.',
  'Be opinionated. It is okay if your draft conflicts with other teammates.',
].join('\n');

const providers: ProviderSpec[] = [
  {
    id: 'openai',
    label: 'ChatGPT',
    authorName: 'PM using OpenAI',
    authorRole: 'PM',
    taskTitle: 'OpenAI planning draft',
    defaultModel: 'gpt-5.5',
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_DRAFT_MODEL',
    gmsUrl: () => 'https://gms.ssafy.io/gmsapi/api.openai.com/v1/chat/completions',
    prompt: `${sharedBrief}\n\nPerspective: PM. Prefer a tight MVP, clear success metrics, and launchable scope.`,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    authorName: 'Designer using Claude',
    authorRole: 'Designer',
    taskTitle: 'Claude planning draft',
    defaultModel: 'claude-opus-4-8',
    envKey: 'ANTHROPIC_API_KEY',
    envModel: 'ANTHROPIC_DRAFT_MODEL',
    gmsUrl: () => 'https://gms.ssafy.io/gmsapi/api.anthropic.com/v1/messages',
    prompt: `${sharedBrief}\n\nPerspective: product designer. Prefer trust-building UX, evidence panels, review flow, and careful uncertainty handling.`,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    authorName: 'Growth lead using Gemini',
    authorRole: 'Marketer',
    taskTitle: 'Gemini planning draft',
    defaultModel: 'gemini-3.5-flash',
    envKey: 'GEMINI_API_KEY',
    envModel: 'GEMINI_DRAFT_MODEL',
    gmsUrl: (model) => `https://gms.ssafy.io/gmsapi/generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    prompt: `${sharedBrief}\n\nPerspective: growth and go-to-market. You may argue for integrations or demo-friendly features if they help adoption.`,
  },
];

function providerKey(spec: ProviderSpec) {
  const value = process.env[spec.envKey] ?? process.env.GMS_API_KEY;
  if (!value) {
    throw new Error(`${spec.envKey} or GMS_API_KEY is required for ${spec.id}.`);
  }
  return value;
}

function providerBaseUrl(spec: ProviderSpec, model: string) {
  if (process.env[spec.envKey]) {
    if (spec.id === 'openai') return 'https://api.openai.com/v1/chat/completions';
    if (spec.id === 'anthropic') return 'https://api.anthropic.com/v1/messages';
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }

  return spec.gmsUrl(model);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(extractJsonObject(text)) as unknown;
  }
}

async function callOpenAI(spec: ProviderSpec, model: string, prompt: string) {
  const response = await fetch(providerBaseUrl(spec, model), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providerKey(spec)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'developer',
          content: 'Write the teammate draft only. No preamble.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_completion_tokens: Number(process.env.OPENAI_DRAFT_MAX_TOKENS ?? 6000),
    }),
  });

  const body: unknown = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`OpenAI ${model} failed: ${JSON.stringify(body).slice(0, 300)}`);
  }

  if (isRecord(body)) {
    if (typeof body.output_text === 'string') {
      return body.output_text;
    }

    const firstChoice = Array.isArray(body.choices) ? body.choices.find(isRecord) : undefined;
    const message = isRecord(firstChoice?.message) ? firstChoice.message : undefined;
    if (typeof message?.content === 'string' && message.content.trim()) {
      return message.content;
    }
  }

  throw new Error(`OpenAI ${model} response did not include text content.`);
}

async function callAnthropic(spec: ProviderSpec, model: string, prompt: string) {
  const response = await fetch(providerBaseUrl(spec, model), {
    method: 'POST',
    headers: {
      'x-api-key': providerKey(spec),
      'anthropic-version': process.env.ANTHROPIC_VERSION ?? '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2200,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const body: unknown = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Anthropic ${model} failed: ${JSON.stringify(body).slice(0, 300)}`);
  }

  if (isRecord(body) && Array.isArray(body.content)) {
    return body.content
      .filter(isRecord)
      .map((item) => item.text)
      .filter((text): text is string => typeof text === 'string')
      .join('\n')
      .trim();
  }

  throw new Error(`Anthropic ${model} response did not include text content.`);
}

async function callGemini(spec: ProviderSpec, model: string, prompt: string) {
  const useNativeKey = Boolean(process.env[spec.envKey]);
  const url = useNativeKey
    ? `${providerBaseUrl(spec, model)}?key=${encodeURIComponent(providerKey(spec))}`
    : providerBaseUrl(spec, model);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useNativeKey ? {} : { 'x-goog-api-key': providerKey(spec) }),
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 2200,
        temperature: 0.3,
      },
    }),
  });

  const body: unknown = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Gemini ${model} failed: ${JSON.stringify(body).slice(0, 300)}`);
  }

  if (isRecord(body) && Array.isArray(body.candidates)) {
    const first = body.candidates.find(isRecord);
    const content = isRecord(first?.content) ? first.content : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    return parts
      .filter(isRecord)
      .map((part) => part.text)
      .filter((text): text is string => typeof text === 'string')
      .join('\n')
      .trim();
  }

  throw new Error(`Gemini ${model} response did not include candidates text.`);
}

async function generateProviderDraft(spec: ProviderSpec): Promise<{
  model: string;
  draft: LocalDraftSubmission;
}> {
  const model = process.env[spec.envModel] ?? spec.defaultModel;
  const text = spec.id === 'openai'
    ? await callOpenAI(spec, model, spec.prompt)
    : spec.id === 'anthropic'
      ? await callAnthropic(spec, model, spec.prompt)
      : await callGemini(spec, model, spec.prompt);
  const rawText = trimDraftText(text);

  return {
    model,
    draft: {
      id: `${spec.id}-${safeId(model)}-${Date.now()}`,
      authorName: spec.authorName,
      authorRole: spec.authorRole,
      aiModel: spec.label,
      taskTitle: spec.taskTitle,
      rawText,
      status: 'submitted',
      createdAtLabel: 'frontier-model',
    },
  };
}

async function main() {
  const selected = providers.filter((spec) => process.env[spec.envKey] || process.env.GMS_API_KEY);
  if (!selected.length) {
    throw new Error('No provider keys found. Set GMS_API_KEY or one or more native provider keys.');
  }

  const generated = [];
  for (const spec of selected) {
    console.log(`Generating ${spec.id} draft with ${process.env[spec.envModel] ?? spec.defaultModel}`);
    generated.push({
      spec,
      ...(await generateProviderDraft(spec)),
    });
  }

  const generatedAt = new Date().toISOString();
  const payloadFile: GeneratedPayloadFile = {
    id: `latest-model-drafts-${generatedAt}`,
    title: 'Latest-model drafts from external AI companies',
    generatedAt,
    providers: generated.map(({ spec, model, draft }) => ({
      provider: spec.id,
      model,
      draftId: draft.id,
    })),
    project,
    drafts: generated.map(({ draft }) => draft),
  };
  const outDir = process.env.PROVIDER_DRAFT_OUT_DIR ?? 'reports/provider-drafts';
  const outPath = path.join(outDir, `latest-model-drafts-${generatedAt.replace(/[:.]/g, '-')}.json`);

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payloadFile, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
  console.log('Evaluate with:');
  console.log(`npm run harness:gms -- --payload-file "${outPath}" --judge --stop-remain 80000`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeId(input: string) {
  return input.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'model';
}

function trimDraftText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_DRAFT_CHARS) return trimmed;

  const slice = trimmed.slice(0, MAX_DRAFT_CHARS);
  const lastBreak = Math.max(
    slice.lastIndexOf('\n## '),
    slice.lastIndexOf('\n# '),
    slice.lastIndexOf('\n\n'),
  );
  const body = slice.slice(0, lastBreak > 2000 ? lastBreak : MAX_DRAFT_CHARS).trim();

  return [
    body,
    '',
    `[Truncated to ${MAX_DRAFT_CHARS} characters for repeatable PlanMerge evaluation.]`,
  ].join('\n');
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  throw new Error('Response did not contain JSON.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
