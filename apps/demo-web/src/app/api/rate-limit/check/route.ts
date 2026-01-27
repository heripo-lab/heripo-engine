import { NextResponse } from 'next/server';

import {
  getNextResetTime,
  getUsageStatus,
} from '~/lib/db/repositories/usage-repository';

export async function GET() {
  const status = getUsageStatus();
  const resetsAt = getNextResetTime().toISOString();

  return NextResponse.json({
    canCreate: status.canCreate,
    reason: status.reason,
    todayCompleted: status.todayCompleted,
    dailyLimit: status.dailyLimit,
    remaining: status.remaining,
    resetsAt,
    activeTask: status.activeTask,
  });
}
