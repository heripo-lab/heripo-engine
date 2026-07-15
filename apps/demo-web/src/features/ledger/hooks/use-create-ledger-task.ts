import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createLedgerTask } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useCreateLedgerTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createLedgerTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
