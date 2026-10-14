import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelCandidateDiscoveryRun,
  fetchCandidateDiscovery,
  fetchCandidateDiscoveryAudit,
  startCandidateDiscoveryRun,
} from '~/lib/api/tasks';
import type { CandidateDiscoveryRunSettings } from '~/lib/ledger/candidate-discovery-run';
import { taskKeys } from '~/lib/query-keys';

export function useCandidateDiscovery(taskId: string) {
  const client = useQueryClient();
  const queryKey = taskKeys.candidates(taskId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchCandidateDiscovery(taskId),
    refetchInterval: (query) =>
      query.state.data?.run?.status === 'running' ? 2000 : false,
  });
  const start = useMutation({
    mutationFn: (settings: CandidateDiscoveryRunSettings) =>
      startCandidateDiscoveryRun(taskId, settings),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const cancel = useMutation({
    mutationFn: () => cancelCandidateDiscoveryRun(taskId),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const audit = useMutation({
    mutationFn: () => fetchCandidateDiscoveryAudit(taskId),
  });
  return { query, start, cancel, audit };
}
