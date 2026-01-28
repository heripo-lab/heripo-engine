'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '~/components/ui/button';

interface PagePaginationProps {
  currentPage: number;
  currentPageIndex: number;
  totalPages: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
}

/**
 * Pagination controls for page-by-page navigation.
 * Displays Previous/Next buttons with page indicator.
 */
export function PagePagination({
  currentPage,
  currentPageIndex,
  totalPages,
  canGoPrev,
  canGoNext,
  onPrevPage,
  onNextPage,
}: PagePaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="mt-6 flex items-center justify-between border-t pt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrevPage}
        disabled={!canGoPrev}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Previous
      </Button>
      <span className="text-muted-foreground text-sm">
        {currentPageIndex + 1} / {totalPages} (PDF p.{currentPage})
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onNextPage}
        disabled={!canGoNext}
      >
        Next
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
}
