import { useQuery } from '@tanstack/react-query';

import { fetchTaskResult } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

interface UseTaskResultOptions {
  enabled?: boolean;
  retryOnNotCompleted?: boolean;
}

export function useTaskResult(
  taskId: string | null,
  options: UseTaskResultOptions = {},
) {
  const { enabled = true, retryOnNotCompleted = true } = options;

  return useQuery({
    queryKey: taskKeys.result(taskId ?? ''),
    queryFn: () => fetchTaskResult(taskId!),
    enabled: enabled && !!taskId,
    retry: (failureCount, error) => {
      if (retryOnNotCompleted && error instanceof Error) {
        if (error.message.includes('not completed') && failureCount < 3) {
          return true;
        }
      }
      return failureCount < 1;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000),
  });
}
