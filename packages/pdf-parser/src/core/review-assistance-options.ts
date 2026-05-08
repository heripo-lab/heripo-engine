export type {
  ReviewAssistanceProgressEvent,
  ReviewAssistanceProgressStatus,
  ReviewAssistanceProgressSubstage,
} from '@heripo/model';

export interface ReviewAssistanceOptions {
  /** Enable page-level review assistance. Defaults to false. */
  enabled?: boolean;
  /** Minimum final confidence for direct mutation. Defaults to 0.85. */
  autoApplyThreshold?: number;
  /** Minimum final confidence for sidecar proposals. Defaults to 0.5. */
  proposalThreshold?: number;
  /** Maximum retries per page-level VLM call. Defaults to 3. */
  maxRetries?: number;
  /** VLM generation temperature. Defaults to 0. */
  temperature?: number;
  /** Language for human-readable review reasons. Defaults to English. */
  outputLanguage?: string;
}

export interface NormalizedReviewAssistanceOptions {
  enabled: boolean;
  concurrency: number;
  autoApplyThreshold: number;
  proposalThreshold: number;
  maxRetries: number;
  temperature: number;
  outputLanguage: string;
}

export type ReviewAssistanceOptionInput =
  | boolean
  | ReviewAssistanceOptions
  | undefined;

export const REVIEW_ASSISTANCE_DEFAULTS: NormalizedReviewAssistanceOptions = {
  enabled: false,
  concurrency: 1,
  autoApplyThreshold: 0.85,
  proposalThreshold: 0.5,
  maxRetries: 3,
  temperature: 0,
  outputLanguage: 'en-US',
};

function normalizeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeThreshold(
  value: number | undefined,
  fallback: number,
): number {
  return clamp(normalizeNumber(value, fallback), 0, 1);
}

function normalizeMaxRetries(value: number | undefined): number {
  return Math.floor(
    Math.max(0, normalizeNumber(value, REVIEW_ASSISTANCE_DEFAULTS.maxRetries)),
  );
}

function normalizeOutputLanguage(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || REVIEW_ASSISTANCE_DEFAULTS.outputLanguage;
}

export function normalizeReviewAssistanceOptions(
  value: ReviewAssistanceOptionInput,
): NormalizedReviewAssistanceOptions {
  const objectOptions =
    typeof value === 'object' && value !== null ? value : undefined;
  const proposalThreshold = normalizeThreshold(
    objectOptions?.proposalThreshold,
    REVIEW_ASSISTANCE_DEFAULTS.proposalThreshold,
  );
  const autoApplyThreshold = Math.max(
    normalizeThreshold(
      objectOptions?.autoApplyThreshold,
      REVIEW_ASSISTANCE_DEFAULTS.autoApplyThreshold,
    ),
    proposalThreshold,
  );

  return {
    enabled:
      typeof value === 'boolean'
        ? value
        : (objectOptions?.enabled ?? REVIEW_ASSISTANCE_DEFAULTS.enabled),
    concurrency: REVIEW_ASSISTANCE_DEFAULTS.concurrency,
    autoApplyThreshold,
    proposalThreshold,
    maxRetries: normalizeMaxRetries(objectOptions?.maxRetries),
    temperature: normalizeThreshold(
      objectOptions?.temperature,
      REVIEW_ASSISTANCE_DEFAULTS.temperature,
    ),
    outputLanguage: normalizeOutputLanguage(objectOptions?.outputLanguage),
  };
}

export function isReviewAssistanceEnabled(
  value: ReviewAssistanceOptionInput,
): boolean {
  return normalizeReviewAssistanceOptions(value).enabled;
}
