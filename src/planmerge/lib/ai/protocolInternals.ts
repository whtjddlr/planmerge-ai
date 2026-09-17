/**
 * 검증·보정 모듈이 같이 쓰는 내부 도구 — 허용값 Set과 형태 검사 헬퍼.
 *
 * 공개 API가 아니다. `planmergeProtocol.ts` 배럴은 이 파일을 re-export하지 않는다.
 */
import type { LocalDraftSubmission, ProjectSettings } from '../localWorkspace';
import { documentSectionDefinitions } from './protocolTypes';
import type {
  DecisionSelectionSource,
  DocumentSectionKey,
  NormalizedIdeaIntent,
  NormalizedIdeaType,
  PlanMergeAnalysisPayload,
  ProtocolDecisionBlock,
  ProtocolDecisionOption,
} from './protocolTypes';

export const selectionSources = new Set<DecisionSelectionSource>(['merge', 'decision_room', 'human']);
export const sectionKeys = new Set<DocumentSectionKey>(documentSectionDefinitions.map((section) => section.key));
export const documentTypes = new Set<ProjectSettings['documentType']>([
  'service_plan',
  'prd',
  'business_plan',
  'feature_spec',
]);
export const aiModels = new Set<LocalDraftSubmission['aiModel']>([
  'ChatGPT',
  'Claude',
  'Gemini',
  'Cursor',
  'Other',
]);
export const draftStatuses = new Set<LocalDraftSubmission['status']>([
  'submitted',
  'parsed',
  'failed',
]);
export const ideaTypes = new Set<NormalizedIdeaType>([
  'problem',
  'target_user',
  'feature',
  'scope',
  'requirement',
  'metric',
  'risk',
  'open_question',
  'flow',
  'solution',
]);
export const ideaIntents = new Set<NormalizedIdeaIntent>([
  'propose',
  'warn',
  'require',
  'assume',
  'question',
]);
export const optionTypes = new Set<ProtocolDecisionOption['optionType']>([
  'selected',
  'alternative',
  'conflict',
]);
export const conflictLevels = new Set<ProtocolDecisionBlock['conflictLevel']>([
  'none',
  'low',
  'medium',
  'high',
]);
export const conflictSeverities = new Set<NonNullable<ProtocolDecisionOption['severity']>>([
  'low',
  'medium',
  'high',
]);

export type PayloadParseResult =
  | {
    valid: true;
    payload: PlanMergeAnalysisPayload;
    errors: [];
  }
  | {
    valid: false;
    errors: string[];
  };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  options: {
    required?: boolean;
    maxLength?: number;
    fallback?: string;
  } = {},
) {
  const value = record[key];

  if (typeof value !== 'string') {
    if (options.required) {
      errors.push(`${key} must be a string`);
    }

    return options.fallback ?? '';
  }

  const trimmedValue = value.trim();

  if (options.required && !trimmedValue) {
    errors.push(`${key} must not be empty`);
  }

  if (options.maxLength && trimmedValue.length > options.maxLength) {
    errors.push(`${key} must be ${options.maxLength} characters or fewer`);
  }

  return trimmedValue;
}

export function isNumberInRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
