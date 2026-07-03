export type GmsConfig = {
  apiKey?: string;
  apiUrl: string;
  model: string;
};

type GmsResponseContent = {
  text?: string;
};

type GmsResponseOutput = {
  content?: GmsResponseContent[];
};

type GmsResponsesApiResponse = {
  output_text?: string;
  output?: GmsResponseOutput[];
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_GMS_API_URL = 'https://gms.ssafy.io/gmsapi/api.openai.com/v1/responses';
const DEFAULT_GMS_MODEL = 'gpt-4.1';
// 업스트림이 응답을 물고 있으면 분석 라우트가 초안 수만큼의 병렬 요청을
// 함수 타임아웃까지 잡고 있게 되므로 요청 단위로 끊는다.
const GMS_REQUEST_TIMEOUT_MS = 60_000;

export function getGmsConfig(): GmsConfig {
  return {
    apiKey: process.env.GMS_API_KEY,
    apiUrl: process.env.GMS_API_URL ?? DEFAULT_GMS_API_URL,
    model: process.env.GMS_DEFAULT_MODEL
      ?? process.env.MODEL_NAME
      ?? DEFAULT_GMS_MODEL,
  };
}

export function extractJsonObject(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error('GMS response did not contain a JSON object.');
}

function extractOutputText(data: GmsResponsesApiResponse) {
  if (data.output_text) {
    return data.output_text;
  }

  const outputText = data.output
    ?.flatMap((output) => output.content ?? [])
    .map((content) => content.text)
    .filter((text): text is string => Boolean(text))
    .join('');

  if (outputText) {
    return outputText;
  }

  const chatContent = data.choices?.[0]?.message?.content;
  if (chatContent) {
    return chatContent;
  }

  throw new Error('GMS API response did not include text content.');
}

export async function callGmsJson<T>(
  prompt: string,
  options: {
    maxOutputTokens: number;
    model?: string;
  },
): Promise<T> {
  const { apiKey, apiUrl, model } = getGmsConfig();
  const selectedModel = options.model ?? model;

  if (!apiKey) {
    throw new Error('GMS_API_KEY is missing.');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(GMS_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: selectedModel,
      input: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_output_tokens: options.maxOutputTokens,
      text: {
        format: {
          type: 'json_object',
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GMS API failed with ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as GmsResponsesApiResponse;
  const content = extractOutputText(data);

  return JSON.parse(extractJsonObject(content)) as T;
}
