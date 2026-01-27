'use client';

import { Info } from 'lucide-react';

import { cn } from '~/lib/utils';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';

import { useProcessingForm } from '../contexts/processing-form-context';

interface NumberFieldApi {
  state: { value: number };
  handleChange: (value: number) => void;
}

interface BooleanFieldApi {
  state: { value: boolean };
  handleChange: (value: boolean) => void;
}

interface AdvancedOptionsCardProps {
  disabled?: boolean;
}

function SelectWithTooltip({
  value,
  onValueChange,
  disabled,
  className,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  className?: string;
  options: { value: string; label: string }[];
}) {
  const select = (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!disabled) return select;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{select}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Online demo has limited options. Run locally for full customization.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ToggleWithTooltip({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );

  if (!disabled) return toggle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{toggle}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Online demo has limited options. Run locally for full customization.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AdvancedOptionsCard({
  disabled = false,
}: AdvancedOptionsCardProps) {
  const form = useProcessingForm();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Advanced Options
          {disabled && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="text-muted-foreground h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Online demo has limited options. Run locally for full
                    customization.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </CardTitle>
        <CardDescription>Batch processing and retry settings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Batch Sizes */}
        <div className="space-y-3">
          <label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Batch Sizes
          </label>
          <div className="grid gap-3">
            <form.Field name="textCleanerBatchSize">
              {(field: NumberFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Text Cleaner</span>
                  <SelectWithTooltip
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                    disabled={disabled}
                    className="w-20"
                    options={[
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                      { value: '50', label: '50' },
                    ]}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="captionParserBatchSize">
              {(field: NumberFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Caption Parser</span>
                  <SelectWithTooltip
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                    disabled={disabled}
                    className="w-20"
                    options={[
                      { value: '0', label: '0' },
                      { value: '5', label: '5' },
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                    ]}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="captionValidatorBatchSize">
              {(field: NumberFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Caption Validator</span>
                  <SelectWithTooltip
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                    disabled={disabled}
                    className="w-20"
                    options={[
                      { value: '0', label: '0' },
                      { value: '5', label: '5' },
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                    ]}
                  />
                </div>
              )}
            </form.Field>
          </div>
        </div>

        {/* Separator */}
        <div className="bg-border h-px" />

        {/* Retry Settings */}
        <div className="space-y-3">
          <label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Retry Settings
          </label>
          <div className="grid gap-3">
            <form.Field name="maxRetries">
              {(field: NumberFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Max Retries</span>
                  <SelectWithTooltip
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                    disabled={disabled}
                    className="w-20"
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '3', label: '3' },
                      { value: '5', label: '5' },
                    ]}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="enableFallbackRetry">
              {(field: BooleanFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Fallback Retry</span>
                  <ToggleWithTooltip
                    checked={field.state.value}
                    onChange={() => field.handleChange(!field.state.value)}
                    disabled={disabled}
                  />
                </div>
              )}
            </form.Field>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
