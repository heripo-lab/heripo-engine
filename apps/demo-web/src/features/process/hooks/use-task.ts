'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchTask } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useTask(taskId: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(taskId ?? ''),
    queryFn: () => fetchTask(taskId!),
    enabled: !!taskId,
  });
}
