'use client';

import { FileQuestion } from 'lucide-react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

interface ProcessErrorAlertProps {
  error: { code: string; message: string } | undefined;
}

export function ProcessErrorAlert({ error }: ProcessErrorAlertProps) {
  const lang = useBrowserLanguage();

  if (!error) {
    return null;
  }

  if (error.code === 'INVALID_DOCUMENT_TYPE') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
        <FileQuestion className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          {lang === 'ko'
            ? '이 PDF는 고고학 조사 보고서로 확인되지 않았습니다. 이 데모는 발굴조사, 시굴조사, 지표조사 보고서 전용입니다.'
            : 'This PDF was not identified as an archaeological investigation report. This demo only supports excavation, trial excavation, and surface survey reports.'}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-600">
      <strong>Error:</strong> {error.message}
    </div>
  );
}
