'use client';

import { FileText } from 'lucide-react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

import { LinkButton } from '~/components/ui/link-button';

const text = {
  ko: {
    message:
      '먼저 샘플 결과물을 확인해 보세요! PDF 처리 결과를 미리 살펴볼 수 있습니다.',
    button: '샘플 보기',
  },
  en: {
    message:
      'Check out sample results first! Preview what PDF processing output looks like.',
    button: 'View Samples',
  },
} as const;

export function SampleResultsBanner() {
  const lang = useBrowserLanguage();
  const t = text[lang];

  return (
    <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 shrink-0 text-purple-600" />
        <p className="flex-1 text-sm text-purple-700">{t.message}</p>
        <LinkButton
          href="/tasks"
          variant="outline"
          size="sm"
          className="shrink-0 border-purple-300 text-purple-700 hover:bg-purple-100"
        >
          {t.button}
        </LinkButton>
      </div>
    </div>
  );
}
