import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type TaskListResponse, deleteTask } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTask,
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() });
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(taskId) });
      await queryClient.cancelQueries({ queryKey: taskKeys.result(taskId) });

      const previousLists = queryClient.getQueriesData<TaskListResponse>({
        queryKey: taskKeys.lists(),
      });

      queryClient.setQueriesData<TaskListResponse>(
        { queryKey: taskKeys.lists() },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            tasks: old.tasks.filter((task) => task.id !== taskId),
            total: old.total - 1,
          };
        },
      );

      return { previousLists };
    },
    onError: (_error, _taskId, context) => {
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: (_, __, taskId) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.removeQueries({ queryKey: taskKeys.result(taskId) });
    },
  });
}
