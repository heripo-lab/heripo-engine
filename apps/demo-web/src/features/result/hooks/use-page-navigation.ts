'use client';

import type {
  Chapter,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
} from '@heripo/model';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import {
  findChapterById,
  findContentRedirectTarget,
} from '../utils/chapter-lookup';
import {
  findChapterForPage,
  getAllPdfPages,
  getChapterPdfPages,
} from '../utils/page-navigation-utils';

const PAGE_PARAM_KEY = 'page';
const CHAPTER_PARAM_KEY = 'chapterId';

interface UsePageNavigationProps {
  chapters: Chapter[];
  images: ProcessedImage[];
  tables: ProcessedTable[];
  footnotes: ProcessedFootnote[];
  totalPdfPages: number;
}

interface UsePageNavigationResult {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  goToPrevPage: () => void;
  goToNextPage: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  allPages: number[];
  currentPageIndex: number;
  totalPages: number;
}

/**
 * Manages page navigation via URL params with cross-chapter support.
 * When navigating to a page in a different chapter, updates chapterId automatically.
 */
export function usePageNavigation({
  chapters,
  images,
  tables,
  footnotes,
  totalPdfPages,
}: UsePageNavigationProps): UsePageNavigationResult {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPageParam = searchParams.get(PAGE_PARAM_KEY);
  const currentChapterId = searchParams.get(CHAPTER_PARAM_KEY);

  // Get all pages that have content
  const allPages = useMemo(() => {
    const pages = getAllPdfPages(chapters, images, tables, footnotes);
    // If no content pages found, generate range from 1 to totalPdfPages
    if (pages.length === 0 && totalPdfPages > 0) {
      return Array.from({ length: totalPdfPages }, (_, i) => i + 1);
    }
    return pages;
  }, [chapters, images, tables, footnotes, totalPdfPages]);

  // Parse current page from URL (default to first page of chapter or first page overall)
  const currentPage = useMemo(() => {
    if (currentPageParam) {
      const parsed = parseInt(currentPageParam, 10);
      if (!isNaN(parsed) && allPages.includes(parsed)) {
        return parsed;
      }
    }
    // If chapter is selected, return first page of that chapter
    if (currentChapterId) {
      const chapter = findChapterById(chapters, currentChapterId);
      if (chapter) {
        let chapterPages = getChapterPdfPages(chapter);

        // Empty chapter: use content redirect target's pages
        if (chapterPages.length === 0) {
          const redirectTarget = findContentRedirectTarget(
            chapters,
            currentChapterId,
          );
          if (redirectTarget) {
            chapterPages = getChapterPdfPages(redirectTarget);
          }
        }

        if (chapterPages.length > 0) {
          return chapterPages[0];
        }
      }
    }
    // Default to first page with content
    return allPages[0] ?? 1;
  }, [currentPageParam, currentChapterId, chapters, allPages]);

  const currentPageIndex = allPages.indexOf(currentPage);
  const totalPages = allPages.length;

  const setCurrentPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(PAGE_PARAM_KEY, String(page));

      // Find which chapter owns this page and update chapterId
      const targetChapter = findChapterForPage(chapters, page);
      if (targetChapter) {
        params.set(CHAPTER_PARAM_KEY, targetChapter.id);
      }

      router.push(`?${params.toString()}`, { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [router, searchParams, chapters],
  );

  const canGoPrev = currentPageIndex > 0;
  const canGoNext = currentPageIndex >= 0 && currentPageIndex < totalPages - 1;

  const goToPrevPage = useCallback(() => {
    if (canGoPrev) {
      setCurrentPage(allPages[currentPageIndex - 1]);
    }
  }, [canGoPrev, setCurrentPage, allPages, currentPageIndex]);

  const goToNextPage = useCallback(() => {
    if (canGoNext) {
      setCurrentPage(allPages[currentPageIndex + 1]);
    }
  }, [canGoNext, setCurrentPage, allPages, currentPageIndex]);

  return {
    currentPage,
    setCurrentPage,
    goToPrevPage,
    goToNextPage,
    canGoPrev,
    canGoNext,
    allPages,
    currentPageIndex,
    totalPages,
  };
}
