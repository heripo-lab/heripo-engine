export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: { limit?: number; offset?: number; status?: string }) =>
    [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (taskId: string) => [...taskKeys.details(), taskId] as const,
  results: () => [...taskKeys.all, 'result'] as const,
  result: (taskId: string) => [...taskKeys.results(), taskId] as const,
};

export const rateLimitKeys = {
  all: ['rateLimit'] as const,
  check: () => [...rateLimitKeys.all, 'check'] as const,
};
