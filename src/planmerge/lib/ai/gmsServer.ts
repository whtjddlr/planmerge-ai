export type GmsConfig = {
  apiKey?: string;
  apiUrl: string;
  model: string;
};

type GmsResponseContent = {
  text?: unknown;
};

type GmsResponsesApiResponse = {
  status?: unknown;
  incomplete_details?: unknown;
  stop_reason?: unknown;
  output_text?: unknown;
  output?: unknown;
  choices?: unknown;
  content?: unknown;
  candidates?: unknown;
};

const DEFAULT_GMS_API_URL = 'https://gms.ssafy.io/gmsapi/api.openai.com/v1/responses';
const DEFAULT_GMS_MODEL = 'gpt-4.1';
// 업스트림이 응답을 물고 있으면 분석 라우트가 초안 수만큼의 병렬 요청을
// 함수 타임아웃까지 잡고 있게 되므로 요청 단위로 끊는다.
const GMS_REQUEST_TIMEOUT_MS = Number(process.env.GMS_REQUEST_TIMEOUT_MS ?? 120_000);
const CHAT_COMPLETIONS_PATH = '/chat/completions';
const ANTHROPIC_MESSAGES_PATH = 'api.anthropic.com/v1/messages';
const GEMINI_GENERATE_CONTENT_PATH = 'generativelanguage.googleapis.com';

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

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    return extractJsonObject(fencedMatch[1]);
  }

  const start = trimmed.indexOf('{');
  const end = start >= 0 ? findJsonObjectEnd(trimmed, start) : -1;

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error('GMS response did not contain a JSON object.');
}

function findJsonObjectEnd(content: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
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
  const chatContent = textFromMessageContent(message?.content);
  if (chatContent) {
    return chatContent;
  }

  const anthropicText = textFromAnthropicContent(data.content);
  if (anthropicText) {
    return anthropicText;
  }

  const geminiText = textFromGeminiCandidates(data.candidates);
  if (geminiText) {
    return geminiText;
  }

  const refusal = typeof message?.refusal === 'string' && message.refusal.trim()
    ? ` refusal=${message.refusal.trim().slice(0, 160)}`
    : '';
  const finishReason = finishReasonFromResponse(data, firstChoice);
  const status = typeof data.status === 'string' ? data.status : 'unknown';
  throw new Error(
    `GMS API response did not include text content. status=${status} finish_reason=${finishReason}${refusal}`,
  );
}

function isChatCompletionsUrl(apiUrl: string) {
  return apiUrl.includes(CHAT_COMPLETIONS_PATH);
}

function isAnthropicMessagesUrl(apiUrl: string) {
  return apiUrl.includes(ANTHROPIC_MESSAGES_PATH);
}

function isGeminiGenerateContentUrl(apiUrl: string) {
  return apiUrl.includes(GEMINI_GENERATE_CONTENT_PATH);
}

function isGpt5FamilyModel(model: string) {
  return model.toLowerCase().startsWith('gpt-5');
}

function textFromMessageContent(content: unknown) {
  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter(isRecord)
    .map((item) => {
      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    })
    .join('')
    .trim();

  return text || undefined;
}

function textFromAnthropicContent(content: unknown) {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter(isRecord)
    .map((item) => typeof item.text === 'string' ? item.text : '')
    .join('\n')
    .trim();

  return text || undefined;
}

function textFromGeminiCandidates(candidates: unknown) {
  if (!Array.isArray(candidates)) {
    return undefined;
  }

  const firstCandidate = candidates.find(isRecord);
  const content = isRecord(firstCandidate?.content) ? firstCandidate.content : undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .filter(isRecord)
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim();

  return text || undefined;
}

function finishReasonFromResponse(
  data: GmsResponsesApiResponse,
  firstChoice: unknown,
) {
  if (isRecord(firstChoice) && typeof firstChoice.finish_reason === 'string') {
    return firstChoice.finish_reason;
  }

  const firstCandidate = Array.isArray(data.candidates)
    ? data.candidates.find(isRecord)
    : undefined;
  if (isRecord(firstCandidate) && typeof firstCandidate.finishReason === 'string') {
    return firstCandidate.finishReason;
  }

  if (isRecord(data) && typeof data.stop_reason === 'string') {
    return data.stop_reason;
  }

  return 'unknown';
}

function buildGmsRequestBody(
  apiUrl: string,
  selectedModel: string,
  prompt: string,
  maxOutputTokens: number,
) {
  if (isChatCompletionsUrl(apiUrl)) {
    return {
      model: selectedModel,
      messages: [
        {
          role: 'developer',
          content: 'Return valid JSON only. Do not use Markdown or commentary outside JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_completion_tokens: maxOutputTokens,
      response_format: {
        type: 'json_object',
      },
    };
  }

  if (isAnthropicMessagesUrl(apiUrl)) {
    return {
      model: selectedModel,
      max_tokens: maxOutputTokens,
      system: 'Return valid JSON only. Do not use Markdown or commentary outside JSON.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };
  }

  if (isGeminiGenerateContentUrl(apiUrl)) {
    return {
      contents: [
        {
          parts: [
            {
              text: [
                'Return valid JSON only. Do not use Markdown or commentary outside JSON.',
                '',
                prompt,
              ].join('\n'),
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens,
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };
  }

  return {
    model: selectedModel,
    input: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    ...(isGpt5FamilyModel(selectedModel) ? {} : { temperature: 0.1 }),
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_object',
      },
    },
  };
}

function buildGmsHeaders(apiUrl: string, apiKey: string): Record<string, string> {
  if (isAnthropicMessagesUrl(apiUrl)) {
    return {
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION ?? '2023-06-01',
      'Content-Type': 'application/json',
    };
  }

  if (isGeminiGenerateContentUrl(apiUrl)) {
    return {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
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
    headers: buildGmsHeaders(apiUrl, apiKey),
    body: JSON.stringify(buildGmsRequestBody(
      apiUrl,
      selectedModel,
      prompt,
      options.maxOutputTokens,
    )),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GMS API failed with ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const responseBody: unknown = await response.json();

  if (!isRecord(responseBody)) {
    throw new Error('GMS API response envelope was not an object.');
  }

  const data: GmsResponsesApiResponse = responseBody;

  if (data.status === 'incomplete') {
    throw new Error(`GMS response incomplete: ${extractIncompleteReason(data)}`);
  }

  const content = extractOutputText(data);

  return JSON.parse(extractJsonObject(content)) as T;
}
