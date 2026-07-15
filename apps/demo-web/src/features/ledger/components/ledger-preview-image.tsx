'use client';

import { ImageOff } from 'lucide-react';
import { useState } from 'react';

/**
 * Only external http(s) URLs are rendered as images. ProcessedImage.path is
 * expected to be a full public CDN URL produced by the heripo-web export
 * script; anything else is shown as plain text.
 */
function isRenderableImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface LedgerPreviewImageProps {
  id: string;
  pdfPageNo: number;
  url: string;
}

/**
 * Sample image tile for the ledger preview result. A failed image load
 * degrades to a placeholder so it never breaks the result page.
 */
export function LedgerPreviewImage({
  id,
  pdfPageNo,
  url,
}: LedgerPreviewImageProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const renderable = isRenderableImageUrl(url) && !loadFailed;

  return (
    <div className="space-y-2 rounded-md border p-3">
      {renderable ? (
        // Plain <img>: external CDN URLs have unknown hosts and the
        // next/image remote host allowlist is intentionally not widened
        <img
          src={url}
          alt={`Sample image ${id}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-40 w-full rounded object-contain"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <div className="bg-muted/50 text-muted-foreground flex h-40 w-full items-center justify-center rounded">
          <div className="flex flex-col items-center gap-2 text-xs">
            <ImageOff className="h-6 w-6" />
            {loadFailed ? 'Image failed to load' : 'Not a renderable URL'}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {id}
          <span className="text-muted-foreground font-normal">
            {' '}
            · PDF page {pdfPageNo}
          </span>
        </p>
        <p className="text-muted-foreground text-xs break-all">{url}</p>
      </div>
    </div>
  );
}
