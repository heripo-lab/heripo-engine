/**
 * Configuration for scheduled task cleanup.
 * Only active when NEXT_PUBLIC_HERIPO_OFFICIAL_DEMO is true.
 */
export const cleanupConfig = {
  /** Whether cleanup is enabled (only in official demo mode) */
  enabled: process.env.NEXT_PUBLIC_HERIPO_OFFICIAL_DEMO === 'true',

  /** Number of days to retain task data before deletion */
  retentionDays: parseInt(
    process.env.NEXT_PUBLIC_DATA_RETENTION_DAYS || '7',
    10,
  ),

  /** Cron schedule: UTC 16:00 = KST 01:00 (daily at 1 AM KST) */
  cronSchedule: '0 16 * * *',
};
