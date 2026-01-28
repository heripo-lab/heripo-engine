/**
 * Webhook event types.
 */
export type WebhookEventType =
  | 'task.started'
  | 'task.cancelled'
  | 'task.failed'
  | 'task.completed'
  | 'otp.failed'
  | 'otp.locked'
  | 'rate_limit.exceeded'
  | 'cleanup.completed'
  | 'cleanup.failed';

/**
 * Base payload included in all webhook events.
 */
export interface WebhookBasePayload {
  event: WebhookEventType;
  timestamp: string; // ISO 8601
  ip: string;
  userAgent: string;
}

/**
 * Payload for task.started event.
 */
export interface TaskStartedPayload extends WebhookBasePayload {
  event: 'task.started';
  taskId: string;
  sessionId: string;
  filename: string;
  otpMode: boolean;
}

/**
 * Payload for task.cancelled event.
 */
export interface TaskCancelledPayload extends WebhookBasePayload {
  event: 'task.cancelled';
  taskId: string;
  sessionId: string;
  filename: string;
  duration: number; // milliseconds
}

/**
 * Payload for task.failed event.
 */
export interface TaskFailedPayload extends WebhookBasePayload {
  event: 'task.failed';
  taskId: string;
  sessionId: string;
  filename: string;
  duration: number; // milliseconds
  errorCode: string;
  errorMessage: string;
}

/**
 * Payload for task.completed event.
 */
export interface TaskCompletedPayload extends WebhookBasePayload {
  event: 'task.completed';
  taskId: string;
  sessionId: string;
  filename: string;
  duration: number; // milliseconds
  totalPages: number;
  chaptersCount: number;
  imagesCount: number;
  tablesCount: number;
  tokenCostUSD: number;
}

/**
 * Payload for otp.failed event.
 */
export interface OTPFailedPayload extends WebhookBasePayload {
  event: 'otp.failed';
  filename: string;
  remainingAttempts: number;
}

/**
 * Payload for otp.locked event.
 */
export interface OTPLockedPayload extends WebhookBasePayload {
  event: 'otp.locked';
  filename: string;
}

/**
 * Payload for rate_limit.exceeded event.
 */
export interface RateLimitExceededPayload extends WebhookBasePayload {
  event: 'rate_limit.exceeded';
  filename: string;
  dailyLimit: number;
  todayCompleted: number;
}

/**
 * Payload for cleanup.completed event.
 */
export interface CleanupCompletedPayload extends WebhookBasePayload {
  event: 'cleanup.completed';
  deletedCount: number;
  retentionDays: number;
  durationMs: number;
}

/**
 * Payload for cleanup.failed event.
 */
export interface CleanupFailedPayload extends WebhookBasePayload {
  event: 'cleanup.failed';
  retentionDays: number;
  errorMessage: string;
  partialDeletedCount: number;
}

/**
 * Union type for all webhook payloads.
 */
export type WebhookPayload =
  | TaskStartedPayload
  | TaskCancelledPayload
  | TaskFailedPayload
  | TaskCompletedPayload
  | OTPFailedPayload
  | OTPLockedPayload
  | RateLimitExceededPayload
  | CleanupCompletedPayload
  | CleanupFailedPayload;
