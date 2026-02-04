'use client';

import { AlertTriangle, Construction, X } from 'lucide-react';
import { useState } from 'react';

import { KNOWN_LIMITATIONS } from '../constants/known-limitations';
import { useBrowserLanguage } from '../hooks/use-browser-language';

/**
 * Banner component displaying known limitations of the current version.
 * Language is automatically detected from browser settings.
 */
export function KnownLimitationsBanner() {
  const [dismissed, setDismissed] = useState(false);
  const lang = useBrowserLanguage();

  if (dismissed) return null;

  const title = lang === 'ko' ? '알려진 제한사항' : 'Known Limitations';

  return (
    <div className="relative mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 rounded-md p-1 text-amber-600 hover:bg-amber-100 hover:text-amber-800"
        aria-label={lang === 'ko' ? '닫기' : 'Dismiss'}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="pr-6">
          <p className="font-medium text-amber-800">{title}</p>
          <ul className="mt-2 space-y-2 text-sm text-amber-700">
            {KNOWN_LIMITATIONS.map((limitation) => (
              <li key={limitation.id} className="flex items-start gap-2">
                <Construction className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>
                    {lang === 'ko' ? limitation.titleKo : limitation.titleEn}:
                  </strong>{' '}
                  {lang === 'ko'
                    ? limitation.descriptionKo
                    : limitation.descriptionEn}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
