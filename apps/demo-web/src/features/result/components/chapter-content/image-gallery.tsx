'use client';

// eslint-disable @next/next/no-img-element
import type { ProcessedImage } from '@heripo/model';

import { ImageIcon } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import { useContentViewer } from '~/features/result/contexts/content-viewer-context';
import { resolveImageIds } from '~/features/result/utils/chapter-lookup';

import { PageLink } from './page-link';

interface ImageGalleryProps {
  taskId: string;
  imageIds: string[];
  imageMap: Map<string, ProcessedImage>;
}

export function ImageGallery({
  taskId,
  imageIds,
  imageMap,
}: ImageGalleryProps) {
  const { openImage } = useContentViewer();
  const resolvedImages = resolveImageIds(imageIds, imageMap);

  if (resolvedImages.length === 0) return null;

  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ImageIcon className="h-4 w-4" />
        Images
        <Badge variant="secondary">{resolvedImages.length}</Badge>
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        {resolvedImages.map((image) => (
          <div key={image.id} className="overflow-hidden rounded-lg border">
            <div
              className="bg-muted flex aspect-video cursor-pointer items-center justify-center transition-opacity hover:opacity-80"
              onClick={() => openImage(image.id, imageIds)}
            >
              <img
                src={`/api/tasks/${taskId}/images/${image.id}`}
                alt={
                  image.caption?.fullText ??
                  `Image from page ${image.pdfPageNo}`
                }
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="bg-muted/30 p-3">
              {image.caption ? (
                <div className="space-y-1">
                  {image.caption.num && (
                    <span className="text-sm font-medium">
                      {image.caption.num}
                    </span>
                  )}
                  <p className="text-muted-foreground text-sm">
                    {image.caption.fullText}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  No caption (
                  <PageLink pageNo={image.pdfPageNo} pageType="pdf">
                    PDF page {image.pdfPageNo}
                  </PageLink>
                  )
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
