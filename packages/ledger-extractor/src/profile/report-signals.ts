import type { ProcessedDocument } from '@heripo/model';

import type {
  DocumentResource,
  DocumentResourceIndex,
} from '../resources/document-resource-index';

export const REPORT_SIGNALS_VERSION = 'report-signals.v1' as const;

/** Number of source samples kept per signal. */
const SAMPLES = 3;

type TextResource = Extract<DocumentResource, { kind: 'text' }>;
type TableResource = Extract<DocumentResource, { kind: 'table' }>;

/** Where a counted block sits in the source. */
export interface ReportSignalSample {
  chapterId: string | undefined;
  pdfPageNo: number | null;
  sourceId: string;
  text: string;
}
export interface ReportSignalCount {
  count: number;
  samples: ReportSignalSample[];
}
export interface ReportTocEntry {
  chapterId: string;
  title: string;
  depth: number;
  textChars: number;
  tables: number;
  images: number;
  captionedImages: number;
  appendixLike: boolean;
  investigationLike: boolean;
}
export interface ReportRegistryTableSignal {
  tableId: string | null;
  chapterId: string | undefined;
  chapterTitle: string | undefined;
  pdfPageNo: number | null;
  rows: number;
  cols: number;
  captioned: boolean;
  firstColumnUniqueRate: number;
  appendixLike: boolean;
  header: string;
}
export interface ReportIdentifierVariant {
  prefix: string;
  count: number;
  samples: ReportSignalSample[];
}

/**
 * Deterministic, model-free signals for the report router. Signals are raw counts with source locations;
 * thresholds and trait decisions belong to the router (model and person), not here.
 */
export interface ReportSignals {
  version: typeof REPORT_SIGNALS_VERSION;
  inputSha256: string;
  size: {
    pages: number;
    chapters: number;
    textBlocks: number;
    tables: number;
    captionedTables: number;
    images: number;
    captionedImages: number;
  };
  toc: ReportTocEntry[];
  signals: {
    investigationLikeChapters: Array<
      Pick<ReportTocEntry, 'chapterId' | 'title' | 'depth' | 'textChars'>
    >;
    appendixLikeChapters: Array<
      Pick<ReportTocEntry, 'chapterId' | 'title' | 'tables'>
    >;
    trenchHeadings: ReportSignalCount;
    gridUnits: {
      gridSizeMentions: number;
      unitMentions: number;
      samples: ReportSignalSample[];
    };
    noRemainsSentences: ReportSignalCount;
    priorInvestigationMentions: ReportSignalCount & { chapters: string[] };
    midSentenceBlockRate: {
      rate: number;
      proseBlocks: number;
      midSentenceBlocks: number;
      samples: ReportSignalSample[];
    };
    uncaptionedImagesByChapter: Array<{
      chapterId: string;
      title: string;
      images: number;
      uncaptionedRate: number;
    }>;
    identifierPatterns: Array<
      ReportIdentifierVariant & { variants: ReportIdentifierVariant[] }
    >;
    catalogFieldBlocks: {
      measurementBlocks: number;
      latinOnlyBlocks: number;
      samples: ReportSignalSample[];
    };
    logTables: { count: number; rows: number; headers: string[] };
    registryTables: ReportRegistryTableSignal[];
    stratigraphy: {
      numberedLayerUnits: Array<{ name: string; sections: number }>;
      namedLayers: Array<{ name: string; sections: number }>;
    };
  };
}

/** Generic patterns for any report; they are not tuned to a particular report. */
const PATTERNS = {
  // trench, test pit and grid-like excavation units, numbered on either side
  trenchHeading:
    /^[\s(①-⑳\d.)-]*(\d+\s?(트렌치|피트|시굴갱|그리드)|(트렌치|Tr\.?|TR|Pit|그리드)\s?-?\d+)/i,
  // fixed grid squares or numbered survey areas, e.g. "10 × 10m 그리드", "23-1구역", "Grid A3"
  gridSize: /\d+(\.\d+)?\s?[×xX]\s?\d+(\.\d+)?\s?m/,
  gridUnit: /(그리드|grid|\d+(-[\dA-Z]+)?\s?구역|구획\s?\d+|\d+\s?구획)/i,
  noRemains:
    /(유구|유물|흔적|시설)[^.。]{0,25}(확인되지 않|확인할 수 없|발견되지 않|검출되지 않)/,
  priorInvestigation:
    /((19|20)\d{2})\s?년[^.。]{0,60}(지표조사|시굴조사|발굴조사|정밀조사|조사)/,
  // report-wide numbered stratigraphic units (Roman numerals or numbered layers / layer groups)
  numberedLayerUnit: /([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|\d+)\s?(층군|층위|층)(?![가-힣])/g,
  namedLayer: /[가-힣]{2,10}층(?![가-힣])/g,
  catalogMeasureField:
    /(높이|입지름|구경|저경|굽지름|길이|너비|두께|무게|지름)\s*[\d(]/,
  latinOnly: /^[A-Za-z][A-Za-z ,.'()-]{3,}$/,
  // a line that starts with a short prefix and a hyphenated or composite number, e.g. "ABC23-1"
  leadingIdentifier: /^([가-힣A-Za-z]{1,4})\s?(\d{1,4})\s?-\s?(\d{1,4})\b/,
  logHeader: /(일자|날짜|일차|일시|date)/i,
  logHeaderSecond: /(작업|내용|잠수|인원|날씨|기상|수심|시간)/,
  registryIdHeader: /(번호|연번|일련|No\.?)/i,
  registryNameHeader: /(명칭|유물명|유구명|명|종류|기종|품명)/,
  appendixTitle: /(초록|부록|별표|별첨|목록|Appendix|Abstract|Front Matter)/i,
  investigationTitle:
    /(조사\s?범위|조사\s?방법|조사\s?내용|조사\s?결과|출토\s?유물|출수\s?유물|유물|유구|층위|시굴|발굴|트렌치)/,
};

const cut = (s: string, n = 80) => s.replace(/\s+/g, ' ').slice(0, n);
const isProse = (t: string) =>
  t.length >= 15 && !/^(\(?\d+\)|\d+\.|[①-⑳]|[가-하]\.|\d+\))/.test(t.trim());
const endsMidSentence = (t: string) => {
  const s = t.trim();
  return (
    /,$/.test(s) ||
    (/[가-힣]$/.test(s) && !/(다|음|함|됨|임|요|까|라)$/.test(s))
  );
};

/**
 * Collect report-router signals from a ProcessedDocument and its resource index. Deterministic and offline:
 * counts come from generic patterns, each with up to three source samples (chapter, PDF page and source id
 * in the `id:` / `path:` form used by candidate discovery). The caller supplies the input file hash.
 */
export function collectReportSignals(
  document: ProcessedDocument,
  index: DocumentResourceIndex,
  options: { inputSha256: string },
): ReportSignals {
  const chapters = index.resources.filter(
    (r): r is Extract<DocumentResource, { kind: 'chapter' }> =>
      r.kind === 'chapter',
  );
  const texts = index.resources.filter(
    (r): r is TextResource => r.kind === 'text',
  );
  const tables = index.resources.filter(
    (r): r is TableResource => r.kind === 'table',
  );
  const where = (r: TextResource) => ({
    chapterId: r.chapterIds.at(-1),
    pdfPageNo: r.pdfPageNo,
    sourceId: r.resourceId ? `id:${r.resourceId}` : `path:${r.key}`,
  });
  const sample = (list: TextResource[]): ReportSignalSample[] =>
    list
      .slice(0, SAMPLES)
      .map((r) => ({ ...where(r), text: cut(r.data.text) }));

  const toc: ReportTocEntry[] = chapters.map((c) => {
    const id = c.resourceId!;
    const own = texts.filter((t) => t.chapterIds.at(-1) === id);
    const imgs = document.images.filter((i) => c.data.imageIds.includes(i.id));
    return {
      chapterId: id,
      title: c.data.originTitle,
      depth: c.key.split('/children/').length - 1,
      textChars: own.reduce((a, t) => a + t.data.text.length, 0),
      tables: c.data.tableIds.length,
      images: imgs.length,
      captionedImages: imgs.filter((i) => i.caption?.fullText).length,
      appendixLike: PATTERNS.appendixTitle.test(c.data.originTitle),
      investigationLike: PATTERNS.investigationTitle.test(c.data.originTitle),
    };
  });

  const trenchHeads = texts.filter(
    (t) =>
      t.data.text.length <= 60 &&
      PATTERNS.trenchHeading.test(t.data.text.trim()),
  );
  const gridSize = texts.filter(
    (t) =>
      PATTERNS.gridSize.test(t.data.text) &&
      PATTERNS.gridUnit.test(t.data.text),
  );
  const gridUnits = texts.filter((t) => PATTERNS.gridUnit.test(t.data.text));
  const noRemains = texts.filter((t) => PATTERNS.noRemains.test(t.data.text));
  const prior = texts.filter((t) =>
    PATTERNS.priorInvestigation.test(t.data.text),
  );
  const prose = texts.filter((t) => isProse(t.data.text));
  const mid = prose.filter((t) => endsMidSentence(t.data.text));

  const uncaptionedImagesByChapter = toc
    .filter((c) => c.images >= 5)
    .map((c) => ({
      chapterId: c.chapterId,
      title: c.title,
      images: c.images,
      uncaptionedRate: +(1 - c.captionedImages / c.images).toFixed(2),
    }))
    .filter((c) => c.uncaptionedRate > 0);

  // leading identifiers grouped by prefix; prefixes sharing a number with the main prefix are variants
  const ids = texts.flatMap((t) => {
    const m = t.data.text.trim().match(PATTERNS.leadingIdentifier);
    return m ? [{ t, m }] : [];
  });
  const byPrefix = new Map<string, typeof ids>();
  for (const x of ids)
    byPrefix.set(x.m[1], [...(byPrefix.get(x.m[1]) ?? []), x]);
  const prefixes = [...byPrefix].sort((a, b) => b[1].length - a[1].length);
  const identifierPatterns =
    prefixes.length && prefixes[0][1].length >= 3
      ? [
          {
            prefix: prefixes[0][0],
            count: prefixes[0][1].length,
            variants: prefixes
              .slice(1)
              .filter(([, l]) =>
                l.some(({ m }) => prefixes[0][1].some((x) => x.m[2] === m[2])),
              )
              .map(([prefix, l]) => ({
                prefix,
                count: l.length,
                samples: sample(l.map((x) => x.t)),
              })),
            samples: sample(prefixes[0][1].map((x) => x.t)),
          },
        ]
      : [];

  const measure = texts.filter(
    (t) =>
      PATTERNS.catalogMeasureField.test(t.data.text) &&
      t.data.text.length < 200,
  );
  const latin = texts.filter((t) =>
    PATTERNS.latinOnly.test(t.data.text.trim()),
  );

  const head = (t: TableResource) =>
    (t.data.grid[0] ?? []).map((c) => c.text).join('|');
  const logTables = tables.filter(
    (t) =>
      PATTERNS.logHeader.test(head(t)) &&
      PATTERNS.logHeaderSecond.test(head(t)),
  );
  const registryTables = tables
    .filter(
      (t) =>
        PATTERNS.registryIdHeader.test(head(t)) &&
        PATTERNS.registryNameHeader.test(head(t)) &&
        t.data.grid.length >= 4,
    )
    .map((t) => {
      const first = t.data.grid
        .slice(1)
        .map((r) => (r[0]?.text ?? '').trim())
        .filter(Boolean);
      const chapter = toc.find((c) => c.chapterId === t.chapterIds.at(-1));
      return {
        tableId: t.resourceId,
        chapterId: chapter?.chapterId,
        chapterTitle: chapter?.title,
        pdfPageNo: t.pdfPageNo,
        rows: t.data.grid.length,
        cols: t.data.grid[0].length,
        captioned: !!t.data.caption?.fullText,
        firstColumnUniqueRate: first.length
          ? +(new Set(first).size / first.length).toFixed(2)
          : 0,
        appendixLike: !!chapter?.appendixLike,
        header: cut(head(t), 60),
      };
    });

  // stratigraphy: numbered layer units vs generic layer names repeated across trench sections
  const sectionOf = new Map<string, string>();
  let current: string | null = null;
  for (const t of texts) {
    if (trenchHeads.includes(t)) current = t.key;
    sectionOf.set(t.key, `${t.chapterIds.at(-1)}#${current ?? ''}`);
  }
  const numbered = new Map<string, Set<string>>();
  const named = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, name: string, section: string) =>
    map.set(name, (map.get(name) ?? new Set()).add(section));
  for (const t of texts) {
    const section = sectionOf.get(t.key)!;
    for (const m of t.data.text.matchAll(PATTERNS.numberedLayerUnit))
      add(numbered, m[0].replace(/\s/g, ''), section);
    for (const m of t.data.text.matchAll(PATTERNS.namedLayer))
      add(named, m[0], section);
  }
  const top = (map: Map<string, Set<string>>, n = 8) =>
    [...map]
      .map(([name, s]) => ({ name, sections: s.size }))
      .sort((a, b) => b.sections - a.sections)
      .slice(0, n);

  return {
    version: REPORT_SIGNALS_VERSION,
    inputSha256: options.inputSha256,
    size: {
      pages: Object.keys(document.pageRangeMap).length,
      chapters: toc.length,
      textBlocks: texts.length,
      tables: tables.length,
      captionedTables: tables.filter((t) => t.data.caption?.fullText).length,
      images: document.images.length,
      captionedImages: document.images.filter((i) => i.caption?.fullText)
        .length,
    },
    toc,
    signals: {
      investigationLikeChapters: toc
        .filter((c) => c.investigationLike)
        .map((c) => ({
          chapterId: c.chapterId,
          title: c.title,
          depth: c.depth,
          textChars: c.textChars,
        })),
      appendixLikeChapters: toc
        .filter((c) => c.appendixLike)
        .map((c) => ({
          chapterId: c.chapterId,
          title: c.title,
          tables: c.tables,
        })),
      trenchHeadings: {
        count: trenchHeads.length,
        samples: sample(trenchHeads),
      },
      gridUnits: {
        gridSizeMentions: gridSize.length,
        unitMentions: gridUnits.length,
        samples: sample([
          ...gridSize,
          ...gridUnits.filter((t) => !gridSize.includes(t)),
        ]),
      },
      noRemainsSentences: {
        count: noRemains.length,
        samples: sample(noRemains),
      },
      priorInvestigationMentions: {
        count: prior.length,
        chapters: [...new Set(prior.map((t) => t.chapterIds.at(-1)!))],
        samples: sample(prior),
      },
      midSentenceBlockRate: {
        rate: prose.length ? +(mid.length / prose.length).toFixed(3) : 0,
        proseBlocks: prose.length,
        midSentenceBlocks: mid.length,
        samples: sample(mid),
      },
      uncaptionedImagesByChapter,
      identifierPatterns,
      catalogFieldBlocks: {
        measurementBlocks: measure.length,
        latinOnlyBlocks: latin.length,
        samples: sample([...measure.slice(0, 2), ...latin.slice(0, 1)]),
      },
      logTables: {
        count: logTables.length,
        rows: logTables.reduce((a, t) => a + t.data.grid.length, 0),
        headers: [...new Set(logTables.map((t) => cut(head(t), 40)))].slice(
          0,
          4,
        ),
      },
      registryTables,
      stratigraphy: {
        numberedLayerUnits: top(numbered),
        namedLayers: top(named),
      },
    },
  };
}
