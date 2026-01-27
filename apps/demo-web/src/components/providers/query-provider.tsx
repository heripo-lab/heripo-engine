'use client';

import type { ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';

import { getQueryClient } from '~/lib/query-client';

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
