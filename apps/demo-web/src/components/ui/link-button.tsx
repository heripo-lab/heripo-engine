import type { VariantProps } from 'class-variance-authority';

import Link from 'next/link';
import { type ComponentProps, type RefObject } from 'react';

import { cn } from '~/lib/utils';

import { buttonVariants } from '~/components/ui/button';

export interface LinkButtonProps
  extends
    Omit<ComponentProps<typeof Link>, 'className'>,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

const LinkButton = ({
  ref,
  className,
  variant,
  size,
  children,
  ...props
}: LinkButtonProps & {
  ref?: RefObject<HTMLAnchorElement>;
}) => {
  return (
    <Link
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    >
      {children}
    </Link>
  );
};

export { LinkButton };
