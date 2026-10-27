'use client';

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

import { LEDGER_RUN_BUDGET } from '../constants/ledger-run';

/** The model every step of an automatic ledger run uses, grouped by provider. */
export function LedgerModelSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  const providers = [...new Set(LLM_MODELS.map((m) => m.provider))];
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">원장 추출 모델</label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label="원장 추출 모델">
          <SelectValue placeholder="모델 선택" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectGroup key={provider}>
              <SelectLabel>{provider}</SelectLabel>
              {LLM_MODELS.filter((m) => m.provider === provider).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        보고서 유형 분류, 객체 후보 탐색, 원문 배정을 이 모델로 차례로
        실행합니다. 모델 호출 비용이 발생하며, 한 번 실행에 최대{' '}
        {LEDGER_RUN_BUDGET.maxCalls}회·
        {LEDGER_RUN_BUDGET.maxTotalTokens.toLocaleString()}토큰을 넘지 않습니다.
      </p>
    </div>
  );
}
