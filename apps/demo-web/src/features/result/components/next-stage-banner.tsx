'use client';

import { ArrowRight, BookOpen, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { LedgerModelSelect } from '~/features/ledger/components/ledger-model-select';
import { DEFAULT_LEDGER_MODELS } from '~/features/ledger/constants/ledger-run';
import { useLedgerFromResult } from '~/features/ledger/hooks/use-ledger-from-result';

/**
 * The next stage after preprocessing: make the archaeology ledger from this result's processed document in
 * the same session, or open the one already made. The ledger runs every step with its chosen model.
 */
export function NextStageBanner({ taskId }: { taskId: string }) {
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
            <p className="font-medium">다음 단계: 고고학 데이터 원장</p>
            <p className="text-muted-foreground text-sm">
              전처리가 끝났습니다. 이 결과를 그대로 넘겨 고고학 객체와 원문
              근거를 정리한 원장을 만들 수 있습니다.
            </p>
          </div>
        </div>

        {ledgerTask && !again ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {ledgerTask.status === 'completed'
                ? '이 결과로 만든 원장이 있습니다.'
                : '이 결과로 원장을 만드는 중입니다.'}
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
              {ledgerTask.status === 'completed' ? '원장 보기' : '진행 보기'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {again && (
              <p className="text-destructive text-sm">
                이전 원장 실행이{' '}
                {ledgerTask.status === 'failed'
                  ? '실패했습니다'
                  : '취소됐습니다'}
                . 다시 만들 수 있습니다.
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
                이 결과로 원장 만들기
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
