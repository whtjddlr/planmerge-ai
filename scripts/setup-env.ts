/**
 * API 키를 붙여넣으면 `.env.local`을 만들어 주는 로컬 셋업 스크립트.
 *
 * 왜 웹 화면이 아니라 CLI인가:
 * 브라우저에서 키를 받아 서버 `.env`에 쓰는 엔드포인트를 두면 그 사이트에 접근할 수
 * 있는 누구나 서버 자격증명을 덮어쓸 수 있고, 키가 네트워크와 브라우저 메모리를
 * 거치게 된다. 키는 서버를 실행하는 사람의 기계에서만 다룬다.
 *
 * 실행: npm run setup
 *   - 대화형: 키를 입력받는다(화면에 표시하지 않음).
 *   - 파이프: `echo $KEY | npm run setup` 처럼 표준입력으로도 받는다.
 */
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(ROOT, '.env.local');
const GITIGNORE_PATH = resolve(ROOT, '.gitignore');

/** 이 스크립트가 관리하는 키. 나머지 줄은 그대로 보존한다. */
const MANAGED_KEYS = [
  'ANALYSIS_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_ANALYSIS_MODEL',
  'OPENAI_DECISION_MODEL',
] as const;

/**
 * 분석·Decision Room에 쓸 모델 선호 순서.
 * 계정이 접근할 수 있는 것 중 첫 번째를 고른다.
 */
const MODEL_PREFERENCE = [
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5',
  'gpt-4.1',
];

function maskKey(key: string) {
  if (key.length <= 12) {
    return '***';
  }

  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

class SetupError extends Error {}

/**
 * 던지기만 하고 process.exit은 부르지 않는다. Windows에서 파이프된 stdin이 아직
 * 닫히는 중일 때 강제 종료하면 libuv가 assert로 죽어, 정작 읽어야 할 오류 메시지
 * 뒤에 의미 없는 크래시가 붙는다.
 */
function fail(message: string): never {
  throw new SetupError(message);
}

function releaseStdin() {
  process.stdin.pause();
  process.stdin.removeAllListeners();
}

/** 화면에 입력을 남기지 않고 한 줄을 읽는다. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePrompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    process.stdout.write(question);

    // readline이 에코한 문자를 즉시 지워 키가 터미널 스크롤백에 남지 않게 한다.
    const onData = () => {
      process.stdout.write(`\r${question}`);
    };
    process.stdin.on('data', onData);

    rl.question('', (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolvePrompt(answer.trim());
    });
  });
}

function readPipedKey(): Promise<string> {
  return new Promise((resolvePipe) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolvePipe(buffer.trim()));
  });
}

async function readApiKey() {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();

  if (fromEnv) {
    console.log('· 환경변수 OPENAI_API_KEY를 사용합니다.');
    return fromEnv;
  }

  if (!process.stdin.isTTY) {
    return readPipedKey();
  }

  console.log('OpenAI API 키를 붙여넣고 Enter를 누르세요. 입력은 화면에 표시되지 않습니다.');
  console.log('(키는 이 기계의 .env.local에만 저장되며 어디로도 전송되지 않습니다.)\n');

  return promptHidden('API key: ');
}

type ModelListResponse = { data?: Array<{ id?: unknown }> };

/** 키가 실제로 동작하는지, 어떤 모델을 쓸 수 있는지 확인한다. */
async function verifyKey(apiKey: string) {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 401) {
    fail('키가 거절되었습니다(401). 값을 다시 확인해 주세요.');
  }

  if (!response.ok) {
    fail(`모델 목록을 가져오지 못했습니다. 응답 상태: ${response.status}`);
  }

  const body = await response.json() as ModelListResponse;
  const ids = (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string');

  if (!ids.length) {
    fail('이 키로 사용할 수 있는 모델이 없습니다.');
  }

  return new Set(ids);
}

function pickModel(available: Set<string>) {
  const chosen = MODEL_PREFERENCE.find((model) => available.has(model));

  if (!chosen) {
    fail(
      `알고 있는 모델 중 사용 가능한 것이 없습니다. 확인한 후보: ${MODEL_PREFERENCE.join(', ')}`,
    );
  }

  return chosen;
}

/** 기존 줄은 보존하고 관리 대상 키만 교체한다. */
function mergeEnvFile(existing: string, values: Record<string, string>) {
  const lines = existing.length ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  const remaining = new Map(Object.entries(values));

  const merged = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);

    if (!match) {
      return line;
    }

    const key = match[1];

    if (!remaining.has(key)) {
      return line;
    }

    const value = remaining.get(key)!;
    remaining.delete(key);

    return `${key}=${value}`;
  });

  if (remaining.size) {
    if (merged.length && merged[merged.length - 1].trim() !== '') {
      merged.push('');
    }

    merged.push('# PlanMerge analysis provider (npm run setup)');

    for (const [key, value] of remaining) {
      merged.push(`${key}=${value}`);
    }
  }

  return `${merged.join('\n').replace(/\n+$/, '')}\n`;
}

function ensureGitignored() {
  if (!existsSync(GITIGNORE_PATH)) {
    appendFileSync(GITIGNORE_PATH, '\n.env*\n', 'utf8');
    console.log('· .gitignore를 만들고 .env*를 추가했습니다.');
    return;
  }

  try {
    execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: ROOT, stdio: 'ignore' });
    return;
  } catch {
    // git이 없거나 무시 대상이 아니다. 후자면 규칙을 추가한다.
  }

  const gitignore = readFileSync(GITIGNORE_PATH, 'utf8');

  if (!/^\.env\*?$/m.test(gitignore) && !gitignore.includes('.env.local')) {
    appendFileSync(GITIGNORE_PATH, '\n.env*\n', 'utf8');
    console.log('· .gitignore에 .env*를 추가했습니다.');
  }
}

async function main() {
  console.log('\nPlanMerge 분석 제공자 설정\n');

  const apiKey = await readApiKey();

  if (!apiKey) {
    fail('키가 비어 있습니다.');
  }

  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
    fail('OpenAI API 키 형식이 아닙니다. "sk-"로 시작하는 값을 넣어 주세요.');
  }

  console.log(`\n· 키 확인 중: ${maskKey(apiKey)}`);

  const available = await verifyKey(apiKey);
  const model = pickModel(available);

  console.log(`· 사용 가능한 모델 ${available.size}개를 확인했습니다.`);
  console.log(`· 선택한 모델: ${model}`);

  ensureGitignored();

  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const hadKey = /^\s*OPENAI_API_KEY\s*=\s*\S/m.test(existing);

  const next = mergeEnvFile(existing, {
    ANALYSIS_PROVIDER: 'openai',
    OPENAI_API_KEY: apiKey,
    OPENAI_ANALYSIS_MODEL: model,
    OPENAI_DECISION_MODEL: model,
  });

  writeFileSync(ENV_PATH, next, 'utf8');

  console.log(`\n✓ .env.local을 ${hadKey ? '갱신' : '생성'}했습니다.`);
  console.log(`  관리 항목: ${MANAGED_KEYS.join(', ')}`);
  console.log('  그 외 기존 줄은 그대로 두었습니다.');
  console.log('\n다음: npm run dev\n');
  releaseStdin();
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  releaseStdin();
  process.exitCode = 1;
});
