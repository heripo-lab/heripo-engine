import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Space_Grotesk } from 'next/font/google';

import { GoogleAnalytics } from '~/components/analytics/google-analytics';
import { Footer } from '~/components/layout/footer';
import { Header } from '~/components/layout/header';
import { QueryProvider } from '~/components/providers/query-provider';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'heripo engine - Archaeological Data Pipeline',
  description:
    'Extract, standardize, and transform archaeological excavation report data',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${spaceGrotesk.variable} bg-background min-h-screen font-sans antialiased`}
      >
        <GoogleAnalytics />
        <QueryProvider>
          <div className="relative flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
