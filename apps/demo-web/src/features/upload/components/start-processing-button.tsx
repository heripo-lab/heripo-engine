'use client';

import type { ProcessingFormValues } from '../types/form-values';

import { Button } from '~/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';

import { useProcessingForm } from '../contexts/processing-form-context';

interface StartProcessingButtonProps {
  isPending: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function StartProcessingButton({
  isPending,
  disabled = false,
  disabledReason,
}: StartProcessingButtonProps) {
  const form = useProcessingForm();

  return (
    <form.Subscribe
      selector={(state: { values: ProcessingFormValues }) => state.values.file}
    >
      {(file: File | null) => {
        const button = (
          <Button
            type="submit"
            size="lg"
            className="px-8"
            disabled={!file || isPending || disabled}
          >
            {isPending ? 'Starting...' : 'Start Processing'}
          </Button>
        );

        if (disabledReason && disabled) {
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-not-allowed">{button}</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{disabledReason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }

        return button;
      }}
    </form.Subscribe>
  );
}
