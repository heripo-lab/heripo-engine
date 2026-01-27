'use client';

import type { PageRange } from '@heripo/model';
import type { ReactNode } from 'react';

import type { PageType, PageViewInfo } from '../utils/page-range-utils';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getTotalPdfPages,
  resolvePageViewInfo,
} from '../utils/page-range-utils';

type ModalContentType = 'page' | 'image';

interface ImageViewInfo {
  imageId: string;
  imageIndex: number;
  imageIds: string[];
}

export interface ModalInstance {
  id: string;
  contentType: ModalContentType;
  currentPage: PageViewInfo | null;
  currentImage: ImageViewInfo | null;
  zoomLevel: number;
  zIndex: number;
}

interface ContentViewerState {
  modals: ModalInstance[];
}

interface ContentViewerContextValue {
  state: ContentViewerState;
  taskId: string;
  pageRangeMap: Record<number, PageRange>;
  totalPages: number;
  openPage: (pageNo: number, pageType: PageType) => void;
  closeModal: (modalId: string) => void;
  goToPrevPage: (modalId: string) => void;
  goToNextPage: (modalId: string) => void;
  openImage: (imageId: string, imageIds: string[]) => void;
  goToPrevImage: (modalId: string) => void;
  goToNextImage: (modalId: string) => void;
  setZoomLevel: (modalId: string, level: number) => void;
  zoomIn: (modalId: string) => void;
  zoomOut: (modalId: string) => void;
  resetZoom: (modalId: string) => void;
  bringToFront: (modalId: string) => void;
}

const ContentViewerContext = createContext<ContentViewerContextValue | null>(
  null,
);

interface ContentViewerProviderProps {
  children: ReactNode;
  pageRangeMap: Record<number, PageRange>;
  taskId: string;
  totalPages: number;
}

export function ContentViewerProvider({
  children,
  pageRangeMap,
  taskId,
  totalPages: totalPagesFromProps,
}: ContentViewerProviderProps) {
  const [state, setState] = useState<ContentViewerState>({
    modals: [],
  });

  const nextZIndexRef = useRef(51);

  const totalPages = useMemo(() => {
    const fromMap = getTotalPdfPages(pageRangeMap);
    return fromMap > 0 ? fromMap : totalPagesFromProps;
  }, [pageRangeMap, totalPagesFromProps]);

  const openPage = useCallback(
    (pageNo: number, pageType: PageType) => {
      const pageInfo = resolvePageViewInfo(pageNo, pageType, pageRangeMap);
      if (pageInfo) {
        const newModal: ModalInstance = {
          id: crypto.randomUUID(),
          contentType: 'page',
          currentPage: pageInfo,
          currentImage: null,
          zoomLevel: 1,
          zIndex: nextZIndexRef.current++,
        };
        setState((prev) => ({
          modals: [...prev.modals, newModal],
        }));
      }
    },
    [pageRangeMap],
  );

  const closeModal = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.filter((modal) => modal.id !== modalId),
    }));
  }, []);

  const goToPrevPage = useCallback(
    (modalId: string) => {
      setState((prev) => ({
        modals: prev.modals.map((modal) => {
          if (modal.id !== modalId || !modal.currentPage) return modal;
          if (modal.currentPage.pdfPageNo <= 1) return modal;

          const pageInfo = resolvePageViewInfo(
            modal.currentPage.pdfPageNo - 1,
            'pdf',
            pageRangeMap,
          );
          if (!pageInfo) return modal;

          return {
            ...modal,
            currentPage: pageInfo,
          };
        }),
      }));
    },
    [pageRangeMap],
  );

  const goToNextPage = useCallback(
    (modalId: string) => {
      setState((prev) => ({
        modals: prev.modals.map((modal) => {
          if (modal.id !== modalId || !modal.currentPage) return modal;
          if (modal.currentPage.pdfPageNo >= totalPages) return modal;

          const pageInfo = resolvePageViewInfo(
            modal.currentPage.pdfPageNo + 1,
            'pdf',
            pageRangeMap,
          );
          if (!pageInfo) return modal;

          return {
            ...modal,
            currentPage: pageInfo,
          };
        }),
      }));
    },
    [pageRangeMap, totalPages],
  );

  const openImage = useCallback((imageId: string, imageIds: string[]) => {
    const imageIndex = imageIds.indexOf(imageId);
    if (imageIndex === -1) return;

    const newModal: ModalInstance = {
      id: crypto.randomUUID(),
      contentType: 'image',
      currentPage: null,
      currentImage: {
        imageId,
        imageIndex,
        imageIds,
      },
      zoomLevel: 1,
      zIndex: nextZIndexRef.current++,
    };
    setState((prev) => ({
      modals: [...prev.modals, newModal],
    }));
  }, []);

  const goToPrevImage = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId || !modal.currentImage) return modal;

        const { imageIndex, imageIds } = modal.currentImage;
        if (imageIndex <= 0) return modal;

        const newImageId = imageIds[imageIndex - 1];
        return {
          ...modal,
          currentImage: {
            imageId: newImageId,
            imageIndex: imageIndex - 1,
            imageIds,
          },
        };
      }),
    }));
  }, []);

  const goToNextImage = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId || !modal.currentImage) return modal;

        const { imageIndex, imageIds } = modal.currentImage;
        if (imageIndex >= imageIds.length - 1) return modal;

        const newImageId = imageIds[imageIndex + 1];
        return {
          ...modal,
          currentImage: {
            imageId: newImageId,
            imageIndex: imageIndex + 1,
            imageIds,
          },
        };
      }),
    }));
  }, []);

  const setZoomLevel = useCallback((modalId: string, level: number) => {
    const clampedLevel = Math.max(0.5, Math.min(3, level));
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId) return modal;
        return {
          ...modal,
          zoomLevel: clampedLevel,
        };
      }),
    }));
  }, []);

  const zoomIn = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId) return modal;
        const newLevel = Math.min(3, modal.zoomLevel + 0.25);
        return {
          ...modal,
          zoomLevel: newLevel,
        };
      }),
    }));
  }, []);

  const zoomOut = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId) return modal;
        const newLevel = Math.max(0.5, modal.zoomLevel - 0.25);
        return {
          ...modal,
          zoomLevel: newLevel,
        };
      }),
    }));
  }, []);

  const resetZoom = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId) return modal;
        return {
          ...modal,
          zoomLevel: 1,
        };
      }),
    }));
  }, []);

  const bringToFront = useCallback((modalId: string) => {
    setState((prev) => ({
      modals: prev.modals.map((modal) => {
        if (modal.id !== modalId) return modal;
        return {
          ...modal,
          zIndex: nextZIndexRef.current++,
        };
      }),
    }));
  }, []);

  const value = useMemo(
    () => ({
      state,
      taskId,
      pageRangeMap,
      totalPages,
      openPage,
      closeModal,
      goToPrevPage,
      goToNextPage,
      openImage,
      goToPrevImage,
      goToNextImage,
      setZoomLevel,
      zoomIn,
      zoomOut,
      resetZoom,
      bringToFront,
    }),
    [
      state,
      taskId,
      pageRangeMap,
      totalPages,
      openPage,
      closeModal,
      goToPrevPage,
      goToNextPage,
      openImage,
      goToPrevImage,
      goToNextImage,
      setZoomLevel,
      zoomIn,
      zoomOut,
      resetZoom,
      bringToFront,
    ],
  );

  return (
    <ContentViewerContext.Provider value={value}>
      {children}
    </ContentViewerContext.Provider>
  );
}

export function useContentViewer() {
  const context = useContext(ContentViewerContext);
  if (!context) {
    throw new Error(
      'useContentViewer must be used within ContentViewerProvider',
    );
  }
  return context;
}
