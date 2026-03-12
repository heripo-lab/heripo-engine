import { NextResponse } from 'next/server';

import { getWeeklyLockoutStatus } from '~/lib/db/repositories/success-session-repository';
import {
  getNextResetTime,
  getUsageStatus,
} from '~/lib/db/repositories/usage-repository';
import { getOrCreateSessionId } from '~/lib/session';

export async function GET() {
  const sessionId = await getOrCreateSessionId();
  const status = getUsageStatus();
  const resetsAt = getNextResetTime().toISOString();

  const lockout = getWeeklyLockoutStatus(sessionId);

  return NextResponse.json({
    canCreate: lockout.locked ? false : status.canCreate,
    reason: lockout.locked
      ? 'You have already completed a task this week. Please try again later.'
      : status.reason,
    todayUsed: status.todayUsed,
    dailyLimit: status.dailyLimit,
    remaining: status.remaining,
    resetsAt,
    activeTaskCount: status.activeTaskCount,
    weeklyLocked: lockout.locked,
    weeklyLockedUntil: lockout.lockedUntil,
  });
}
