'use client';

import { Progress as ProgressPrimitive } from 'radix-ui';
import {
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type RefObject,
} from 'react';

import { cn } from '~/lib/utils';

interface ProgressProps extends ComponentPropsWithoutRef<
  typeof ProgressPrimitive.Root
> {
  indeterminate?: boolean;
}

const Progress = ({
  ref,
  className,
  value,
  indeterminate = false,
  ...props
}: ProgressProps & {
  ref?: RefObject<ComponentRef<typeof ProgressPrimitive.Root>>;
}) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      'relative h-3 w-full overflow-hidden rounded-full bg-blue-100',
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-blue-500 transition-all"
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
    {indeterminate && (
      <div
        className="animate-shimmer absolute inset-0 h-full w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent"
        aria-hidden="true"
      />
    )}
  </ProgressPrimitive.Root>
);

export { Progress };
