import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Processing - heripo engine',
};

export default function ProcessLayout({ children }: { children: ReactNode }) {
  return children;
}
