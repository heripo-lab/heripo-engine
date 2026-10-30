import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';

import { aliasesOf, norm } from '../relations/record-names';

export const TEXT_ATTRIBUTES_VERSION = 'text-attributes.v2' as const;

/** A measurement run or a quantity in a record's own excerpt, kept as one source phrase. */
export interface TextAttribute {
  recordId: string;
  /** The source's own label (`전체 규모`), the single dimension word, or `크기` for unlabeled runs. */
  keyText: string;
  /** The contiguous source phrase, such as `길이 4.9m, 너비 3.89m이상, 깊이 3.7m`; never split. */
  valueText: string;
  /** The unit when every measurement in the run is written with the same one. */
  unitText?: string;
  /** The sentence the value is in. */
  sourceText: string;
  extractionMethod: 'rule';
  metadata: {
    kind: 'measurement' | 'quantity';
    sourceId: string;
    locator: string;
    pdfPageNo: number | null;
  };
}
/** A value whose sentence also names another record of the same kind; its owner is not decided. */
export interface TextAttributeOwnerQuestion {
  recordId: string;
  /** The other records of the record's kind the sentence names. */
  otherRecordIds: string[];
  attribute: TextAttribute;
}
export interface TextAttributes {
  version: typeof TEXT_ATTRIBUTES_VERSION;
  attributes: TextAttribute[];
  ownerQuestions: TextAttributeOwnerQuestion[];
}

/**
 * A dimension word, with a qualifier before it (`잔존 너비`), an attached prefix (`입지름`, `굽높이`) and a
 * parenthesized qualifier after it (`높이(잔존)`).
 */
const DIMENSION =
  '(?:(?:최대|최소|잔존|현존|확인|전체|복원|추정)\\s*)?[가-힣]{0,3}(?:길이|너비|폭|깊이|높이|지름|직경|구경|저경|동최대경|기고|두께|둘레|면적)(?:\\([가-힣]+\\))?';
const NUMBER = '\\d[\\d.,]*(?:\\s*[~∼-]\\s*\\d[\\d.,]*)?';
const UNIT = '(?:cm|㎝|mm|㎜|m²|㎡|km|m|kg|g)';
const QUALIFIER = '(?:\\s*(?:이상|이하|내외|정도|가량|남짓))?';
/** A part written after a value (`0.5cm(내)`), and further values of the same dimension (`0.5cm(외)`). */
const PART = '\\([가-힣]{1,3}\\)';
const CONTINUED = `(?:${PART}(?:\\s*${NUMBER}\\s*${UNIT}${PART})*)?`;
/** `길이 4.9m`, `잔존 너비는 260~470cm`, `238×28×32cm`, `굽높이 0.5cm(내) 0.5cm(외)`. */
const TOKEN = new RegExp(
  `(${DIMENSION})(?:\\s*[은는이가의:]\\s*|\\s+)?(${NUMBER})\\s*(${UNIT})${QUALIFIER}${CONTINUED}` +
    `|(${NUMBER}(?:\\s*[×xX]\\s*${NUMBER}){1,2})\\s*(${UNIT})${QUALIFIER}`,
  'g',
);
/** Text allowed between two measurements of one run. */
const RUN_GAP = /^[\s,·]*(?:와|과|및|이며|이고|이고,|이며,)?[\s,·]*$/;
/** `전체 규모는`, `크기는` right before a run. */
const LABEL = /(?:([가-힣]+)\s+)?(규모|크기)\s*(?:[은는이가]|:)?\s*$/;
const PARTICLE_END = /[의은는이가을를에]$/;
/** Sentence ends: a period, question or exclamation mark before whitespace, or a line break; not `4.9m`. */
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n/;

/**
 * Collect measurement runs and quantities from each record's own excerpts (A2), deterministically and
 * without model calls. In one sentence, consecutive measurements joined by commas or `와·과·및` form one
 * value, kept as written (the spec's 우물 example: `길이 4.9m, 너비 3.89m이상, 깊이 3.7m` is one value). The key
 * is the label written right before the run (`전체 규모는` → `전체 규모`), else the single dimension word, else
 * `크기`; units are not converted. A quantity right after an unnumbered (collective) record's own name
 * (`수혈 5기`) becomes `수량`.
 * When the sentence also names another numbered record of the same kind, the value is not assigned and
 * becomes an owner question.
 */
export function collectTextAttributes(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
): TextAttributes {
  const kindOf = new Map(ledger.records.map((r) => [r.id, r.recordKind]));
  // names of numbered records, for owner checks; own names, for quantities
  const numberedNames = plan.registry
    .filter((e) => e.mentions.some((m) => m.sourceIdentifier))
    .flatMap((e) =>
      aliasesOf(e, norm).map((alias) => ({
        alias,
        recordId: `record-${e.groupId}`,
      })),
    );
  // a quantity belongs to an unnumbered (collective) record named right before it: `수혈 5기`
  const ownNames = new Map(
    plan.registry.map((e) => [
      `record-${e.groupId}`,
      e.mentions.some((m) => m.sourceIdentifier)
        ? []
        : [...new Set(e.mentions.map((m) => norm(m.sourceName)))],
    ]),
  );
  const attributes: TextAttribute[] = [];
  const ownerQuestions: TextAttributeOwnerQuestion[] = [];
  const seen = new Set<string>();

  for (const source of ledger.sources)
    for (const sentence of source.excerpt.split(SENTENCE_BREAK)) {
      const kind = kindOf.get(source.recordId)!;
      const text = norm(sentence);
      const others = [
        ...new Set(
          numberedNames
            .filter(
              ({ alias, recordId }) =>
                recordId !== source.recordId &&
                kindOf.get(recordId) === kind &&
                new RegExp(
                  `(?<![\\d-])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                ).test(text),
            )
            .map((n) => n.recordId),
        ),
      ];
      const found: Array<
        Omit<
          TextAttribute,
          'recordId' | 'sourceText' | 'extractionMethod' | 'metadata'
        > & { kind: TextAttribute['metadata']['kind'] }
      > = [];

      // measurement runs
      const tokens = [...sentence.matchAll(TOKEN)];
      let start = 0;
      while (start < tokens.length) {
        let end = start;
        while (
          end + 1 < tokens.length &&
          RUN_GAP.test(
            sentence.slice(
              tokens[end].index! + tokens[end][0].length,
              tokens[end + 1].index,
            ),
          )
        )
          end++;
        const run = tokens.slice(start, end + 1);
        const from = run[0].index!;
        const to = run.at(-1)!.index! + run.at(-1)![0].length;
        const label = sentence.slice(0, from).match(LABEL);
        const modifier =
          label?.[1] && !PARTICLE_END.test(label[1]) ? `${label[1]} ` : '';
        const units = [...new Set(run.map((t) => t[3] ?? t[5]))];
        found.push({
          keyText: label
            ? `${modifier}${label[2]}`
            : run.length === 1 && run[0][1]
              ? run[0][1].replace(/\s+/g, ' ')
              : '크기',
          valueText: sentence.slice(from, to),
          ...(units.length === 1 ? { unitText: units[0] } : {}),
          kind: 'measurement',
        });
        start = end + 1;
      }
      // quantity right after the record's own name
      for (const name of ownNames.get(source.recordId)!) {
        const m = text.match(
          new RegExp(
            `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+(?:점|기|개|매|편))`,
          ),
        );
        if (m)
          found.push({ keyText: '수량', valueText: m[1], kind: 'quantity' });
      }

      for (const { kind: valueKind, ...value } of found) {
        const key = `${source.recordId}|${norm(sentence)}|${value.valueText}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const attribute: TextAttribute = {
          recordId: source.recordId,
          ...value,
          sourceText: sentence.trim(),
          extractionMethod: 'rule',
          metadata: {
            kind: valueKind,
            sourceId: source.id,
            locator: source.locator,
            pdfPageNo: source.pdfPageNo,
          },
        };
        if (others.length)
          ownerQuestions.push({
            recordId: source.recordId,
            otherRecordIds: others,
            attribute,
          });
        else attributes.push(attribute);
      }
    }
  return { version: TEXT_ATTRIBUTES_VERSION, attributes, ownerQuestions };
}
