'use client';

import type { VlmApiModelOption } from '../constants/vlm-models';

import { Cpu, Info } from 'lucide-react';

import { featureFlags } from '~/lib/config/feature-flags';
import { cn } from '~/lib/utils';

import { Badge } from '~/components/ui/badge';
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

import {
  DEFAULT_VLM_MODEL_KEY,
  VLM_API_MODEL_OPTIONS,
  VLM_MODEL_OPTIONS,
} from '../constants/vlm-models';
import { useProcessingForm } from '../contexts/processing-form-context';

interface StringArrayFieldApi {
  state: { value: string[] };
  handleChange: (value: string[]) => void;
}

interface NumberFieldApi {
  state: { value: number };
  handleChange: (value: number) => void;
}

interface StringFieldApi {
  state: { value: string };
  handleChange: (value: string) => void;
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

const VLM_DOCTAGS_MODELS = VLM_MODEL_OPTIONS.filter(
  (m) => m.responseFormat === 'doctags',
);
const VLM_MARKDOWN_MODELS = VLM_MODEL_OPTIONS.filter(
  (m) => m.responseFormat === 'markdown',
);

const VLM_API_MODELS_BY_PROVIDER: Record<string, VlmApiModelOption[]> =
  VLM_API_MODEL_OPTIONS.reduce<Record<string, VlmApiModelOption[]>>(
    (acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    },
    {},
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

interface ProcessingOptionsCardProps {
  disabled?: boolean;
  enableVlmOverride?: boolean;
}

export function ProcessingOptionsCard({
  disabled = false,
  enableVlmOverride = false,
}: ProcessingOptionsCardProps) {
  const form = useProcessingForm();
  const showVlm = featureFlags.enableVlm || enableVlmOverride;

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
        {/* Pipeline Selection */}
        {showVlm && (
          <form.Field name="pipeline">
            {(field: StringFieldApi) => (
              <div className="space-y-2">
                <label className="text-sm font-medium">Pipeline</label>
                <p className="text-muted-foreground text-xs">
                  Standard uses OCR; VLM uses a local vision model for parsing
                </p>
                <DisabledWrapper disabled={disabled}>
                  <Select
                    value={field.state.value}
                    onValueChange={field.handleChange}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select pipeline" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (OCR)</SelectItem>
                      <SelectItem value="vlm">
                        VLM (Vision Language Model)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </DisabledWrapper>
              </div>
            )}
          </form.Field>
        )}

        {/* VLM Model Selection */}
        {showVlm && (
          <form.Field name="vlmModel">
            {(field: OptionalStringFieldApi) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">VLM Model</label>
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <Cpu className="h-3 w-3" />
                    Local
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  Local vision model for VLM pipeline. Also used for hanja
                  auto-fallback.
                </p>
                <DisabledWrapper disabled={disabled}>
                  <Select
                    value={field.state.value ?? '__default__'}
                    onValueChange={(v) =>
                      field.handleChange(v === '__default__' ? undefined : v)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={`Default: ${DEFAULT_VLM_MODEL_KEY}`}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        Default ({DEFAULT_VLM_MODEL_KEY})
                      </SelectItem>
                      <SelectGroup>
                        <SelectLabel>DocTags</SelectLabel>
                        {VLM_DOCTAGS_MODELS.map((model) => (
                          <SelectItem key={model.key} value={model.key}>
                            <span>{model.label}</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {model.description}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Markdown (Local)</SelectLabel>
                        {VLM_MARKDOWN_MODELS.map((model) => (
                          <SelectItem key={model.key} value={model.key}>
                            <span>{model.label}</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {model.description}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {Object.entries(VLM_API_MODELS_BY_PROVIDER).map(
                        ([provider, models]) => (
                          <SelectGroup key={provider}>
                            <SelectLabel>{provider} (API)</SelectLabel>
                            {models.map((model: VlmApiModelOption) => (
                              <SelectItem key={model.key} value={model.key}>
                                <span>{model.label}</span>
                                <span className="text-muted-foreground ml-2 text-xs">
                                  {model.description}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </DisabledWrapper>
              </div>
            )}
          </form.Field>
        )}

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
