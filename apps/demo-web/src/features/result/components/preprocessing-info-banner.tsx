'use client';

import { Lightbulb } from 'lucide-react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

const text = {
  ko: {
    title: '이 결과물은 전처리 단계입니다',
    description:
      '최종 목표는 층위·유구·유물 같은 고고학적 객체를 자동으로 추출하는 것입니다. 이 단계에서는 그 목표를 위한 준비 작업을 수행합니다.',
    items: [
      '국가·지역·기관마다 서로 다른 보고서 포맷을 하나의 규격으로 표준화',
      'OCR로 이미지 기반 PDF에서 텍스트 확보, 텍스트 기반 PDF에서도 레이아웃 구조 파악',
      '이미지·표 추출 및 실제 문서 페이지와 PDF 페이지 번호 매핑',
      '목차 추출 — 자동 구조화를 위한 지도 역할',
    ],
    footer:
      '이렇게 정리해 두면 규칙 기반이든 LLM이든, 정확한 위치로 바로 접근해서 구조화할 수 있어 시간·비용을 절약하고 정확도를 높입니다.',
    next: '다음 단계: 고고학적 범용 데이터 모델(원장)을 설계하고, 이 전처리 결과로부터 유구·유물·층위·조사구역 등 고고학적 개념을 구조적으로 추출하는 기능을 개발하고 있습니다.',
  },
  en: {
    title: 'This result is a preprocessing stage',
    description:
      'The ultimate goal is to automatically extract archaeological objects such as strata, features, and artifacts. This stage performs the groundwork for that goal.',
    items: [
      'Standardize report formats — which vary by country, region, and institution — into a unified structure',
      'Extract text from image-based PDFs via OCR, and analyze layout structure of text-based PDFs',
      'Extract images & tables, and map actual document page numbers to PDF page numbers',
      'Extract table of contents — serves as a roadmap for automated structuring',
    ],
    footer:
      'This preparation allows both rule-based and LLM approaches to jump directly to the right location, saving time and cost while improving accuracy.',
    next: 'Next step: We are designing a general-purpose archaeological data model (Ledger) and developing structured extraction of archaeological concepts — features, artifacts, strata, survey areas — from this preprocessed result.',
  },
} as const;

export function PreprocessingInfoBanner() {
  const lang = useBrowserLanguage();
  const t = text[lang];

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <div className="space-y-2">
          <h3 className="font-medium text-sky-900">{t.title}</h3>
          <p className="text-sm text-sky-700">{t.description}</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-sky-700">
            {t.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-sm font-medium text-sky-800">{t.footer}</p>
          <p className="text-sm text-sky-600 italic">{t.next}</p>
        </div>
      </div>
    </div>
  );
}
