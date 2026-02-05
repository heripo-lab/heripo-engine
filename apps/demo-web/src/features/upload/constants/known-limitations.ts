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
  {
    id: 'automation-scope',
    titleKo: '자동화 범위',
    titleEn: 'Automation Scope',
    descriptionKo:
      '이 엔진은 완전 자동화를 지향하지 않습니다. 기존에 100% 수동으로만 가능했던 작업을 90% 자동화하는 것에 목표와 의의를 둡니다.\n' +
      '페이지 맵핑과 목차 추출은 이 파이프라인의 근간이며, 보고서 형식이 매우 다양해 100%에 가까운 자동화가 불가능합니다. 보편적인 패턴에 집중하며 최적의 지점에서 개선을 멈춥니다. 직접 보기에도 구조 파악이 어려운 보고서라면 자동 처리가 실패하는 것이 정상입니다.\n' +
      '이후 단계(유구·유물 추출 등)에서는 100%에 가까운 자동화를 지향합니다. 이 데모에서 실패하는 특이 케이스는 플랫폼 서비스에서 하이브리드 방식(필요 시 수동 입력)으로 대응할 예정입니다.',
    descriptionEn:
      'This engine does not aim for full automation. Our goal is to automate 90% of work that previously required 100% manual effort.\n' +
      'Page mapping and TOC extraction are the foundation of this pipeline, and 100% automation is impossible due to highly diverse report formats. We focus on common patterns and stop improvements at an optimal point. If a report looks difficult to parse even to a human, it is expected to fail automated processing.\n' +
      'Subsequent stages (feature/artifact extraction, etc.) aim for near-100% automation. Edge cases that fail in this demo will be handled via a hybrid approach (manual input when needed) in the platform service.',
    status: 'in-progress',
  },
];
