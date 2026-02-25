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
import { SortableMultiSelect } from '~/components/ui/sortable-multi-select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';

import { VISION_MODELS } from '../constants/llm-models';
import { useProcessingForm } from '../contexts/processing-form-context';

interface StringArrayFieldApi {
  state: { value: string[] };
  handleChange: (value: string[]) => void;
}

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

export const OCR_LANGUAGES = [
  { label: 'English', value: 'en-US' },
  { label: 'Korean', value: 'ko-KR' },
  { label: 'Japanese', value: 'ja-JP' },
  { label: 'Chinese (Simplified)', value: 'zh-Hans' },
  { label: 'Chinese (Traditional)', value: 'zh-Hant' },
  { label: 'French', value: 'fr-FR' },
  { label: 'German', value: 'de-DE' },
  { label: 'Italian', value: 'it-IT' },
  { label: 'Spanish', value: 'es-ES' },
  { label: 'Portuguese (Brazil)', value: 'pt-BR' },
  { label: 'Russian', value: 'ru-RU' },
  { label: 'Ukrainian', value: 'uk-UA' },
] as const;

const NONE_VALUE = '__none__';

/**
 * Group vision models by provider for select dropdown
 */
const VISION_MODELS_BY_PROVIDER = VISION_MODELS.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, typeof VISION_MODELS>,
);

/**
 * Wraps a select element with a disabled tooltip when in public mode.
 */
function DisabledWrapper({
  disabled,
  children,
}: {
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{children}</div>
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

/**
 * Toggle switch button with tooltip for disabled state.
 */
function ToggleSwitch({
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

/**
 * Vision model select dropdown for OCR strategy models
 */
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
      <DisabledWrapper disabled={disabled}>
        <Select
          value={value ?? NONE_VALUE}
          onValueChange={(v) => onChange(v === NONE_VALUE ? undefined : v)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>None (disabled)</SelectItem>
            {Object.entries(VISION_MODELS_BY_PROVIDER).map(
              ([provider, models]) => (
                <SelectGroup key={provider}>
                  <SelectLabel>{provider}</SelectLabel>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ),
            )}
          </SelectContent>
        </Select>
      </DisabledWrapper>
    </div>
  );
}

interface ProcessingOptionsCardProps {
  disabled?: boolean;
}

export function ProcessingOptionsCard({
  disabled = false,
}: ProcessingOptionsCardProps) {
  const form = useProcessingForm();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Processing Options
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
        <CardDescription>Configure OCR and processing settings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* OCR Strategy Section */}

        {/* Forced Method */}
        <form.Field name="forcedMethod">
          {(field: OptionalStringFieldApi) => (
            <div className="space-y-2">
              <label className="text-sm font-medium">OCR Strategy</label>
              <p className="text-muted-foreground text-xs">
                Auto uses VLM sampling to decide; manual forces a specific
                method
              </p>
              <DisabledWrapper disabled={disabled}>
                <Select
                  value={field.state.value ?? 'auto'}
                  onValueChange={(v) =>
                    field.handleChange(v === 'auto' ? undefined : v)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select strategy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (VLM Sampling)</SelectItem>
                    <SelectItem value="ocrmac">Force ocrmac (OCR)</SelectItem>
                    <SelectItem value="vlm">
                      Force VLM (Vision Language Model)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DisabledWrapper>
            </div>
          )}
        </form.Field>

        {/* Strategy Sampler Model */}
        <form.Field name="strategySamplerModel">
          {(field: OptionalStringFieldApi) => (
            <VisionModelSelect
              label="Strategy Sampler Model"
              description="Frontier VLM for sampling pages to decide OCR strategy"
              value={field.state.value}
              onChange={field.handleChange}
              disabled={disabled}
            />
          )}
        </form.Field>

        {/* VLM Processor Model */}
        <form.Field name="vlmProcessorModel">
          {(field: OptionalStringFieldApi) => (
            <VisionModelSelect
              label="VLM Processor Model"
              description="VLM for page-by-page text extraction when VLM path is chosen"
              value={field.state.value}
              onChange={field.handleChange}
              disabled={disabled}
            />
          )}
        </form.Field>

        {/* VLM Concurrency */}
        <form.Field name="vlmConcurrency">
          {(field: NumberFieldApi) => (
            <div className="space-y-2">
              <label className="text-sm font-medium">VLM Concurrency</label>
              <p className="text-muted-foreground text-xs">
                Number of concurrent VLM page processing requests
              </p>
              <DisabledWrapper disabled={disabled}>
                <Select
                  value={String(field.state.value)}
                  onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select concurrency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 (sequential)</SelectItem>
                    <SelectItem value="2">2 concurrent</SelectItem>
                    <SelectItem value="3">3 concurrent</SelectItem>
                    <SelectItem value="5">5 concurrent</SelectItem>
                  </SelectContent>
                </Select>
              </DisabledWrapper>
            </div>
          )}
        </form.Field>

        {/* Force Image PDF */}
        <form.Field name="forceImagePdf">
          {(field: BooleanFieldApi) => (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Force Image PDF</label>
                  <p className="text-muted-foreground text-xs">
                    Pre-convert PDF to image-based PDF before processing
                  </p>
                </div>
                <DisabledWrapper disabled={disabled}>
                  <ToggleSwitch
                    checked={field.state.value}
                    onChange={() => field.handleChange(!field.state.value)}
                    disabled={disabled}
                  />
                </DisabledWrapper>
              </div>
            </div>
          )}
        </form.Field>

        {/* OCR Languages */}
        <form.Field name="ocrLanguages">
          {(field: StringArrayFieldApi) => (
            <div className="space-y-2">
              <label className="text-sm font-medium">OCR Languages</label>
              <SortableMultiSelect
                options={OCR_LANGUAGES}
                value={field.state.value}
                onChange={field.handleChange}
                placeholder="Select languages..."
              />
            </div>
          )}
        </form.Field>

        {/* Thread Count */}
        <form.Field name="threadCount">
          {(field: NumberFieldApi) => (
            <div className="space-y-2">
              <label className="text-sm font-medium">Thread Count</label>
              <DisabledWrapper disabled={disabled}>
                <Select
                  value={String(field.state.value)}
                  onValueChange={(v) => field.handleChange(parseInt(v, 10))}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select threads" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 threads</SelectItem>
                    <SelectItem value="4">4 threads</SelectItem>
                    <SelectItem value="8">8 threads</SelectItem>
                  </SelectContent>
                </Select>
              </DisabledWrapper>
            </div>
          )}
        </form.Field>
      </CardContent>
    </Card>
  );
}
