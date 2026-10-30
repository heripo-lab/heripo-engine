'use client';

import type { LedgerTaskResultResponse } from '~/lib/api/tasks';
import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

import { MobileWarningBanner } from '~/components/layout/mobile-warning-banner';
import { PipelineBreadcrumb } from '~/components/pipeline/pipeline-breadcrumb';

import { LedgerResultView } from './ledger-result-view';

const text = {
  ko: {
    title: '고고학 데이터 원장',
    description:
      '보고서에서 찾은 고고학 객체와 그 속성·관계입니다. 확인이 필요한 객체에는 검수 표시가 있고, 원문은 각 객체에서 열어 볼 수 있습니다.',
  },
  en: {
    title: 'Archaeological Data Ledger',
    description:
      'The archaeological records found in the report, with their attributes and relations. Records a person should check are flagged, and each record opens its source text.',
  },
} as const;

/** The ledger page of a ledger task: the report it was made from and its archaeology ledger. */
export function LedgerValidationContent({
  data,
}: {
  data: LedgerTaskResultResponse;
}) {
  const t = text[useBrowserLanguage()];
  const { task } = data;
  return (
    <div className="container mx-auto px-4 py-10 xl:px-0">
      <MobileWarningBanner />
      <div className="mx-auto max-w-7xl space-y-8">
        <PipelineBreadcrumb currentStage="ledger" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground mt-1">{task.originalFilename}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t.description}</p>
        </div>
        <LedgerResultView taskId={task.id} />
      </div>
    </div>
  );
}
