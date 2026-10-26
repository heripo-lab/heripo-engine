import { useQuery } from '@tanstack/react-query';

import { fetchArchaeologyLedger } from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

/** `revision` (the thin run's completion time) refetches the ledger when a run finishes. */
export function useArchaeologyLedger(taskId: string, revision: string | null) {
  return useQuery({
    queryKey: [...taskKeys.ledger(taskId), revision],
    queryFn: () => fetchArchaeologyLedger(taskId),
  });
}
