// eslint-disable jsx-a11y/no-noninteractive-element-interactions

'use client';

import type { DragEndEvent } from '@dnd-kit/core';
import type { ReactNode } from 'react';

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '~/lib/utils';

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface DraggableContentProps {
  modalId: string;
  children: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  width: number;
  height: number;
  onResizeStart: (e: ReactMouseEvent) => void;
  isResizing: boolean;
}

function DraggableContent({
  modalId,
  children,
  header,
  footer,
  width,
  height,
  onResizeStart,
  isResizing,
}: DraggableContentProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: modalId,
    });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        width,
        height,
      }
    : { width, height };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-background pointer-events-auto relative flex flex-col rounded-lg border shadow-2xl',
        isDragging && 'cursor-grabbing opacity-95',
      )}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="bg-muted/50 flex h-10 shrink-0 cursor-grab items-center justify-center border-b active:cursor-grabbing"
      >
        <GripHorizontal className="text-muted-foreground h-5 w-5" />
      </div>
      {/* Header */}
      {header}
      {/* Content */}
      {children}
      {/* Footer */}
      {footer}
      {/* Resize handle - visible grip indicator */}
      <div
        onMouseDown={onResizeStart}
        className={cn(
          'absolute right-0 bottom-0 flex h-6 w-6 cursor-se-resize items-end justify-end p-1',
          'hover:bg-muted/50 rounded-br-lg transition-colors',
          isResizing && 'bg-muted',
        )}
      >
        {/* Three diagonal lines as resize indicator */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="text-muted-foreground"
        >
          <path
            d="M9 1L1 9M9 5L5 9M9 9L9 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

interface DraggableResizableModalProps {
  modalId: string;
  children: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  initialWidth?: number;
  initialHeight?: number;
  initialOffset?: { x: number; y: number };
  zIndex: number;
  onClose?: () => void;
  onBringToFront?: () => void;
}

export function DraggableResizableModal({
  modalId,
  children,
  header,
  footer,
  initialWidth,
  initialHeight,
  initialOffset,
  zIndex,
  onClose,
  onBringToFront,
}: DraggableResizableModalProps) {
  const [position, setPosition] = useState({
    x: initialOffset?.x ?? 0,
    y: initialOffset?.y ?? 0,
  });
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const labelId = useId();
  const [size, setSize] = useState(() => {
    // Default: 70% of viewport, respecting min sizes
    const defaultWidth = Math.max(
      MIN_WIDTH,
      Math.min(window.innerWidth * 0.7, 1200),
    );
    const defaultHeight = Math.max(
      MIN_HEIGHT,
      Math.min(window.innerHeight * 0.8, 900),
    );
    return {
      width: initialWidth ?? defaultWidth,
      height: initialHeight ?? defaultHeight,
    };
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Update size when initialWidth/initialHeight changes (image loaded)
  useEffect(() => {
    if (initialWidth && initialHeight) {
      setSize({ width: initialWidth, height: initialHeight });
    }
  }, [initialWidth, initialHeight]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { delta } = event;
    setPosition((prev) => ({
      x: prev.x + delta.x,
      y: prev.y + delta.y,
    }));
  }, []);

  // Focus trap: save previous focus and restore on unmount
  useEffect(() => {
    previousActiveElement.current = document.activeElement;

    // Focus the modal container
    const timer = setTimeout(() => {
      const focusable = modalRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusable && focusable.length > 0) {
        (focusable[0] as HTMLElement).focus({ preventScroll: true });
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      // Restore focus to previously focused element
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus({ preventScroll: true });
      }
    };
  }, []);

  // Handle keyboard events for focus trap and escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusableElements =
        modalRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[
        focusableElements.length - 1
      ] as HTMLElement;

      // Shift+Tab on first element -> go to last
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
      // Tab on last element -> go to first
      else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    },
    [onClose],
  );

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: size.width,
        height: size.height,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - resizeStartRef.current.x;
        const deltaY = moveEvent.clientY - resizeStartRef.current.y;

        const newWidth = Math.max(
          MIN_WIDTH,
          Math.min(
            window.innerWidth * 0.95,
            resizeStartRef.current.width + deltaX,
          ),
        );
        const newHeight = Math.max(
          MIN_HEIGHT,
          Math.min(
            window.innerHeight * 0.95,
            resizeStartRef.current.height + deltaY,
          ),
        );

        setSize({ width: newWidth, height: newHeight });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [size],
  );

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToWindowEdges]}
      onDragEnd={handleDragEnd}
    >
      {/* Container - no background overlay, pointer-events-none for pass-through */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onKeyDown={handleKeyDown}
        onMouseDown={onBringToFront}
        className="pointer-events-none fixed inset-0 flex items-center justify-center"
        style={{
          zIndex,
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
      >
        {/* Hidden label for accessibility */}
        <span id={labelId} className="sr-only">
          Content viewer modal
        </span>
        <DraggableContent
          modalId={modalId}
          header={header}
          footer={footer}
          width={size.width}
          height={size.height}
          onResizeStart={handleResizeStart}
          isResizing={isResizing}
        >
          {children}
        </DraggableContent>
      </div>
      {/* Resize overlay - captures mouse events during resize */}
      {isResizing && (
        <div
          className="fixed inset-0 cursor-se-resize"
          style={{ zIndex: zIndex + 10 }}
        />
      )}
    </DndContext>
  );
}

// Re-export for backwards compatibility
export { DraggableResizableModal as DraggableModal };
