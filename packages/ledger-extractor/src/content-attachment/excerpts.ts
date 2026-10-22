import type { CandidateEvidence } from '../candidates/candidate-discovery';
import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';

import { createContentAttachmentInput } from './input';

/** Freeze sentence/phrase ranges without modifying source characters. */
function ranges(text: string, sentences: boolean): Array<[number, number]> {
  if (!sentences) return /\S/u.test(text) ? [[0, text.length]] : [];
  const result: Array<[number, number]> = [];
  const pairs: Record<string, string> = {
    ')': '(',
    ']': '[',
    '}': '{',
    '）': '（',
  };
  const stack: Array<{ char: string; index: number }> = [];
  const balanced: Array<[number, number]> = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (Object.values(pairs).includes(char)) stack.push({ char, index: i });
    else if (stack.length && pairs[char] === stack.at(-1)!.char)
      balanced.push([stack.pop()!.index, i + 1]);
  }
  let start = 0;
  const add = (end: number) => {
    const part = text.slice(start, end);
    const left = part.length - part.trimStart().length;
    const right = part.trimEnd().length;
    if (right > left) result.push([start + left, start + right]);
    start = end;
  };
  for (const segment of new Intl.Segmenter('en', {
    granularity: 'sentence',
  }).segment(text)) {
    const end = segment.index + segment.segment.length;
    if (balanced.some(([left, right]) => left < end && end < right)) continue;
    if (/^\s*\d+\.\s*$/u.test(text.slice(0, end))) continue;
    add(end);
  }
  add(text.length);
  return result;
}

/** Keep the full registry and replace selectable source strings with immutable excerpt IDs. */
export function createContentAttachmentSelectionInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const legacy = createContentAttachmentInput(plan, unit);
  const excerpts: Array<{ ref: string; evidence: CandidateEvidence[] }> = [];
  const sourceToExcerpt = new Map<string, string>();
  const sourceTexts = new Map(
    legacy.payload.current.sources.map((row) => [row[0], row[4]]),
  );
  const rows = legacy.payload.current.sources.flatMap(
    ([sourceRef, kind, contexts, tableCell, text], i) => {
      const source = unit.sources[i];
      return ranges(text, kind === 'text').map(([charStart, charEnd]) => {
        const ref = `E${excerpts.length + 1}`;
        const quote = text.slice(charStart, charEnd);
        excerpts.push({
          ref,
          evidence: [
            {
              sourceId: source.sourceId,
              resourceKey: source.resource.key,
              resourceId: source.resource.resourceId,
              sourceRefs: source.resource.sourceRefs,
              pdfPageNo: source.resource.pdfPageNo,
              logicalPageRange: source.resource.logicalPageRange,
              charStart,
              charEnd,
              quote,
            },
          ],
        });
        sourceToExcerpt.set(sourceRef, ref);
        return [ref, kind, contexts, tableCell, quote] as const;
      });
    },
  );
  const {
    sourceColumns: _columns,
    sources: _sources,
    tables,
    ...context
  } = legacy.payload.current;
  const payload = {
    ...legacy.payload,
    current: {
      ...context,
      excerptColumns: ['ref', 'kind', 'contexts', 'tableCell', 'text'],
      excerpts: rows,
      tableCellColumns: legacy.payload.current.tableCellColumns,
      tables: tables.map((table) => ({
        ...table,
        grid: table.grid.map((row) =>
          row.map((cell) => {
            const ref =
              cell[0] === null ? undefined : sourceToExcerpt.get(cell[0]);
            return [
              ref ?? null,
              ref
                ? null
                : cell[0] === null
                  ? cell[1]
                  : sourceTexts.get(cell[0])!,
              cell[2],
              cell[3],
              cell[4],
            ] as const;
          }),
        ),
      })),
    },
  };
  const codeMap = {
    ...legacy.codeMap,
    segmentation: {
      version: 'sentence-excerpts.v1',
      locale: 'en',
      icu: process.versions.icu,
    },
    excerpts,
  };
  return { payload, codeMap };
}
