import { useQuery } from '@tanstack/react-query';

import { fetchDocumentResourceIndex } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useDocumentResourceIndex(taskId: string) {
  return useQuery({
    queryKey: taskKeys.resourceIndex(taskId),
    queryFn: () => fetchDocumentResourceIndex(taskId),
    staleTime: Infinity,
  });
}
