'use client';

import { CheckCircle2, Info } from 'lucide-react';

import { publicModeConfig } from '~/lib/config/public-mode';
import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

const text = {
  ko: {
    title: '데모 안내: 자동 보정은 생략됩니다',
    description:
      '온라인 데모는 처리 시간이 길어질 수 있는 자동 보정(텍스트 교정, 구조 보정, 표 보정, 이미지 분리/합치기, 캡션 보정)을 생략합니다.',
    next: '로컬에서 엔진을 실행하면 이 옵션들을 켜서 전체 보정 파이프라인을 사용할 수 있습니다.',
  },
  en: {
    title: 'Demo Notice: Auto-correction Is Skipped',
    description:
      'The online demo skips auto-correction that takes longer to run, including text correction, structural correction, table correction, image split/merge, and caption correction.',
    next: 'You can enable these options and use the full correction pipeline by running the engine locally.',
  },
} as const;

export function AutoCorrectionDemoNoticeBanner() {
  const lang = useBrowserLanguage();

  if (!publicModeConfig.isPublicMode) {
    return null;
  }

  const t = text[lang];

  return (
    <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <div className="space-y-2">
          <h3 className="font-medium text-indigo-900">{t.title}</h3>
          <p className="text-sm text-indigo-800">{t.description}</p>
          <p className="flex items-start gap-1.5 text-sm text-indigo-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            {t.next}
          </p>
        </div>
      </div>
    </div>
  );
}
