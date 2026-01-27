'use client';

import type { TaskStatus } from './use-task-stream';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface UseAutoNavigateOptions {
  status: TaskStatus;
  resultUrl: string | undefined;
  taskId: string;
  delay?: number;
}

/**
 * Automatically navigates to the result page when processing completes.
 */
export function useAutoNavigate({
  status,
  resultUrl,
  taskId,
  delay = 1500,
}: UseAutoNavigateOptions): void {
  const router = useRouter();

  useEffect(() => {
    if (status === 'completed' && resultUrl) {
      const timer = setTimeout(() => {
        router.push(`/result/${taskId}`);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [status, resultUrl, router, taskId, delay]);
}
