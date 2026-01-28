'use client';

import { Monitor, X } from 'lucide-react';
import { useState } from 'react';

export function MobileWarningBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="relative mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 md:hidden">
      <div className="flex items-center gap-2 pr-8 text-sm">
        <Monitor className="h-4 w-4 shrink-0" />
        <p>
          This page is optimized for desktop. For the best experience, please
          use a PC.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 hover:bg-amber-100"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
