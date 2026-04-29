export const REVIEW_ASSISTANCE_MIN_CONCURRENCY = 1;
export const REVIEW_ASSISTANCE_MAX_CONCURRENCY = 10;

export interface ReviewAssistanceOptions {
  /** Enable page-level review assistance. Defaults to false. */
  enabled?: boolean;
  /** Concurrent page-level review calls. Defaults to 1 and clamps to 1..10. */
  concurrency?: number;
  /** Minimum final confidence for direct mutation. Defaults to 0.85. */
  autoApplyThreshold?: number;
  /** Minimum final confidence for sidecar proposals. Defaults to 0.5. */
  proposalThreshold?: number;
  /** Maximum retries per page-level VLM call. Defaults to 3. */
  maxRetries?: number;
  /** VLM generation temperature. Defaults to 0. */
  temperature?: number;
}

export interface NormalizedReviewAssistanceOptions {
  enabled: boolean;
  concurrency: number;
  autoApplyThreshold: number;
  proposalThreshold: number;
  maxRetries: number;
  temperature: number;
}

export type ReviewAssistanceProgressSubstage =
  | 'review-assistance:prepare'
  | 'review-assistance:page'
  | 'review-assistance:patch'
  | 'review-assistance:write-report';

export type ReviewAssistanceProgressStatus =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed';

export interface ReviewAssistanceProgressEvent {
  substage: ReviewAssistanceProgressSubstage;
  status: ReviewAssistanceProgressStatus;
  reportId: string;
  pageNo?: number;
  pageCount?: number;
  completedPages?: number;
  failedPages?: number;
  commandCount?: number;
  autoAppliedCount?: number;
  proposalCount?: number;
  message?: string;
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
};

function normalizeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeConcurrency(value: number | undefined): number {
  return Math.floor(
    clamp(
      normalizeNumber(value, REVIEW_ASSISTANCE_DEFAULTS.concurrency),
      REVIEW_ASSISTANCE_MIN_CONCURRENCY,
      REVIEW_ASSISTANCE_MAX_CONCURRENCY,
    ),
  );
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

export function normalizeReviewAssistanceOptions(
  value: ReviewAssistanceOptionInput,
  concurrencyAlias?: number,
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
    concurrency: normalizeConcurrency(
      objectOptions?.concurrency ?? concurrencyAlias,
    ),
    autoApplyThreshold,
    proposalThreshold,
    maxRetries: normalizeMaxRetries(objectOptions?.maxRetries),
    temperature: normalizeThreshold(
      objectOptions?.temperature,
      REVIEW_ASSISTANCE_DEFAULTS.temperature,
    ),
  };
}

export function isReviewAssistanceEnabled(
  value: ReviewAssistanceOptionInput,
  concurrencyAlias?: number,
): boolean {
  return normalizeReviewAssistanceOptions(value, concurrencyAlias).enabled;
}
