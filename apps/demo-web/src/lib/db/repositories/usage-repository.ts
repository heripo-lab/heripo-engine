import { readDatabase } from '../index';

export interface UsageStatus {
  canCreate: boolean;
  reason?: string;
  todayUsed: number;
  dailyLimit: number;
  remaining: number;
  activeTaskCount: number;
}

function getTodayUTC(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextResetTime(): Date {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return tomorrow;
}

export function getUsageStatus(): UsageStatus {
  const db = readDatabase();
  const todayUTC = getTodayUTC();
  const limit = parseInt(process.env.DAILY_LIMIT || '1', 10);
  // 0 = no concurrent limit, 1+ = max concurrent tasks allowed
  const parsedConcurrentLimit = parseInt(
    process.env.CONCURRENT_TASK_LIMIT || '1',
    10,
  );
  const concurrentLimit =
    Number.isNaN(parsedConcurrentLimit) || parsedConcurrentLimit < 0
      ? 1
      : parsedConcurrentLimit;

  // Count today's completed tasks (UTC timezone)
  // OTP bypass tasks are excluded from the count
  const todayCompleted = db.tasks.filter(
    (t) =>
      t.status === 'completed' &&
      t.completed_at?.startsWith(todayUTC) &&
      !t.is_otp_bypass,
  ).length;

  // Count active tasks (queued or running)
  const activeTaskCount = db.tasks.filter(
    (t) => t.status === 'queued' || t.status === 'running',
  ).length;

  // Count active non-OTP tasks toward daily usage
  const activeNonOtpCount = db.tasks.filter(
    (t) =>
      (t.status === 'queued' || t.status === 'running') &&
      !t.is_otp_bypass &&
      t.created_at.startsWith(todayUTC),
  ).length;

  // Include both completed and in-progress tasks in daily usage
  const todayUsed = todayCompleted + activeNonOtpCount;
  const remaining = Math.max(0, limit - todayUsed);

  // Block if concurrent task limit is exceeded
  if (concurrentLimit > 0 && activeTaskCount >= concurrentLimit) {
    const reason =
      concurrentLimit === 1
        ? 'A task is currently in progress. Please try again after it completes.'
        : `Concurrent task limit (${concurrentLimit}) reached. Please try again after a running task completes.`;
    return {
      canCreate: false,
      reason,
      todayUsed,
      dailyLimit: limit,
      remaining,
      activeTaskCount,
    };
  }

  // Block if daily limit reached
  if (todayUsed >= limit) {
    return {
      canCreate: false,
      reason: `Daily limit (${limit} ${limit === 1 ? 'task' : 'tasks'}) reached. Please try again tomorrow.`,
      todayUsed,
      dailyLimit: limit,
      remaining: 0,
      activeTaskCount,
    };
  }

  // Allow
  return {
    canCreate: true,
    todayUsed,
    dailyLimit: limit,
    remaining,
    activeTaskCount,
  };
}
