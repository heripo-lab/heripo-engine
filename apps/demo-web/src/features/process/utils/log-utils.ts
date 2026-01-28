/**
 * Formats an ISO timestamp string to HH:mm:ss format.
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Returns the Tailwind color class for a log level.
 */
export function getLogColor(level: string): string {
  switch (level) {
    case 'error':
      return 'text-red-600';
    case 'warn':
      return 'text-yellow-600';
    case 'info':
      return 'text-green-600';
    case 'debug':
      return 'text-blue-600';
    default:
      return 'text-muted-foreground';
  }
}
