import { useQuery } from '@tanstack/react-query';

import { fetchUsdToKrw } from '~/lib/cost/exchange-rate';

/**
 * Hook to fetch and cache USD to KRW exchange rate
 *
 * Caches for 1 hour to minimize API calls.
 */
export function useExchangeRate(enabled = true) {
  return useQuery({
    queryKey: ['exchange-rate', 'usd-krw'],
    queryFn: fetchUsdToKrw,
    enabled,
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}
