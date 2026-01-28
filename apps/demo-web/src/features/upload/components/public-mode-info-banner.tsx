import { Info } from 'lucide-react';

interface PublicModeInfoBannerProps {
  todayCompleted: number;
  dailyLimit: number;
  remaining: number;
  resetsAt: string;
}

function formatResetTime(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function PublicModeInfoBanner({
  todayCompleted: _todayCompleted,
  dailyLimit,
  remaining,
  resetsAt,
}: PublicModeInfoBannerProps) {
  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-3">
        <Info className="h-5 w-5 flex-shrink-0 text-blue-600" />
        <div className="flex-1">
          <p className="font-medium text-blue-800">Online Demo</p>
          <p className="text-sm text-blue-600">
            This demo shares a global daily limit of {dailyLimit}{' '}
            {dailyLimit === 1 ? 'task' : 'tasks'} across all users ({remaining}{' '}
            remaining).
          </p>
          <p className="mt-1 text-sm text-blue-600">
            For unlimited usage, run locally with your own LLM API key.{' '}
            <a
              href="https://github.com/heripo-lab/heripo-engine/blob/main/apps/demo-web/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-800"
            >
              Setup Guide →
            </a>
          </p>
          <p className="mt-1 text-xs text-blue-500">
            Usage resets at {formatResetTime(resetsAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
