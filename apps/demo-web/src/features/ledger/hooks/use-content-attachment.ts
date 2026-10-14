import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchContentAttachment,
  fetchContentAttachmentAudit,
  prepareContentAttachmentPreview,
  runFirstContentAttachment,
} from '~/lib/api/tasks';
import { taskKeys } from '~/lib/query-keys';

export function useContentAttachment(taskId: string) {
  const client = useQueryClient();
  const queryKey = taskKeys.contentAttachment(taskId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchContentAttachment(taskId),
    refetchInterval: (q) =>
      q.state.data?.run?.status === 'running' ? 2000 : false,
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
  return { query, prepare, execute, audit };
}
