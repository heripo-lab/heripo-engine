import type { LedgerStageModels } from '../constants/ledger-run';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createLedgerTaskFromResult,
  getLedgerTaskForSource,
} from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

import type { PublicDemoAuth } from '~/features/upload/hooks/use-public-demo-auth';

/** The ledger task made from a PDF result in this session, and making one. */
export function useLedgerFromResult(taskId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: taskKeys.ledgerTask(taskId),
    queryFn: () => getLedgerTaskForSource(taskId),
  });
  const create = useMutation({
    mutationFn: (input: { models: LedgerStageModels } & PublicDemoAuth) =>
      createLedgerTaskFromResult({ taskId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
  return { query, create };
}
