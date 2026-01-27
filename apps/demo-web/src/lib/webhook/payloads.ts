import type {
  CleanupCompletedPayload,
  CleanupFailedPayload,
  OTPFailedPayload,
  OTPLockedPayload,
  RateLimitExceededPayload,
  TaskCancelledPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskStartedPayload,
} from './types';

function createTimestamp(): string {
  return new Date().toISOString();
}

function calculateDuration(startedAt: string | null): number {
  if (!startedAt) return 0;
  return Date.now() - new Date(startedAt).getTime();
}

export function createTaskStartedPayload(params: {
  ip: string;
  userAgent: string;
  taskId: string;
  sessionId: string;
  filename: string;
  otpMode: boolean;
}): TaskStartedPayload {
  return {
    event: 'task.started',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    taskId: params.taskId,
    sessionId: params.sessionId,
    filename: params.filename,
    otpMode: params.otpMode,
  };
}

export function createTaskCancelledPayload(params: {
  ip: string;
  userAgent: string;
  taskId: string;
  sessionId: string;
  filename: string;
  startedAt: string | null;
}): TaskCancelledPayload {
  return {
    event: 'task.cancelled',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    taskId: params.taskId,
    sessionId: params.sessionId,
    filename: params.filename,
    duration: calculateDuration(params.startedAt),
  };
}

export function createTaskFailedPayload(params: {
  ip: string;
  userAgent: string;
  taskId: string;
  sessionId: string;
  filename: string;
  startedAt: string | null;
  errorCode: string;
  errorMessage: string;
}): TaskFailedPayload {
  return {
    event: 'task.failed',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    taskId: params.taskId,
    sessionId: params.sessionId,
    filename: params.filename,
    duration: calculateDuration(params.startedAt),
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  };
}

export function createTaskCompletedPayload(params: {
  ip: string;
  userAgent: string;
  taskId: string;
  sessionId: string;
  filename: string;
  startedAt: string | null;
  totalPages: number;
  chaptersCount: number;
  imagesCount: number;
  tablesCount: number;
  tokenCostUSD: number;
}): TaskCompletedPayload {
  return {
    event: 'task.completed',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    taskId: params.taskId,
    sessionId: params.sessionId,
    filename: params.filename,
    duration: calculateDuration(params.startedAt),
    totalPages: params.totalPages,
    chaptersCount: params.chaptersCount,
    imagesCount: params.imagesCount,
    tablesCount: params.tablesCount,
    tokenCostUSD: params.tokenCostUSD,
  };
}

export function createOTPFailedPayload(params: {
  ip: string;
  userAgent: string;
  filename: string;
  remainingAttempts: number;
}): OTPFailedPayload {
  return {
    event: 'otp.failed',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    filename: params.filename,
    remainingAttempts: params.remainingAttempts,
  };
}

export function createOTPLockedPayload(params: {
  ip: string;
  userAgent: string;
  filename: string;
}): OTPLockedPayload {
  return {
    event: 'otp.locked',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    filename: params.filename,
  };
}

export function createRateLimitExceededPayload(params: {
  ip: string;
  userAgent: string;
  filename: string;
  dailyLimit: number;
  todayCompleted: number;
}): RateLimitExceededPayload {
  return {
    event: 'rate_limit.exceeded',
    timestamp: createTimestamp(),
    ip: params.ip,
    userAgent: params.userAgent,
    filename: params.filename,
    dailyLimit: params.dailyLimit,
    todayCompleted: params.todayCompleted,
  };
}

export function createCleanupCompletedPayload(params: {
  deletedCount: number;
  retentionDays: number;
  durationMs: number;
}): CleanupCompletedPayload {
  return {
    event: 'cleanup.completed',
    timestamp: createTimestamp(),
    ip: 'system',
    userAgent: 'system',
    deletedCount: params.deletedCount,
    retentionDays: params.retentionDays,
    durationMs: params.durationMs,
  };
}

export function createCleanupFailedPayload(params: {
  retentionDays: number;
  errorMessage: string;
  partialDeletedCount: number;
}): CleanupFailedPayload {
  return {
    event: 'cleanup.failed',
    timestamp: createTimestamp(),
    ip: 'system',
    userAgent: 'system',
    retentionDays: params.retentionDays,
    errorMessage: params.errorMessage,
    partialDeletedCount: params.partialDeletedCount,
  };
}
