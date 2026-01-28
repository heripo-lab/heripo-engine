'use client';

import type { ComponentProps, MouseEvent } from 'react';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { cn } from '~/lib/utils';

/**
 * Context for sharing touch device state and toggle function between Tooltip components.
 */
const TooltipContext = createContext<{
  isTouchDevice: boolean;
  toggle: () => void;
} | null>(null);

/**
 * Detects if the current device is a touch device using CSS media query.
 * Returns true for devices without hover capability (mobile/tablet).
 */
function useIsTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(hover: none)');
    setIsTouchDevice(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return isTouchDevice;
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * Tooltip component with mobile touch support.
 * On touch devices, tooltips toggle on click instead of hover.
 * On desktop, the default hover behavior is preserved.
 */
function Tooltip({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  const isTouchDevice = useIsTouchDevice();
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled
    ? controlledOpen
    : isTouchDevice
      ? internalOpen
      : undefined;

  const onOpenChange = useCallback(
    (newOpen: boolean) => {
      if (controlledOnOpenChange) {
        controlledOnOpenChange(newOpen);
      }
      if (!isControlled && isTouchDevice) {
        setInternalOpen(newOpen);
      }
    },
    [controlledOnOpenChange, isControlled, isTouchDevice],
  );

  const toggle = useCallback(() => {
    if (isControlled && controlledOnOpenChange) {
      controlledOnOpenChange(!controlledOpen);
    } else if (!isControlled) {
      setInternalOpen((prev) => !prev);
    }
  }, [isControlled, controlledOnOpenChange, controlledOpen]);

  return (
    <TooltipContext.Provider value={{ isTouchDevice, toggle }}>
      <TooltipProvider>
        <TooltipPrimitive.Root
          data-slot="tooltip"
          open={open}
          onOpenChange={onOpenChange}
          {...props}
        />
      </TooltipProvider>
    </TooltipContext.Provider>
  );
}

function TooltipTrigger({
  onClick,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const context = useContext(TooltipContext);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (context?.isTouchDevice) {
        e.preventDefault();
        context.toggle();
      }
      onClick?.(e);
    },
    [context, onClick],
  );

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onClick={handleClick}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
