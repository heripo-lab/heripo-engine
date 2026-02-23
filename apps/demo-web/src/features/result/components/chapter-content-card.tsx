'use client';

import type {
  Chapter,
  PageRange,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
} from '@heripo/model';

import { useMemo } from 'react';

import { Card, CardContent, CardHeader } from '~/components/ui/card';
import {
  createFootnoteLookupMap,
  createImageLookupMap,
  createTableLookupMap,
  findChapterById,
  findContentRedirectTarget,
} from '~/features/result/utils/chapter-lookup';
import {
  filterFootnoteIdsByPage,
  filterImageIdsByPage,
  filterTableIdsByPage,
  filterTextBlocksByPage,
} from '~/features/result/utils/page-navigation-utils';

import {
  ChapterHeader,
  EmptyPageContent,
  EmptyState,
  FootnoteList,
  ImageGallery,
  PageIndicator,
  PagePagination,
  TableViewer,
  TextBlockList,
} from './chapter-content';

interface ChapterContentCardProps {
  taskId: string;
  chapters: Chapter[];
  images: ProcessedImage[];
  tables: ProcessedTable[];
  footnotes: ProcessedFootnote[];
  selectedChapterId: string | null;
  pageRangeMap: Record<number, PageRange>;
  // Page navigation props
  currentPage: number;
  currentPageIndex: number;
  totalPages: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export function ChapterContentCard({
  taskId,
  chapters,
  images,
  tables,
  footnotes,
  selectedChapterId,
  pageRangeMap,
  currentPage,
  currentPageIndex,
  totalPages,
  canGoPrev,
  canGoNext,
  onPrevPage,
  onNextPage,
}: ChapterContentCardProps) {
  const selectedChapter = useMemo(
    () => findChapterById(chapters, selectedChapterId),
    [chapters, selectedChapterId],
  );

  // When the selected chapter is empty, resolve content from
  // the first sibling/descendant with content on the same page (alias).
  const contentChapter = useMemo(
    () =>
      selectedChapterId
        ? (findContentRedirectTarget(chapters, selectedChapterId) ??
          selectedChapter)
        : selectedChapter,
    [chapters, selectedChapterId, selectedChapter],
  );

  const imageMap = useMemo(() => createImageLookupMap(images), [images]);
  const tableMap = useMemo(() => createTableLookupMap(tables), [tables]);
  const footnoteMap = useMemo(
    () => createFootnoteLookupMap(footnotes),
    [footnotes],
  );

  // Filter content by current page (uses contentChapter which may alias to a sibling)
  const pageTextBlocks = useMemo(
    () =>
      contentChapter
        ? filterTextBlocksByPage(contentChapter.textBlocks, currentPage)
        : [],
    [contentChapter, currentPage],
  );

  const pageImageIds = useMemo(
    () =>
      contentChapter
        ? filterImageIdsByPage(contentChapter.imageIds, imageMap, currentPage)
        : [],
    [contentChapter, imageMap, currentPage],
  );

  const pageTableIds = useMemo(
    () =>
      contentChapter
        ? filterTableIdsByPage(contentChapter.tableIds, tableMap, currentPage)
        : [],
    [contentChapter, tableMap, currentPage],
  );

  const pageFootnoteIds = useMemo(
    () =>
      contentChapter
        ? filterFootnoteIdsByPage(
            contentChapter.footnoteIds,
            footnoteMap,
            currentPage,
          )
        : [],
    [contentChapter, footnoteMap, currentPage],
  );

  const isPageEmpty =
    pageTextBlocks.length === 0 &&
    pageImageIds.length === 0 &&
    pageTableIds.length === 0 &&
    pageFootnoteIds.length === 0;

  if (!selectedChapter) {
    return <EmptyState hasChapters={chapters.length > 0} />;
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <ChapterHeader chapter={selectedChapter} />
        <PageIndicator
          pdfPageNo={currentPage}
          pageRangeMap={pageRangeMap}
          className="mt-3"
        />
      </CardHeader>
      <CardContent className="space-y-6">
        {isPageEmpty ? (
          <EmptyPageContent pdfPageNo={currentPage} />
        ) : (
          <>
            {pageTextBlocks.length > 0 && (
              <TextBlockList textBlocks={pageTextBlocks} />
            )}

            {pageImageIds.length > 0 && (
              <ImageGallery
                taskId={taskId}
                imageIds={pageImageIds}
                imageMap={imageMap}
              />
            )}

            {pageTableIds.length > 0 && (
              <TableViewer tableIds={pageTableIds} tableMap={tableMap} />
            )}

            {pageFootnoteIds.length > 0 && (
              <FootnoteList
                footnoteIds={pageFootnoteIds}
                footnoteMap={footnoteMap}
              />
            )}
          </>
        )}

        <PagePagination
          currentPage={currentPage}
          currentPageIndex={currentPageIndex}
          totalPages={totalPages}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPrevPage={onPrevPage}
          onNextPage={onNextPage}
        />
      </CardContent>
    </Card>
  );
}
