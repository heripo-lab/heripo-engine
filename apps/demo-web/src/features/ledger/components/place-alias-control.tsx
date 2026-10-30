'use client';

import type { SupportedLanguage } from '~/lib/hooks/use-browser-language';
import type { ArchaeologyLedgerView as LedgerView } from '~/lib/ledger/archaeology-ledger';

import { Button } from '~/components/ui/button';

import { usePlaceAliases } from '../hooks/use-place-aliases';

const text = {
  ko: {
    title: '장소 약칭 대응 표',
    applied: (n: number, auto: boolean) =>
      `${auto ? '자동 제안' : '사람 지정'} 규칙 ${n}개 적용`,
    invalid: '적용 안 됨',
    none: '없음',
    note: '보고서의 장소 약칭(예: 발굴 1구역)과 등록 이름(예: 23-1 구역)의 대응을 정한 JSON(place-aliases.v1)입니다. 원문 근거 인용이 있어야 하며, 저장하면 원장의 상위 객체에 바로 반영됩니다.',
    rules: '적용 규칙',
    file: '장소 약칭 대응 표 JSON',
    remove: '대응 표 삭제',
    saved: (n: number) => `저장했습니다. 경고 ${n}건`,
    unreadable: 'JSON을 읽을 수 없습니다.',
  },
  en: {
    title: 'Place abbreviation table',
    applied: (n: number, auto: boolean) =>
      `${n} ${auto ? 'automatically proposed' : 'person-decided'} rules applied`,
    invalid: 'not applied',
    none: 'none',
    note: 'A JSON table (place-aliases.v1) that maps how the report abbreviates places (e.g. excavation area 1) to registered names (e.g. area 23-1). Each rule needs a quote from the source; saving it updates the ledger parents at once.',
    rules: 'Rules applied',
    file: 'Place abbreviation table JSON',
    remove: 'Remove table',
    saved: (n: number) => `Saved with ${n} warnings`,
    unreadable: 'The JSON could not be read.',
  },
} as const;

/**
 * The task's place alias table, the one decision a person can inject from the ledger page: upload a JSON
 * table, see whether it was applied and its warnings, or remove it. The demo does not edit tables.
 */
export function PlaceAliasControl({
  taskId,
  view,
  lang,
}: {
  taskId: string;
  view: LedgerView;
  lang: SupportedLanguage;
}) {
  const t = text[lang];
  const { query, save, remove } = usePlaceAliases(taskId);
  const state = view.placeAliases;
  const load = async (file?: File) => {
    if (!file) return;
    try {
      save.mutate(JSON.parse(await file.text()));
    } catch {
      save.reset();
      alert(t.unreadable);
    }
  };
  return (
    <details className="rounded border p-2 text-xs">
      <summary className="cursor-pointer">
        {t.title} ·{' '}
        {state.status === 'applied'
          ? t.applied(state.ruleIds.length, state.source === 'model')
          : state.status === 'invalid'
            ? t.invalid
            : t.none}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-muted-foreground">{t.note}</p>
        {state.status === 'applied' && (
          <div>
            {t.rules} {state.ruleIds.join(', ')}
            {state.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-amber-700">
                {state.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {state.status === 'invalid' && (
          <ul className="text-destructive list-disc pl-4">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t.file}
            type="file"
            accept="application/json,.json"
            disabled={save.isPending}
            onChange={(e) => load(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!query.data?.table || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t.remove}
          </Button>
        </div>
        {save.data && <div>{t.saved(save.data.warnings.length)}</div>}
        {(save.error || remove.error) && (
          <div className="text-destructive whitespace-pre-wrap">
            {(save.error || remove.error)!.message}
          </div>
        )}
      </div>
    </details>
  );
}
