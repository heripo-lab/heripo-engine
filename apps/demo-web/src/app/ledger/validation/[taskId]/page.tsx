'use client';

import { Suspense, use } from 'react';

import { LedgerValidationContent } from '~/features/ledger';
import { ResultError, ResultLoading, useTaskResult } from '~/features/result';

interface PageProps {
  params: Promise<{ taskId: string }>;
}

/**
 * Temporary preprocessed document validation page for ledger tasks.
 * Shows the LedgerExtractionPreview to confirm the uploaded JSON was
 * delivered intact; the actual ledger result page is not designed yet.
 */
function LedgerValidationPageContent({ taskId }: { taskId: string }) {
  const { data, isLoading, error } = useTaskResult(taskId, {
    retryOnNotCompleted: true,
  });

  if (isLoading) return <ResultLoading />;
  if (error) return <ResultError message={error.message} />;
  if (!data) return null;

  if (data.resultKind !== 'ledger-preview') {
    return <ResultError message="This task is not a ledger extraction task" />;
  }

  return <LedgerValidationContent data={data} />;
}

export default function LedgerValidationPage({ params }: PageProps) {
  const { taskId } = use(params);

  return (
    <Suspense fallback={<ResultLoading />}>
      <LedgerValidationPageContent taskId={taskId} />
    </Suspense>
  );
}
