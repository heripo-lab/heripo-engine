import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchContentAttachment,
  fetchContentAttachmentAudit,
  fetchThinContentAttachmentResult,
  prepareContentAttachmentPreview,
  runFirstContentAttachment,
  runThinContentAttachment,
  stopThinContentAttachment,
} from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useContentAttachment(taskId: string) {
  const client = useQueryClient();
  const queryKey = taskKeys.contentAttachment(taskId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchContentAttachment(taskId),
    refetchInterval: (q) =>
      q.state.data?.run?.status === 'running' ||
      q.state.data?.thin?.status === 'running'
        ? 2000
        : false,
  });
  const prepare = useMutation({
    mutationFn: (maxUnitChars: number) =>
      prepareContentAttachmentPreview(taskId, maxUnitChars),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const execute = useMutation({
    mutationFn: () => runFirstContentAttachment(taskId),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const audit = useMutation({
    mutationFn: () => fetchContentAttachmentAudit(taskId),
  });
  const runThin = useMutation({
    mutationFn: (budget: {
      maxCalls: number;
      maxTotalTokens: number;
      modelId: string;
    }) => runThinContentAttachment(taskId, budget),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const stopThin = useMutation({
    mutationFn: () => stopThinContentAttachment(taskId),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const thinResult = useMutation({
    mutationFn: () => fetchThinContentAttachmentResult(taskId),
  });
  return { query, prepare, execute, audit, runThin, stopThin, thinResult };
}
