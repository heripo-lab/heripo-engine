'use client';

import type { ProcessingFormValues } from '../types/form-values';

import { Eye, Info } from 'lucide-react';

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

import { LLM_MODELS, VISION_MODELS } from '../constants/llm-models';
import { useProcessingForm } from '../contexts/processing-form-context';

interface StringFieldApi {
  state: { value: string };
  handleChange: (value: string) => void;
}

interface OptionalStringFieldApi {
  state: { value: string | undefined };
  handleChange: (value: string | undefined) => void;
}

const NONE_VALUE = '__none__';

interface ModelSelectProps {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  requiresVision?: boolean;
  optional?: boolean;
  disabled?: boolean;
}

function ModelSelect({
  label,
  description,
  value,
  onChange,
  requiresVision = false,
  optional = false,
  disabled = false,
}: ModelSelectProps) {
  const models = requiresVision ? VISION_MODELS : LLM_MODELS;

  // Group models by provider
  const modelsByProvider = models.reduce(
    (acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = [];
      }
      acc[model.provider].push(model);
      return acc;
    },
    {} as Record<string, typeof models>,
  );

  const providers = Object.keys(modelsByProvider);

  const selectElement = (
    <Select
      value={value || NONE_VALUE}
      onValueChange={(v) => onChange(v === NONE_VALUE ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {optional && (
          <SelectItem value={NONE_VALUE}>None (use fallback model)</SelectItem>
        )}
        {providers.map((provider) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider}</SelectLabel>
            {modelsByProvider[provider].map((model) => (
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
        {requiresVision && (
          <span className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
            <Eye className="h-3 w-3" />
            Vision
          </span>
        )}
        {optional && (
          <span className="text-muted-foreground text-xs">(Optional)</span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{description}</p>
      {disabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>{selectElement}</div>
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
        selectElement
      )}
    </div>
  );
}

type ModelFieldName = Extract<
  keyof ProcessingFormValues,
  | 'fallbackModel'
  | 'tocExtractorModel'
  | 'pageRangeParserModel'
  | 'visionTocExtractorModel'
  | 'validatorModel'
  | 'captionParserModel'
>;

interface ModelFieldConfig {
  name: ModelFieldName;
  label: string;
  description: string;
  requiresVision?: boolean;
  optional?: boolean;
}

const MODEL_FIELDS: ModelFieldConfig[] = [
  {
    name: 'tocExtractorModel',
    label: 'TOC Extractor',
    description: 'Extracts TOC structure from Markdown',
  },
  {
    name: 'pageRangeParserModel',
    label: 'Page Range Parser',
    description: 'Extracts page numbers from images',
    requiresVision: true,
  },
  {
    name: 'visionTocExtractorModel',
    label: 'Vision TOC Extractor',
    description: 'Fallback TOC extraction from images',
    requiresVision: true,
  },
  {
    name: 'validatorModel',
    label: 'Validator',
    description: 'Validates TOC and captions. Use a capable model.',
  },
  {
    name: 'captionParserModel',
    label: 'Caption Parser',
    description: 'Parses captions to extract numbers',
  },
];

interface LLMModelSettingsCardProps {
  disabled?: boolean;
}

export function LLMModelSettingsCard({
  disabled = false,
}: LLMModelSettingsCardProps) {
  const form = useProcessingForm();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          LLM Model Settings
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
        <CardDescription>
          Configure AI models for each processing stage. Defaults are tested for
          optimal performance and cost balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fallback Model - Primary */}
        <div className="border-primary/20 bg-primary/5 rounded-lg border p-4">
          <form.Field name="fallbackModel">
            {(field: StringFieldApi) => (
              <ModelSelect
                label="Fallback Model"
                description="All other models fall back to this. Use a frontier model for best results."
                value={field.state.value}
                onChange={field.handleChange}
                disabled={disabled}
              />
            )}
          </form.Field>
        </div>

        {/* Separator */}
        <div className="bg-border h-px" />

        {/* Stage-specific Models - 2 column grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          {MODEL_FIELDS.map((config) =>
            config.optional ? (
              <form.Field key={config.name} name={config.name}>
                {(field: OptionalStringFieldApi) => (
                  <ModelSelect
                    label={config.label}
                    description={config.description}
                    value={field.state.value ?? ''}
                    onChange={(v) =>
                      field.handleChange(v === '' ? undefined : v)
                    }
                    requiresVision={config.requiresVision}
                    optional={config.optional}
                    disabled={disabled}
                  />
                )}
              </form.Field>
            ) : (
              <form.Field key={config.name} name={config.name}>
                {(field: StringFieldApi) => (
                  <ModelSelect
                    label={config.label}
                    description={config.description}
                    value={field.state.value}
                    onChange={field.handleChange}
                    requiresVision={config.requiresVision}
                    disabled={disabled}
                  />
                )}
              </form.Field>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}
