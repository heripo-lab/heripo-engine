import { useQuery } from '@tanstack/react-query';

import { type FetchTasksParams, fetchTasks } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useTasks(options: FetchTasksParams = {}) {
  return useQuery({
    queryKey: taskKeys.list(options),
    queryFn: () => fetchTasks(options),
  });
}
