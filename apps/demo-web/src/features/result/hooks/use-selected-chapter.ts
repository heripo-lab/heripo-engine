'use client';

import type { Chapter } from '@heripo/model';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { findChapterById } from '../utils/chapter-lookup';
import { getChapterPdfPages } from '../utils/page-navigation-utils';

const CHAPTER_PARAM_KEY = 'chapterId';
const PAGE_PARAM_KEY = 'page';

interface UseSelectedChapterOptions {
  chapters?: Chapter[];
}

interface UseSelectedChapterResult {
  selectedChapterId: string | null;
  setSelectedChapterId: (id: string | null) => void;
}

/**
 * Manages selected chapter ID via URL search params.
 * When chapter selection changes, resets page to first page of the chapter.
 */
export function useSelectedChapter(
  options?: UseSelectedChapterOptions,
): UseSelectedChapterResult {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { chapters } = options ?? {};

  const selectedChapterId = searchParams.get(CHAPTER_PARAM_KEY);

  const setSelectedChapterId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());

      if (id) {
        params.set(CHAPTER_PARAM_KEY, id);

        // Reset to first page of the chapter
        if (chapters) {
          const chapter = findChapterById(chapters, id);
          if (chapter) {
            const chapterPages = getChapterPdfPages(chapter);
            if (chapterPages.length > 0) {
              params.set(PAGE_PARAM_KEY, String(chapterPages[0]));
            } else {
              params.delete(PAGE_PARAM_KEY);
            }
          }
        }
      } else {
        params.delete(CHAPTER_PARAM_KEY);
        params.delete(PAGE_PARAM_KEY);
      }

      // Update URL without page reload
      router.push(`?${params.toString()}`, { scroll: false });

      // Scroll to top only on desktop (lg breakpoint = 1024px)
      if (window.innerWidth >= 1024) {
        window.scrollTo({ top: 0 });
      }
    },
    [router, searchParams, chapters],
  );

  return { selectedChapterId, setSelectedChapterId };
}
