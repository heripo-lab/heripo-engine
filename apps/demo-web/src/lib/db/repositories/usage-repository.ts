import { readDatabase } from '../index';

export interface UsageStatus {
  canCreate: boolean;
  reason?: string;
  todayCompleted: number;
  dailyLimit: number;
  remaining: number;
  activeTask: {
    id: string;
    status: 'queued' | 'running';
  } | null;
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

  // Count today's completed tasks (UTC timezone)
  // OTP bypass tasks are excluded from the count
  const todayCompleted = db.tasks.filter(
    (t) =>
      t.status === 'completed' &&
      t.completed_at?.startsWith(todayUTC) &&
      !t.is_otp_bypass,
  ).length;

  // Find active task (queued or running)
  const activeTask = db.tasks.find(
    (t) => t.status === 'queued' || t.status === 'running',
  );

  const remaining = Math.max(0, limit - todayCompleted);

  // Block if there's an active task
  if (activeTask) {
    return {
      canCreate: false,
      reason:
        'A task is currently in progress. Please try again after it completes.',
      todayCompleted,
      dailyLimit: limit,
      remaining,
      activeTask: {
        id: activeTask.id,
        status: activeTask.status as 'queued' | 'running',
      },
    };
  }

  // Block if daily limit reached
  if (todayCompleted >= limit) {
    return {
      canCreate: false,
      reason: `Daily limit (${limit} ${limit === 1 ? 'task' : 'tasks'}) reached. Please try again tomorrow.`,
      todayCompleted,
      dailyLimit: limit,
      remaining: 0,
      activeTask: null,
    };
  }

  // Allow
  return {
    canCreate: true,
    todayCompleted,
    dailyLimit: limit,
    remaining,
    activeTask: null,
  };
}
