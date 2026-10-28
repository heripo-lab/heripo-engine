'use client';

import type { LedgerStageModels } from '../constants/ledger-run';

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

import {
  LEDGER_MODEL_STAGES,
  LEDGER_RUN_BUDGET,
} from '../constants/ledger-run';

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
  const providers = [...new Set(LLM_MODELS.map((m) => m.provider))];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">원장 추출 모델</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {LEDGER_MODEL_STAGES.map((stage) => (
          <div key={stage.id} className="space-y-1">
            <label className="text-muted-foreground text-xs">
              {stage.label}
            </label>
            <Select
              value={value[stage.id]}
              onValueChange={(modelId) =>
                onChange({ ...value, [stage.id]: modelId })
              }
              disabled={disabled}
            >
              <SelectTrigger aria-label={`${stage.label} 모델`}>
                <SelectValue placeholder="모델 선택" />
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
      <p className="text-muted-foreground text-xs">
        네 구간을 차례로 실행하며, 구간마다 고른 모델을 씁니다. 기본값은 모두
        Claude Haiku 5.5입니다. 모델 호출 비용이 발생하며, 한 번 실행에 최대{' '}
        {LEDGER_RUN_BUDGET.maxCalls}회·
        {LEDGER_RUN_BUDGET.maxTotalTokens.toLocaleString()}토큰을 넘지 않습니다.
        후보 판단·중복 검토·원문 배정은 그 모델이 Anthropic 모델이면 일괄 처리로
        보내 요금이 절반이 되며, 결과가 오기까지 단계마다 최대 24시간 걸릴 수
        있습니다.
      </p>
    </div>
  );
}
