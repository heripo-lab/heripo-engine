/**
 * Next.js instrumentation hook.
 * Called when the server starts, used to initialize scheduled tasks.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initScheduledCleanup } =
      await import('./lib/cleanup/scheduled-cleanup');
    initScheduledCleanup();
  }
}
