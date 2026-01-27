import { AlertTriangle } from 'lucide-react';

interface RateLimitBannerProps {
  message?: string;
  resetsAt?: string;
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

export function RateLimitBanner({
  message = 'Daily limit reached.',
  resetsAt,
}: RateLimitBannerProps) {
  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="font-medium text-amber-800">Rate Limit Reached</p>
          <p className="text-sm text-amber-600">
            {message} The shared daily limit has been reached.
          </p>
          <p className="mt-2 text-sm text-amber-600">
            For unlimited usage, set up a local environment on macOS with your
            own LLM API key.{' '}
            <a
              href="https://github.com/heripo-lab/heripo-engine/blob/main/apps/demo-web/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-800"
            >
              Setup Guide →
            </a>
          </p>
          {resetsAt && (
            <p className="mt-1 text-xs text-amber-500">
              Resets at {formatResetTime(resetsAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
