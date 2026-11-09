'use client';

import type { LedgerStageModels } from '../constants/ledger-run';

import { Info } from 'lucide-react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

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
import { LLM_MODELS } from '~/features/upload/constants/llm-models';

import { LEDGER_MODEL_STAGES } from '../constants/ledger-run';

const text = {
  ko: {
    title: '원장 추출 모델',
    placeholder: '모델 선택',
    restricted:
      '온라인 데모는 기본 모델로만 실행됩니다. 모델을 바꾸려면 로컬에서 실행하세요.',
  },
  en: {
    title: 'Ledger extraction models',
    placeholder: 'Choose a model',
    restricted:
      'Online demo runs the default models. Run locally to choose models.',
  },
} as const;

/**
 * The model of each step of an automatic ledger run, each grouped by provider. `restricted` locks the choice
 * to the defaults, as the public demo does for preprocessing options outside OTP mode.
 */
export function LedgerModelSelect({
  value,
  onChange,
  disabled = false,
  restricted = false,
}: {
  value: LedgerStageModels;
  onChange: (models: LedgerStageModels) => void;
  disabled?: boolean;
  restricted?: boolean;
}) {
  const lang = useBrowserLanguage();
  const t = text[lang];
  const providers = [...new Set(LLM_MODELS.map((m) => m.provider))];
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        {t.title}
        {restricted && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info
                  className="text-muted-foreground h-4 w-4"
                  aria-label={t.restricted}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>{t.restricted}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {LEDGER_MODEL_STAGES.map((stage) => (
          <div key={stage.id} className="space-y-1">
            <label className="text-muted-foreground text-xs">
              {stage.label[lang]}
            </label>
            <Select
              value={value[stage.id]}
              onValueChange={(modelId) =>
                onChange({ ...value, [stage.id]: modelId })
              }
              disabled={disabled || restricted}
            >
              <SelectTrigger aria-label={stage.label[lang]}>
                <SelectValue placeholder={t.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectGroup key={provider}>
                    <SelectLabel>{provider}</SelectLabel>
                    {LLM_MODELS.filter((m) => m.provider === provider).map(
                      (m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
