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
    id: 'hanja-ocr',
    titleKo: '한자 OCR 문제',
    titleEn: 'Hanja OCR Issues',
    descriptionKo:
      '한글/한자 혼용 문서에서 한자가 깨질 수 있습니다. 국한문 혼용 문서 전용 OCR을 준비 중입니다.',
    descriptionEn:
      'Chinese characters may not be recognized correctly in mixed Korean-Chinese documents. A dedicated OCR for mixed-script documents is in development.',
    status: 'in-progress',
  },
  {
    id: 'toc-extraction',
    titleKo: '목차 추출 문제',
    titleEn: 'TOC Extraction Issues',
    descriptionKo:
      '목차가 없거나 특이한 구조면 추출이 실패할 수 있습니다. 특이사항이 없어 보이는 목차도 일부 실패하는 케이스가 있습니다. 지속 개선 중입니다.',
    descriptionEn:
      'May fail if TOC is missing or has unusual structure. Some seemingly normal TOCs also fail occasionally. Continuously improving.',
    status: 'in-progress',
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
];
