'use client';

import type { PageRange } from '@heripo/model';

import { Eye, FileText } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';

import { useContentViewer } from '../../contexts/content-viewer-context';

interface PageIndicatorProps {
  pdfPageNo: number;
  pageRangeMap: Record<number, PageRange>;
  className?: string;
}

/**
 * Displays prominent page number indicator with both PDF and document page.
 * Clicking opens the page viewer modal.
 */
export function PageIndicator({
  pdfPageNo,
  pageRangeMap,
  className,
}: PageIndicatorProps) {
  const { openPage } = useContentViewer();
  const pageRange = pageRangeMap[pdfPageNo];
  const documentPage = pageRange?.startPageNo;

  const handleClick = () => {
    openPage(pdfPageNo, 'pdf');
  };

  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className="gap-2 font-semibold"
      >
        <FileText className="h-4 w-4" />
        PDF {pdfPageNo}
        {documentPage && documentPage !== pdfPageNo && (
          <span className="text-muted-foreground">
            ({documentPage}
            {pageRange.endPageNo !== pageRange.startPageNo &&
              `-${pageRange.endPageNo}`}
            p)
          </span>
        )}
        <Eye className="text-muted-foreground ml-1 h-3 w-3" />
      </Button>
      {documentPage && (
        <Badge variant="secondary" className="text-xs">
          Document Page {documentPage}
          {pageRange.endPageNo !== pageRange.startPageNo &&
            `-${pageRange.endPageNo}`}
        </Badge>
      )}
    </div>
  );
}
