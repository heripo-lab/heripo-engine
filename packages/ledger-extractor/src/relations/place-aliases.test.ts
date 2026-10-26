import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { PlaceAliasTable } from './place-aliases';

import { describe, expect, test } from 'vitest';

import {
  PLACE_ALIASES_VERSION,
  PlaceAliasValidationError,
  createPlaceAliasResolver,
  placeAliasesSha256,
  validatePlaceAliases,
} from './place-aliases';

const entry = (
  groupId: string,
  recordKind: string,
  sourceName: string,
  sourceIdentifier: string | null = null,
) => ({
  ref: groupId,
  groupId,
  recordKind,
  mentions: [{ sourceName, sourceIdentifier, chapterPath: [], evidence: [] }],
});
const plan = {
  inputSha256: 'hash',
  registry: [
    entry('z1', 'area', '23-1 구역'),
    entry('z2', 'area', '23-2 구역'),
    entry('z2b', 'feature', '23-2 구역'),
    entry('x1', 'area', '23-3 구역'),
    entry('x2', 'area', '23-3 구역'),
    entry('short', 'area', '발굴 2구역'),
    entry('out', 'area', '외곽'),
  ],
  units: [
    {
      sources: [
        { resource: { data: { text: '1) 정밀발굴조사(23-1~ 6구역)' } } },
        { resource: { data: { text: '출수위치 발굴 1구역' } } },
      ],
      readOnlyContext: [{ text: '시굴 외곽 조사' }],
    },
  ],
} as unknown as ContentAttachmentPlan;
const ledger = {
  records: plan.registry.map((e) => ({
    id: `record-${e.groupId}`,
    recordKind: e.recordKind,
    sourceName: e.mentions[0].sourceName,
  })),
} as unknown as ArchaeologyLedgerResult;
const table = (rules: unknown[]): PlaceAliasTable =>
  ({
    version: PLACE_ALIASES_VERSION,
    inputSha256: 'hash',
    source: 'manual',
    confirmedAt: '2026-10-26T00:00:00.000Z',
    rules,
  }) as PlaceAliasTable;
const excavation = {
  id: 'excavation',
  written: ['발굴 {n}구역', '發掘 {n}구역'],
  registered: '23-{n} 구역',
  numbers: { from: 1, to: 4 },
  recordKind: 'area',
  basis: { quote: '정밀발굴조사(23-1~6구역)' },
};

describe('validatePlaceAliases', () => {
  test('accepts a valid table and warns about unmatched names, unused rules and short-form records', () => {
    const result = validatePlaceAliases(
      plan,
      ledger,
      table([
        excavation,
        {
          id: 'outer',
          written: ['시굴 외곽'],
          registered: '외곽',
          basis: { quote: '시굴 외곽 조사' },
        },
        {
          id: 'unused',
          written: ['구역 {n}'],
          registered: '23-{n} 구역',
          basis: { quote: '출수위치' },
        },
      ]),
    );

    expect(result).toEqual({
      errors: [],
      warnings: [
        'Rule excavation: 23-3 구역 matches 2 records',
        'Rule excavation: 23-4 구역 matches no record',
        'Rule excavation: record record-short (발굴 2구역) is registered under a written form',
        'Rule unused: no written form occurs in the document',
      ],
    });
  });

  test('reports every structural problem as an error without warnings', () => {
    const result = validatePlaceAliases(plan, ledger, {
      ...table([
        { ...excavation, numbers: { from: 5, to: 2 }, recordKind: 'room' },
        {
          id: 'excavation',
          written: ['발굴 {n}구역', ''],
          registered: '24-{n}',
          basis: { quote: '없는 문장' },
        },
        {
          written: ['{m} 구역', 3],
          registered: '',
          numbers: { from: 1, to: 2 },
          basis: {},
        },
        {
          id: 'half',
          written: ['발굴 {n}구역'],
          registered: '외곽',
          basis: { quote: '출수위치' },
        },
        null,
      ]),
      version: 'place-aliases.v0',
      inputSha256: 'other',
      source: 'router',
      confirmedAt: 'yesterday',
    });

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([
      'Unsupported place alias version',
      'Place aliases belong to a different input',
      'Unknown place alias source',
      'Invalid confirmation time',
      'Rule excavation: invalid number range',
      'Rule excavation: unknown record kind room',
      'Rule excavation: repeated id',
      'Rule excavation: written forms must be non-empty text',
      'Rule excavation: {n} must appear once in every written form and the registered name, or nowhere',
      'Rule excavation: basis quote not found in the document',
      'Rule excavation: written form 발굴 {n}구역 is sent elsewhere by Rule excavation',
      'Rule 3: missing id',
      'Rule 3: written forms must be non-empty text',
      'Rule 3: missing registered name',
      'Rule 3: only the {n} placeholder is allowed',
      'Rule 3: numbers need the {n} placeholder',
      'Rule 3: missing basis quote',
      'Rule half: {n} must appear once in every written form and the registered name, or nowhere',
      'Rule half: written form 발굴 {n}구역 is sent elsewhere by Rule excavation',
      'Rule 5: missing id',
      'Rule 5: written forms must be non-empty text',
      'Rule 5: missing registered name',
      'Rule 5: missing basis quote',
    ]);
  });

  test('requires at least one rule and carries errors in the thrown error', () => {
    expect(validatePlaceAliases(plan, ledger, null).errors).toEqual([
      'Unsupported place alias version',
      'Place aliases belong to a different input',
      'Unknown place alias source',
      'Invalid confirmation time',
      'Place aliases have no rule',
    ]);
    const error = new PlaceAliasValidationError(['a', 'b']);
    expect(error).toMatchObject({
      name: 'PlaceAliasValidationError',
      message: 'Invalid place aliases: a; b',
      errors: ['a', 'b'],
    });
  });
});

describe('createPlaceAliasResolver', () => {
  const outer = {
    id: 'outer',
    written: ['시굴 외곽'],
    registered: '외곽',
    basis: { quote: '시굴 외곽 조사' },
  };
  const withShort3 = {
    ...plan,
    registry: [...plan.registry, entry('short3', 'area', '발굴 3구역')],
  } as unknown as ContentAttachmentPlan;
  const ledger3 = {
    records: [
      ...ledger.records,
      { id: 'record-short3', recordKind: 'area', sourceName: '발굴 3구역' },
    ],
  } as unknown as ArchaeologyLedgerResult;

  test('maps written places through the rules, by kind and range, and lists short-form records', () => {
    const resolver = createPlaceAliasResolver(
      withShort3,
      ledger3,
      table([excavation, outer]),
      { sha256: 'abc' },
    );

    expect(resolver.resolve('출수위치 발굴 1구역', 'record-a')).toEqual({
      ruleId: 'excavation',
      written: '발굴1구역',
      registered: '23-1 구역',
      quote: '정밀발굴조사(23-1~6구역)',
      recordIds: ['record-z1'],
    });
    expect(resolver.resolve('發掘 2구역', 'record-a')?.recordIds).toEqual([
      'record-z2',
    ]);
    expect(resolver.resolve('발굴 3구역', 'record-a')?.recordIds).toEqual([
      'record-x1',
      'record-x2',
    ]);
    expect(resolver.resolve('발굴 9구역', 'record-a')).toBeNull();
    expect(resolver.resolve('기타', 'record-a')).toBeNull();
    expect(resolver.resolve('시굴 외곽', 'record-a')?.recordIds).toEqual([
      'record-out',
    ]);
    expect(resolver.resolve('발굴 1구역', 'record-short')).toBeNull();
    expect(resolver.duplicates).toEqual([
      {
        recordId: 'record-short',
        ruleId: 'excavation',
        written: '발굴2구역',
        registered: '23-2 구역',
        registeredRecordId: 'record-z2',
      },
      {
        recordId: 'record-short3',
        ruleId: 'excavation',
        written: '발굴3구역',
        registered: '23-3 구역',
      },
    ]);
    expect(resolver.summary).toEqual({
      ruleIds: ['excavation', 'outer'],
      source: 'manual',
      confirmedAt: '2026-10-26T00:00:00.000Z',
      inputSha256: 'hash',
      sha256: 'abc',
    });
    expect(
      createPlaceAliasResolver(plan, ledger, table([outer])).summary,
    ).not.toHaveProperty('sha256');
  });

  test('refuses a table with errors and hashes a table regardless of key order', async () => {
    expect(() => createPlaceAliasResolver(plan, ledger, table([]))).toThrow(
      PlaceAliasValidationError,
    );
    const a = table([excavation]);
    const b = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as PlaceAliasTable;

    expect(await placeAliasesSha256(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await placeAliasesSha256(b)).toBe(await placeAliasesSha256(a));
  });
});
