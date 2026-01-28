'use client';

import { Info } from 'lucide-react';

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
import { SortableMultiSelect } from '~/components/ui/sortable-multi-select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';

import { useProcessingForm } from '../contexts/processing-form-context';

interface StringArrayFieldApi {
  state: { value: string[] };
  handleChange: (value: string[]) => void;
}

interface NumberFieldApi {
  state: { value: number };
  handleChange: (value: number) => void;
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
        <form.Field name="threadCount">
          {(field: NumberFieldApi) => (
            <div className="space-y-2">
              <label className="text-sm font-medium">Thread Count</label>
              {disabled ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Select
                          value={String(field.state.value)}
                          onValueChange={(v) =>
                            field.handleChange(parseInt(v, 10))
                          }
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
                      </div>
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
              )}
            </div>
          )}
        </form.Field>
      </CardContent>
    </Card>
  );
}
