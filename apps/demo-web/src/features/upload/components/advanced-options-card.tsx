'use client';

import { Eye, Info } from 'lucide-react';

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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';

import { LLM_MODELS } from '../constants/llm-models';
import { useProcessingForm } from '../contexts/processing-form-context';

interface NumberFieldApi {
  state: { value: number };
  handleChange: (value: number) => void;
}

interface BooleanFieldApi {
  state: { value: boolean };
  handleChange: (value: boolean) => void;
}

interface OptionalStringFieldApi {
  state: { value: string | undefined };
  handleChange: (value: string | undefined) => void;
}

interface OptionalNumberFieldApi {
  state: { value: number | undefined };
  handleChange: (value: number | undefined) => void;
}

const CORRECTION_RETRY_FIELDS = [
  {
    name: 'correction.maxRetries.textCorrection',
    label: 'Text Correction',
  },
  {
    name: 'correction.maxRetries.pageGate',
    label: 'Page Gate',
  },
  {
    name: 'correction.maxRetries.reviewAssistance',
    label: 'Review Assistance',
  },
  {
    name: 'correction.maxRetries.tableCorrection',
    label: 'Table Correction',
  },
] as const;

const RETRY_OVERRIDE_NONE = '__inherit__';
const RETRY_OVERRIDE_OPTIONS = [
  { value: RETRY_OVERRIDE_NONE, label: 'inherit' },
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
] as const;

interface AdvancedOptionsCardProps {
  disabled?: boolean;
}

const NONE_VALUE = '__none__';

const MODELS_BY_PROVIDER = LLM_MODELS.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, typeof LLM_MODELS>,
);

const REVIEW_TASK_MODEL_FIELDS = [
  {
    name: 'correction.models.reviewAssistanceTasks.textOcrHanja',
    label: 'Text OCR and Hanja',
  },
  {
    name: 'correction.models.reviewAssistanceTasks.textIntegrity',
    label: 'Text Integrity',
  },
  {
    name: 'correction.models.reviewAssistanceTasks.textRoleFootnote',
    label: 'Text Roles and Footnotes',
  },
  {
    name: 'correction.models.reviewAssistanceTasks.tables',
    label: 'Tables',
  },
  {
    name: 'correction.models.reviewAssistanceTasks.picturesCaptions',
    label: 'Pictures and Captions',
  },
  {
    name: 'correction.models.reviewAssistanceTasks.layoutBboxOrder',
    label: 'Layout and BBox',
  },
] as const;

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

function VisionModelSelect({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled: boolean;
}) {
  const select = (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={(v) => onChange(v === NONE_VALUE ? undefined : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None (use review model)</SelectItem>
        {Object.entries(MODELS_BY_PROVIDER).map(([provider, models]) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider}</SelectLabel>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">{label}</label>
        <span className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
          <Eye className="h-3 w-3" />
          Vision
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{description}</p>
      {disabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>{select}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Online demo has limited options. Run locally for full
                customization.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        select
      )}
    </div>
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
        <div className="space-y-3">
          <label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Correction Models
          </label>
          <form.Field name="correction.models.tableCorrection">
            {(field: OptionalStringFieldApi) => (
              <VisionModelSelect
                label="Table Correction"
                description="Overrides the tables task model for table-specific correction"
                value={field.state.value}
                onChange={field.handleChange}
                disabled={disabled}
              />
            )}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {REVIEW_TASK_MODEL_FIELDS.map((config) => (
              <form.Field key={config.name} name={config.name}>
                {(field: OptionalStringFieldApi) => (
                  <VisionModelSelect
                    label={config.label}
                    description="Optional model override for this review task"
                    value={field.state.value}
                    onChange={field.handleChange}
                    disabled={disabled}
                  />
                )}
              </form.Field>
            ))}
          </div>
        </div>

        <div className="bg-border h-px" />

        <div className="space-y-3">
          <label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Correction Concurrency
          </label>
          <div className="grid gap-3">
            <form.Field name="correction.concurrency.reviewTasks">
              {(field: NumberFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Review Tasks</span>
                  <SelectWithTooltip
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                    disabled={disabled}
                    className="w-20"
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '3', label: '3' },
                      { value: '6', label: '6' },
                    ]}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="correction.concurrency.tables">
              {(field: NumberFieldApi) => (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Tables</span>
                  <SelectWithTooltip
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                    disabled={disabled}
                    className="w-20"
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '4', label: '4' },
                      { value: '8', label: '8' },
                    ]}
                  />
                </div>
              )}
            </form.Field>
          </div>
        </div>

        <div className="bg-border h-px" />

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

        <div className="bg-border h-px" />

        {/* Per-stage Correction Retry Overrides */}
        <div className="space-y-3">
          <label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Correction Retry Overrides
          </label>
          <p className="text-muted-foreground text-xs">
            Override Max Retries for individual correction stages. Leave on
            inherit to use the global value above.
          </p>
          <div className="grid gap-3">
            {CORRECTION_RETRY_FIELDS.map((config) => (
              <form.Field key={config.name} name={config.name}>
                {(field: OptionalNumberFieldApi) => (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{config.label}</span>
                    <SelectWithTooltip
                      value={
                        field.state.value === undefined
                          ? RETRY_OVERRIDE_NONE
                          : String(field.state.value)
                      }
                      onValueChange={(v) =>
                        field.handleChange(
                          v === RETRY_OVERRIDE_NONE
                            ? undefined
                            : parseInt(v, 10),
                        )
                      }
                      disabled={disabled}
                      className="w-28"
                      options={[...RETRY_OVERRIDE_OPTIONS]}
                    />
                  </div>
                )}
              </form.Field>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
