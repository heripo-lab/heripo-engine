import { type InputHTMLAttributes, type RefObject } from 'react';

import { cn } from '~/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = ({
  ref,
  className,
  type,
  ...props
}: InputProps & {
  ref?: RefObject<HTMLInputElement>;
}) => {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
};

export { Input };
