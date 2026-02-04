import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Result - heripo engine',
};

export default function ResultLayout({ children }: { children: ReactNode }) {
  return children;
}
