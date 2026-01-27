'use client';

import Script from 'next/script';

import { publicModeConfig } from '~/lib/config/public-mode';

export function GoogleAnalytics() {
  const { isPublicMode, gaMeasurementId } = publicModeConfig;

  // Public mode가 아니거나 Measurement ID가 없으면 GA 비활성화
  if (!isPublicMode || !gaMeasurementId) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaMeasurementId}');
        `}
      </Script>
    </>
  );
}
