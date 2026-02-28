/**
 * Known limitations for the current version of the engine.
 * These are displayed to users as warnings on the demo page.
 */

export interface KnownLimitation {
  id: string;
  titleKo: string;
  titleEn: string;
  descriptionKo: string;
  descriptionEn: string;
  status: 'in-progress' | 'not-planned';
}

export const KNOWN_LIMITATIONS: KnownLimitation[] = [
  {
    id: 'toc-dependency',
    titleKo: '목차 의존성',
    titleEn: 'TOC Dependency',
    descriptionKo:
      '목차(TOC)가 없는 보고서는 처리가 실패합니다 (의도된 동작). 목차가 있더라도 드물게 추출이 실패할 수 있습니다. 향후 수동 검증 시스템으로 대응할 예정입니다.',
    descriptionEn:
      'Reports without a table of contents (TOC) will fail processing (intentional). Even with a TOC present, extraction may rarely fail. This will be addressed via a human intervention system in the future.',
    status: 'not-planned',
  },
  {
    id: 'vertical-text',
    titleKo: '세로쓰기 문서',
    titleEn: 'Vertical Text Documents',
    descriptionKo:
      '페이지 번호가 한자인 오래된 세로쓰기 문서는 장기적으로 지원 대상이지만, 현재는 계획에 없습니다.',
    descriptionEn:
      'Old documents with vertical text and Chinese numeral page numbers are planned for long-term support, but not currently scheduled.',
    status: 'not-planned',
  },
  {
    id: 'automation-scope',
    titleKo: '자동화 범위',
    titleEn: 'Automation Scope',
    descriptionKo:
      '이 엔진은 완전 자동화를 지향하지 않습니다. 엣지 케이스는 향후 수동 검증 시스템으로 대응할 예정입니다.',
    descriptionEn:
      'This engine does not aim for full automation. Edge cases will be addressed via a human intervention system in the future.',
    status: 'not-planned',
  },
];
