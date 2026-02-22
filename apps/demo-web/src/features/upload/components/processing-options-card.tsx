'use client';

import { Cpu, Info } from 'lucide-react';

import { featureFlags } from '~/lib/config/feature-flags';

// TEMP:vlm-flag

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

interface ProcessingOptionsCardProps {
  disabled?: boolean;
  enableVlmOverride?: boolean; // TEMP:vlm-flag
}

export function ProcessingOptionsCard({
  disabled = false,
  enableVlmOverride = false, // TEMP:vlm-flag
}: ProcessingOptionsCardProps) {
  const form = useProcessingForm();
  const showVlm = featureFlags.enableVlm || enableVlmOverride; // TEMP:vlm-flag — delete line, unwrap showVlm guards

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
        {/* TEMP:vlm-flag — unwrap this conditional */}
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
        {/* TEMP:vlm-flag — unwrap this conditional */}
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
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Markdown</SelectLabel>
                        {VLM_MARKDOWN_MODELS.map((model) => (
                          <SelectItem key={model.key} value={model.key}>
                            <span>{model.label}</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {model.description}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </DisabledWrapper>
              </div>
            )}
          </form.Field>
        )}

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
