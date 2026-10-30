'use client';

import { ArrowRight, BookOpen, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { LedgerModelSelect } from '~/features/ledger/components/ledger-model-select';
import { DEFAULT_LEDGER_MODELS } from '~/features/ledger/constants/ledger-run';
import { useLedgerFromResult } from '~/features/ledger/hooks/use-ledger-from-result';

const text = {
  ko: {
    title: '다음 단계: 고고학 데이터 원장',
    note: '이 전처리 결과로 고고학 데이터 원장을 만들 수 있습니다.',
    made: '이 결과로 만든 원장이 있습니다.',
    making: '이 결과로 원장을 만드는 중입니다.',
    open: '원장 보기',
    progress: '진행 보기',
    failed: '이전 원장 실행이 실패했습니다. 다시 만들 수 있습니다.',
    cancelled: '이전 원장 실행이 취소됐습니다. 다시 만들 수 있습니다.',
    create: '이 결과로 원장 만들기',
  },
  en: {
    title: 'Next step: Archaeological Data Ledger',
    note: 'You can build the archaeological data ledger from this preprocessing result.',
    made: 'A ledger has been made from this result.',
    making: 'A ledger is being made from this result.',
    open: 'Open ledger',
    progress: 'View progress',
    failed: 'The previous ledger run failed. You can make it again.',
    cancelled: 'The previous ledger run was cancelled. You can make it again.',
    create: 'Build a ledger from this result',
  },
} as const;

/**
 * The next stage after preprocessing: make the archaeology ledger from this result's processed document in
 * the same session, or open the one already made. The ledger runs every step with its chosen model.
 */
export function NextStageBanner({ taskId }: { taskId: string }) {
  const t = text[useBrowserLanguage()];
  const router = useRouter();
  const { query, create } = useLedgerFromResult(taskId);
  const [models, setModels] = useState(DEFAULT_LEDGER_MODELS);
  const ledgerTask = query.data?.ledgerTask ?? null;
  const again =
    ledgerTask && ['failed', 'cancelled'].includes(ledgerTask.status);

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-4 py-6">
        <div className="flex items-start gap-4">
          <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full">
            <BookOpen className="text-primary h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">{t.title}</p>
            <p className="text-muted-foreground text-sm">{t.note}</p>
          </div>
        </div>

        {ledgerTask && !again ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {ledgerTask.status === 'completed' ? t.made : t.making}
            </p>
            <Button
              onClick={() =>
                router.push(
                  ledgerTask.status === 'completed'
                    ? `/ledger/validation/${ledgerTask.id}`
                    : `/process/${ledgerTask.id}`,
                )
              }
            >
              {ledgerTask.status === 'completed' ? t.open : t.progress}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {again && (
              <p className="text-destructive text-sm">
                {ledgerTask.status === 'failed' ? t.failed : t.cancelled}
              </p>
            )}
            <LedgerModelSelect
              value={models}
              onChange={setModels}
              disabled={create.isPending || query.isLoading}
            />
            {create.error && (
              <p className="text-destructive text-sm">{create.error.message}</p>
            )}
            <div className="flex justify-end">
              <Button
                disabled={create.isPending || query.isLoading}
                onClick={() =>
                  create.mutate(models, {
                    onSuccess: (data) => router.push(`/process/${data.taskId}`),
                  })
                }
              >
                {create.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t.create}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
