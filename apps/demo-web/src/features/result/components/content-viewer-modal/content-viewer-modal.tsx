'use client';

import type { MouseEvent as ReactMouseEvent } from 'react';

import type { ModalInstance } from '../../contexts/content-viewer-context';

import {
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '~/components/ui/button';

import { useContentViewer } from '../../contexts/content-viewer-context';
import { DraggableResizableModal } from './draggable-modal';

// Extra space for header, footer, and padding
const MODAL_CHROME_HEIGHT = 160;
const MODAL_PADDING = 32;
const MODAL_OFFSET_STEP = 30;

interface SingleModalProps {
  modal: ModalInstance;
  index: number;
}

function SingleModal({ modal, index }: SingleModalProps) {
  const {
    taskId,
    totalPages,
    closeModal,
    goToPrevPage,
    goToNextPage,
    goToPrevImage,
    goToNextImage,
    zoomIn,
    zoomOut,
    setZoomLevel,
    bringToFront,
  } = useContentViewer();
  const [mounted, setMounted] = useState(false);
  const [initialSize, setInitialSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [hasSetInitialSize, setHasSetInitialSize] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isModifierPressed, setIsModifierPressed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const { contentType, currentPage, currentImage } = modal;

  // Track Ctrl/Cmd key state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setIsModifierPressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        setIsModifierPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Lock body scroll only when Ctrl/Cmd is pressed (for zoom)
  useEffect(() => {
    if (!isModifierPressed) return;

    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;

    return () => {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('position');
      document.body.style.removeProperty('width');
      document.body.style.removeProperty('top');
      window.scrollTo(0, scrollY);
    };
  }, [isModifierPressed]);

  // Client-side only mounting for portal
  useEffect(() => {
    setMounted(true);
    return () => {
      setInitialSize(null);
      setHasSetInitialSize(false);
    };
  }, []);

  // Calculate modal size based on image dimensions (only on first image load)
  const handleImageLoad = useCallback(() => {
    // Only set size once when modal first opens
    if (hasSetInitialSize) return;

    const img = imageRef.current;
    if (!img) return;

    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;
    const imgRatio = imgWidth / imgHeight;

    // Target: 80% of viewport, maintaining aspect ratio
    const maxWidth = window.innerWidth * 0.8;
    const maxHeight = window.innerHeight * 0.85;
    const availableHeight = maxHeight - MODAL_CHROME_HEIGHT;

    let modalWidth: number;
    let modalHeight: number;

    if (imgRatio > 1) {
      // Landscape image
      modalWidth = Math.min(maxWidth, imgWidth + MODAL_PADDING);
      const contentHeight = modalWidth / imgRatio;
      modalHeight = contentHeight + MODAL_CHROME_HEIGHT;

      if (modalHeight > maxHeight) {
        modalHeight = maxHeight;
        const adjustedContentHeight = availableHeight;
        modalWidth = adjustedContentHeight * imgRatio + MODAL_PADDING;
      }
    } else {
      // Portrait or square image
      const contentHeight = Math.min(availableHeight, imgHeight);
      modalHeight = contentHeight + MODAL_CHROME_HEIGHT;
      modalWidth = contentHeight * imgRatio + MODAL_PADDING;

      if (modalWidth > maxWidth) {
        modalWidth = maxWidth;
        const adjustedContentHeight = (modalWidth - MODAL_PADDING) / imgRatio;
        modalHeight = adjustedContentHeight + MODAL_CHROME_HEIGHT;
      }
    }

    setInitialSize({
      width: Math.max(400, modalWidth),
      height: Math.max(300, modalHeight),
    });
    setHasSetInitialSize(true);
  }, [hasSetInitialSize]);

  const getDownloadUrl = useCallback(() => {
    if (contentType === 'page' && currentPage) {
      return `/api/tasks/${taskId}/pages/${currentPage.pageIndex}`;
    }
    if (contentType === 'image' && currentImage) {
      return `/api/tasks/${taskId}/images/${currentImage.imageId}`;
    }
    return '';
  }, [contentType, currentPage, currentImage, taskId]);

  const getDownloadFilename = useCallback(() => {
    if (contentType === 'page' && currentPage) {
      return `page-${currentPage.pdfPageNo}.png`;
    }
    if (contentType === 'image' && currentImage) {
      return `image-${currentImage.imageId}.png`;
    }
    return 'image.png';
  }, [contentType, currentPage, currentImage]);

  const handleDownload = useCallback(() => {
    const url = getDownloadUrl();
    if (!url) return;

    const link = document.createElement('a');
    link.href = url;
    link.download = getDownloadFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [getDownloadUrl, getDownloadFilename]);

  // Reset image position when image changes
  useEffect(() => {
    setImagePosition({ x: 0, y: 0 });
  }, [currentPage?.pageIndex, currentImage?.imageId]);

  // Handle image drag
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (modal.zoomLevel <= 1) return;
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    },
    [modal.zoomLevel],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setImagePosition((prev) => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY,
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart]);

  // Handle zoom with Ctrl/Cmd + wheel and prevent page scroll
  useEffect(() => {
    const handleWheelCapture = (e: WheelEvent) => {
      // Only handle events that occur within this modal
      if (!modalRef.current?.contains(e.target as Node)) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Zoom logic
        const delta = -e.deltaY * 0.002;
        const newZoom = modal.zoomLevel + delta;
        setZoomLevel(modal.id, newZoom);
      }
    };

    window.addEventListener('wheel', handleWheelCapture, {
      passive: false,
      capture: true,
    });

    return () => {
      window.removeEventListener('wheel', handleWheelCapture, {
        capture: true,
      });
    };
  }, [modal.id, modal.zoomLevel, setZoomLevel]);

  if (!mounted) {
    return null;
  }

  if (contentType === 'page' && !currentPage) {
    return null;
  }

  if (contentType === 'image' && !currentImage) {
    return null;
  }

  const offset = {
    x: index * MODAL_OFFSET_STEP,
    y: index * MODAL_OFFSET_STEP,
  };

  let imageUrl: string;
  let altText: string;
  let canGoPrev: boolean;
  let canGoNext: boolean;
  let headerTitle: string;
  let headerSubtitle: string;
  let onPrev: () => void;
  let onNext: () => void;

  if (contentType === 'page' && currentPage) {
    imageUrl = `/api/tasks/${taskId}/pages/${currentPage.pageIndex}`;
    altText = currentPage.label;
    canGoPrev = currentPage.pdfPageNo > 1;
    canGoNext = currentPage.pdfPageNo < totalPages;
    headerTitle = currentPage.label;
    headerSubtitle = `(${currentPage.pdfPageNo} / ${totalPages})`;
    onPrev = () => goToPrevPage(modal.id);
    onNext = () => goToNextPage(modal.id);
  } else if (contentType === 'image' && currentImage) {
    imageUrl = `/api/tasks/${taskId}/images/${currentImage.imageId}`;
    altText = `Image ${currentImage.imageIndex + 1}`;
    canGoPrev = currentImage.imageIndex > 0;
    canGoNext = currentImage.imageIndex < currentImage.imageIds.length - 1;
    headerTitle = `Image ${currentImage.imageIndex + 1} of ${currentImage.imageIds.length}`;
    headerSubtitle = '';
    onPrev = () => goToPrevImage(modal.id);
    onNext = () => goToNextImage(modal.id);
  } else {
    return null;
  }

  const zoomPercentage = Math.round(modal.zoomLevel * 100);

  const header = (
    <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
      <div className="text-sm font-medium">
        {headerTitle}
        {headerSubtitle && (
          <span className="text-muted-foreground ml-2">{headerSubtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomOut(modal.id)}
          disabled={modal.zoomLevel <= 0.5}
          className="h-8 w-8"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground w-12 text-center text-sm font-medium">
          {zoomPercentage}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomIn(modal.id)}
          disabled={modal.zoomLevel >= 3}
          className="h-8 w-8"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDownload}
          className="h-8 w-8"
          title="Download image"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => closeModal(modal.id)}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const footer = (
    <div className="flex shrink-0 items-center justify-between border-t px-4 py-3">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={!canGoPrev}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Previous
      </Button>
      <span className="text-muted-foreground text-sm">
        Use arrow keys to navigate
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={!canGoNext}
      >
        Next
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );

  const modalContent = (
    <div ref={modalRef}>
      <DraggableResizableModal
        modalId={modal.id}
        header={header}
        footer={footer}
        initialWidth={initialSize?.width}
        initialHeight={initialSize?.height}
        initialOffset={offset}
        zIndex={modal.zIndex}
        onClose={() => closeModal(modal.id)}
        onBringToFront={() => bringToFront(modal.id)}
      >
        {/* Image container */}
        <div className="bg-muted/30 flex-1 overflow-hidden p-4">
          <div className="flex min-h-full items-center justify-center">
            <img
              ref={imageRef}
              src={imageUrl}
              alt={altText}
              className="max-h-full max-w-full object-contain shadow-lg"
              style={{
                transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${modal.zoomLevel})`,
                transformOrigin: 'center',
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                cursor:
                  modal.zoomLevel > 1
                    ? isDragging
                      ? 'grabbing'
                      : 'grab'
                    : 'default',
                userSelect: 'none',
              }}
              onLoad={handleImageLoad}
              onMouseDown={handleMouseDown}
            />
          </div>
        </div>
      </DraggableResizableModal>
    </div>
  );

  return createPortal(modalContent, document.body);
}

export function ContentViewerModal() {
  const { state } = useContentViewer();

  return (
    <>
      {state.modals.map((modal, index) => (
        <SingleModal key={modal.id} modal={modal} index={index} />
      ))}
    </>
  );
}
