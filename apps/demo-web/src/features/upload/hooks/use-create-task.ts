import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createTask } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
