'use client';

import type { LedgerStageModels } from '../constants/ledger-run';

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
import { LLM_MODELS } from '~/features/upload/constants/llm-models';

import { LEDGER_MODEL_STAGES } from '../constants/ledger-run';

const text = {
  ko: { title: '원장 추출 모델', placeholder: '모델 선택' },
  en: { title: 'Ledger extraction models', placeholder: 'Choose a model' },
} as const;

/** The model of each step of an automatic ledger run, each grouped by provider. */
export function LedgerModelSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: LedgerStageModels;
  onChange: (models: LedgerStageModels) => void;
  disabled?: boolean;
}) {
  const lang = useBrowserLanguage();
  const t = text[lang];
  const providers = [...new Set(LLM_MODELS.map((m) => m.provider))];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t.title}</p>
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
              disabled={disabled}
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
