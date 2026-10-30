import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deletePlaceAliasesRequest,
  fetchPlaceAliases,
  savePlaceAliasesRequest,
} from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

/** The task's place alias table; saving or removing it reassembles the ledger. */
export function usePlaceAliases(taskId: string) {
  const client = useQueryClient();
  const queryKey = taskKeys.placeAliases(taskId);
  const refresh = () => {
    client.invalidateQueries({ queryKey });
    client.invalidateQueries({ queryKey: taskKeys.ledger(taskId) });
  };
  const query = useQuery({
    queryKey,
    queryFn: () => fetchPlaceAliases(taskId),
  });
  const save = useMutation({
    mutationFn: (table: unknown) => savePlaceAliasesRequest(taskId, table),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deletePlaceAliasesRequest(taskId),
    onSuccess: refresh,
  });
  return { query, save, remove };
}
