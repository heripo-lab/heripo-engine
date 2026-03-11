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
    todayUsed: status.todayUsed,
    dailyLimit: status.dailyLimit,
    remaining: status.remaining,
    resetsAt,
    activeTaskCount: status.activeTaskCount,
  });
}
