'use client';

import { useEffect, useState } from 'react';

export type SupportedLanguage = 'ko' | 'en';

/**
 * Hook to detect browser language and return 'ko' for Korean, 'en' for others.
 * Defaults to 'en' during SSR to avoid hydration mismatch.
 */
export function useBrowserLanguage(): SupportedLanguage {
  const [language, setLanguage] = useState<SupportedLanguage>('en');

  useEffect(() => {
    const browserLang = navigator.language || navigator.languages?.[0] || 'en';
    setLanguage(browserLang.startsWith('ko') ? 'ko' : 'en');
  }, []);

  return language;
}
