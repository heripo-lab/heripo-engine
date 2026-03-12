import { readDatabase, writeDatabase } from '../index';

const LOCKOUT_DAYS = 7;

export interface WeeklyLockoutStatus {
  locked: boolean;
  lockedUntil: string | null;
}

/**
 * Records a successful session completion for weekly lockout tracking.
 */
export function recordSuccessSession(
  sessionId: string,
  taskId: string,
  completedAt: string,
): void {
  const db = readDatabase();
  db.successSessions.push({
    session_id: sessionId,
    task_id: taskId,
    completed_at: completedAt,
  });
  writeDatabase(db);
}

/**
 * Checks whether a session is locked out due to a successful completion within the last 7 days.
 */
export function getWeeklyLockoutStatus(sessionId: string): WeeklyLockoutStatus {
  const db = readDatabase();
  const now = Date.now();
  const lockoutMs = LOCKOUT_DAYS * 24 * 60 * 60 * 1000;

  const recentSuccess = db.successSessions.find((record) => {
    if (record.session_id !== sessionId) return false;
    const completedAt = new Date(record.completed_at).getTime();
    return now - completedAt < lockoutMs;
  });

  if (recentSuccess) {
    const completedAt = new Date(recentSuccess.completed_at).getTime();
    const lockedUntil = new Date(completedAt + lockoutMs).toISOString();
    return { locked: true, lockedUntil };
  }

  return { locked: false, lockedUntil: null };
}
