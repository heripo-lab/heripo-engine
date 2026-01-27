import { useQuery } from '@tanstack/react-query';

import { publicModeConfig } from '~/lib/config/public-mode';
import { rateLimitKeys } from '~/lib/query-keys';

export interface RateLimitCheckResponse {
  canCreate: boolean;
  reason?: string;
  todayCompleted: number;
  dailyLimit: number;
  remaining: number;
  resetsAt: string;
  activeTask: {
    id: string;
    status: 'queued' | 'running';
  } | null;
}

export function useRateLimitCheck() {
  return useQuery({
    queryKey: rateLimitKeys.check(),
    queryFn: async (): Promise<RateLimitCheckResponse> => {
      const response = await fetch('/api/rate-limit/check');
      if (!response.ok) {
        throw new Error('Failed to fetch rate limit status');
      }
      return response.json();
    },
    enabled: publicModeConfig.isPublicMode,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every 60 seconds
  });
}
