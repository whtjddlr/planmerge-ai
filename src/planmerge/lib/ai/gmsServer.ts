export type GmsConfig = {
  apiKey?: string;
  apiUrl: string;
  model: string;
};

type GmsResponseContent = {
  text?: unknown;
};

type GmsResponsesApiResponse = {
  id?: unknown;
  model?: unknown;
  status?: unknown;
  incomplete_details?: unknown;
  output_text?: unknown;
  output?: unknown;
  choices?: unknown;
};

type GmsJsonCallOptions = {
  maxOutputTokens: number;
  model?: string;
};

export type ResponsesJsonCallOptions = GmsJsonCallOptions & {
  apiKey: string;
  apiUrl: string;
  providerLabel?: string;
  temperature?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  jsonSchema?: {
    name: string;
    schema: object;
  };
};

export type ResponsesJsonResult<T> = {
  data: T;
  responseId?: string;
  model?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractIncompleteReason(data: GmsResponsesApiResponse) {
  const details = data.incomplete_details;

  if (isRecord(details) && typeof details.reason === 'string' && details.reason.trim()) {
    return details.reason.trim();
  }

  return 'unknown';
}

function extractOutputText(data: GmsResponsesApiResponse) {
  if (typeof data.output_text === 'string' && data.output_text) {
    return data.output_text;
  }

  const outputText = (Array.isArray(data.output) ? data.output : [])
    .flatMap((output): GmsResponseContent[] => {
      if (!isRecord(output) || !Array.isArray(output.content)) {
        return [];
      }

      return output.content
        .filter(isRecord)
        .map((content) => ({ text: content.text }));
    })
    .map((content) => content.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('');

  if (outputText) {
    return outputText;
  }

  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message = isRecord(firstChoice) && isRecord(firstChoice.message)
    ? firstChoice.message
    : undefined;
  const chatContent = typeof message?.content === 'string' ? message.content : undefined;
  if (chatContent) {
    return chatContent;
  }

  throw new Error('GMS API response did not include text content.');
}

export async function callGmsJson<T>(
  prompt: string,
  options: GmsJsonCallOptions,
): Promise<T> {
  const { apiKey, apiUrl, model } = getGmsConfig();

  if (!apiKey) {
    throw new Error('GMS_API_KEY is missing.');
  }

  const result = await callResponsesJsonWithMetadata<T>(prompt, {
    ...options,
    apiKey,
    apiUrl,
    model: options.model ?? model,
    providerLabel: 'GMS API',
    temperature: 0.1,
  });

  return result.data;
}

export async function callResponsesJsonWithMetadata<T>(
  prompt: string,
  options: ResponsesJsonCallOptions,
): Promise<ResponsesJsonResult<T>> {
  const selectedModel = options.model ?? DEFAULT_GMS_MODEL;
  const providerLabel = options.providerLabel?.trim() || 'Responses API';

  const response = await fetch(options.apiUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(GMS_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
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
      ...(options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(options.reasoningEffort
        ? { reasoning: { effort: options.reasoningEffort } }
        : {}),
      max_output_tokens: options.maxOutputTokens,
      text: {
        format: options.jsonSchema
          ? {
            type: 'json_schema',
            name: options.jsonSchema.name,
            strict: true,
            schema: options.jsonSchema.schema,
          }
          : {
            type: 'json_object',
          },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${providerLabel} failed with ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const responseBody: unknown = await response.json();

  if (!isRecord(responseBody)) {
    throw new Error(`${providerLabel} response envelope was not an object.`);
  }

  const data: GmsResponsesApiResponse = responseBody;

  if (data.status === 'incomplete') {
    throw new Error(`${providerLabel} response incomplete: ${extractIncompleteReason(data)}`);
  }

  const content = extractOutputText(data);

  return {
    data: JSON.parse(extractJsonObject(content)) as T,
    ...(typeof data.id === 'string' && data.id.trim()
      ? { responseId: data.id.trim() }
      : {}),
    ...(typeof data.model === 'string' && data.model.trim()
      ? { model: data.model.trim() }
      : {}),
  };
}
