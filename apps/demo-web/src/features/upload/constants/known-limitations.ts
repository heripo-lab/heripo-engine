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
    id: 'korean-hanja-mix-ocr',
    titleKo: '한글·한자 혼용 OCR 문제',
    titleEn: 'Korean-Hanja Mix OCR Issues',
    descriptionKo:
      '한글/한자 혼용 문서에서 한자가 깨질 수 있습니다. 국한문 혼용 문서 전용 OCR을 준비 중입니다.',
    descriptionEn:
      'Chinese characters may not be recognized correctly in mixed Korean-Chinese documents. A dedicated OCR for mixed-script documents is in development.',
    status: 'in-progress',
  },
  {
    id: 'toc-required',
    titleKo: '목차 필수',
    titleEn: 'TOC Required',
    descriptionKo:
      '목차(TOC)가 없는 보고서는 처리가 실패합니다. 이는 의도된 동작입니다.\n' +
      '목차는 유구·유물 등 객체 탐색의 기준점이 되며, 목차 없이는 구조화된 데이터 추출 효율이 크게 떨어집니다. 따라서 목차가 없는 경우는 앞으로도 실패 처리됩니다.\n' +
      '실제 DB 구축 과정에서는 목차가 없을 경우 사용자가 직접 목차를 입력하는 하이브리드 방식으로 대응할 예정입니다.',
    descriptionEn:
      'Reports without a table of contents (TOC) will fail processing. This is intentional.\n' +
      'The TOC serves as the reference point for locating features and artifacts. Without it, structured data extraction efficiency drops significantly, so TOC-less cases will continue to be treated as failures.\n' +
      'In the actual DB construction process, when the TOC is missing, users will be able to manually input the TOC via a hybrid approach.',
    status: 'not-planned',
  },
  {
    id: 'toc-extraction',
    titleKo: '목차 추출 실패',
    titleEn: 'TOC Extraction Failures',
    descriptionKo:
      '목차가 있더라도 특이한 구조이면 추출이 실패할 수 있습니다. 특이사항이 없어 보이는 목차도 일부 실패하는 케이스가 있습니다. 지속 개선 중입니다.',
    descriptionEn:
      'Even when a TOC exists, extraction may fail if it has an unusual structure. Some seemingly normal TOCs also fail occasionally. Continuously improving.',
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
      '페이지 매핑과 목차 추출은 이 파이프라인의 근간이며, 보고서 형식이 매우 다양해 100%에 가까운 자동화가 불가능합니다. 보편적인 패턴에 집중하며 최적의 지점에서 개선을 멈춥니다. 직접 보기에도 구조 파악이 어려운 보고서라면 자동 처리가 실패하는 것이 정상입니다.\n' +
      '이후 단계(유구·유물 추출 등)에서는 100%에 가까운 자동화를 지향합니다. 이 데모에서 실패하는 특이 케이스는 플랫폼 서비스에서 하이브리드 방식(필요 시 수동 입력)으로 대응할 예정입니다.',
    descriptionEn:
      'This engine does not aim for full automation. Our goal is to automate 90% of work that previously required 100% manual effort.\n' +
      'Page mapping and TOC extraction are the foundation of this pipeline, and 100% automation is impossible due to highly diverse report formats. We focus on common patterns and stop improvements at an optimal point. If a report looks difficult to parse even to a human, it is expected to fail automated processing.\n' +
      'Subsequent stages (feature/artifact extraction, etc.) aim for near-100% automation. Edge cases that fail in this demo will be handled via a hybrid approach (manual input when needed) in the platform service.',
    status: 'in-progress',
  },
];
