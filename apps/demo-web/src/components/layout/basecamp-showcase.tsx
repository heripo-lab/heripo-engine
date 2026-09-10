'use client';

import { ArrowUpRight } from 'lucide-react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

const text = {
  ko: {
    eyebrow: 'heripo engine 활용 사례',
    title: 'PDF 구조화에서 연구 자료 탐색으로',
    description:
      'heripo 베이스캠프는 heripo engine을 자체 보고서 데이터 구축에 활용하는 별도의 서비스입니다. 발굴조사보고서를 지도 위에서 찾고, 조건과 AI 필터로 탐색 범위를 좁히는 연구 지원 도구입니다.',
    vision:
      '한국의 발굴조사보고서에서 시작해, 국가 경계를 넘어 연구 자료를 탐색할 수 있는 서비스로 넓혀갑니다.',
    separation:
      '이 데모에 업로드한 보고서와 처리 결과는 베이스캠프에 반영되지 않습니다.',
    status: '비공개 알파 테스트 중',
    link: 'heripo 홈 방문하기',
    newTab: '(새 탭)',
  },
  en: {
    eyebrow: 'Built with heripo engine',
    title: 'From structured PDFs to research discovery',
    description:
      'heripo basecamp is a separate service that uses heripo engine to build its own report dataset. It helps' +
      ' researchers find excavation reports on a map and narrow results with search criteria and AI filters.',
    vision:
      'Starting with excavation reports from Korea, basecamp aims to grow into a service for discovering research' +
      ' materials across national borders.',
    separation:
      'Reports uploaded here and their processing results are not added to basecamp.',
    status: 'Private alpha in progress',
    link: 'Visit heripo home',
    newTab: '(opens in a new tab)',
  },
} as const;

export function BasecampShowcase() {
  const language = useBrowserLanguage();
  const t = text[language];

  return (
    <section
      aria-labelledby="basecamp-showcase-title"
      className="bg-muted/40 rounded-xl border p-5 sm:p-6"
    >
      <p className="text-primary text-xs font-semibold tracking-wide">
        {t.eyebrow}
      </p>
      <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl space-y-2">
          <h2 id="basecamp-showcase-title" className="text-xl font-semibold">
            {t.title}
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t.description}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t.vision}
          </p>
          <p className="text-sm leading-relaxed">{t.separation}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t.status}
          </p>
        </div>
        <a
          href="https://heripo.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 lg:self-center"
        >
          {t.link}
          <ArrowUpRight aria-hidden="true" className="size-4" />
          <span className="sr-only">{t.newTab}</span>
        </a>
      </div>
    </section>
  );
}
