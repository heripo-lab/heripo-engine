'use client';

import type { TaskStatus } from './use-task-stream';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface UseAutoNavigateOptions {
  status: TaskStatus;
  resultUrl: string | undefined;
  taskId: string;
  kind?: 'raw-data' | 'ledger';
  delay?: number;
  disabled?: boolean;
}

/**
 * Automatically navigates when processing completes: raw-data tasks go to
 * the result page, ledger tasks go to the preprocessed document validation
 * page (the ledger result page is not designed yet).
 */
export function useAutoNavigate({
  status,
  resultUrl,
  taskId,
  kind = 'raw-data',
  delay = 1500,
  disabled = false,
}: UseAutoNavigateOptions): void {
  const router = useRouter();

  useEffect(() => {
    if (disabled) return;

    if (status === 'completed' && resultUrl) {
      const destination =
        kind === 'ledger'
          ? `/ledger/validation/${taskId}`
          : `/result/${taskId}`;
      const timer = setTimeout(() => {
        router.push(destination);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [status, resultUrl, router, taskId, kind, delay, disabled]);
}
