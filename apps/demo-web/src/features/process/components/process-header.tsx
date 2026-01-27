import type { TaskStatus } from '../hooks/use-task-stream';

import { Square } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';

interface ProcessHeaderProps {
  status: TaskStatus;
  filename: string;
  isSample?: boolean;
  onCancel: () => void;
  isCancelling: boolean;
}

function getStatusMessage(status: TaskStatus, filename: string): string {
  switch (status) {
    case 'completed':
      return 'Processing complete! Redirecting to results...';
    case 'failed':
      return 'Processing failed. Please try again.';
    case 'cancelled':
      return 'Processing cancelled.';
    default:
      return `Processing ${filename}`;
  }
}

export function ProcessHeader({
  status,
  filename,
  isSample = false,
  onCancel,
  isCancelling,
}: ProcessHeaderProps) {
  const isProcessing = status === 'queued' || status === 'running';

  return (
    <div className="flex items-start justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Raw Data Extraction
          </h1>
          {isSample && <Badge variant="sample">Sample</Badge>}
        </div>
        <p className="text-muted-foreground">
          {getStatusMessage(status, filename)}
        </p>
      </div>
      {isProcessing && !isSample && (
        <Button
          variant="destructive"
          onClick={onCancel}
          disabled={isCancelling}
        >
          <Square className="mr-2 h-4 w-4" />
          {isCancelling ? 'Cancelling...' : 'Cancel'}
        </Button>
      )}
    </div>
  );
}
