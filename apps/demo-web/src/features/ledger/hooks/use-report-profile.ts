import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchReportProfile,
  runReportRouterRequest,
  saveReportProfileRequest,
} from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useReportProfile(taskId: string) {
  const client = useQueryClient();
  const queryKey = taskKeys.reportProfile(taskId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchReportProfile(taskId),
  });
  const save = useMutation({
    mutationFn: (profile: unknown) => saveReportProfileRequest(taskId, profile),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const route = useMutation({
    mutationFn: (modelId: string) => runReportRouterRequest(taskId, modelId),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  return { query, save, route };
}
