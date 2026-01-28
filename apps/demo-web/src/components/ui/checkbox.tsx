'use client';

import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import {
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type RefObject,
} from 'react';

import { cn } from '~/lib/utils';

const Checkbox = ({
  ref,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  ref?: RefObject<ComponentRef<typeof CheckboxPrimitive.Root>>;
}) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'border-primary focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground peer h-4 w-4 shrink-0 rounded-sm border shadow focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn('flex items-center justify-center text-current')}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);

export { Checkbox };
