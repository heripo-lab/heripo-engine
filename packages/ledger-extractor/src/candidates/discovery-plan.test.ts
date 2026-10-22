import { describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { chapter, input } from './candidate-discovery.test-fixture';
import { prepareCandidateDiscovery } from './discovery-plan';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));

describe('candidate discovery', () => {
  test('plans only the selected subtree with bounded text, adjacent context and actual table cells', () => {
    const doc = input();
    const before = structuredClone(doc);
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 1,
      tableRowsPerUnit: 1,
    });
    expect(doc).toEqual(before);
    expect(plan.units.map((u) => u.resources.length)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(plan.units[1].context.map((c) => c.text)).toContain('1호 우물');
    expect(plan.units[3].table?.headerRows).toEqual(doc.tables[0].grid);
    expect(plan.units[4].resources[0]).toMatchObject({
      kind: 'tableCell',
      rowIndex: 1,
      columnIndex: 0,
    });
    expect(plan.units[5].chapterPath.map((c) => c.id)).toEqual([
      'root',
      'child',
    ]);
    expect(
      prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
        scopeChapterId: 'child',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
      }).units,
    ).toHaveLength(1);
    const missingRefs = input();
    missingRefs.tables[0].caption = { fullText: '우물 목록' };
    missingRefs.tables[0].grid = [];
    expect(
      prepareCandidateDiscovery(buildDocumentResourceIndex(missingRefs), {
        scopeChapterId: 'root',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
      }).units,
    ).toHaveLength(2);
    missingRefs.tables[0].grid = [
      [{ text: '1', rowSpan: 1, colSpan: 1, isHeader: false }],
    ];
    expect(
      prepareCandidateDiscovery(buildDocumentResourceIndex(missingRefs), {
        scopeChapterId: 'root',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
      }).units[1].table?.caption,
    ).toBe('우물 목록');
  });

  test('rejects invalid scope and chunk limits', () => {
    const index = buildDocumentResourceIndex(input());
    for (const [maxTextChars, tableRowsPerUnit] of [
      [0, 1],
      [1, 0],
      [1.2, 1],
      [1, 1.2],
    ])
      expect(() =>
        prepareCandidateDiscovery(index, {
          scopeChapterId: 'root',
          inputSha256: 'h',
          maxTextChars,
          tableRowsPerUnit,
        }),
      ).toThrow('positive integers');
    expect(() =>
      prepareCandidateDiscovery(index, {
        scopeChapterId: 'absent',
        inputSha256: 'h',
        maxTextChars: 1,
        tableRowsPerUnit: 1,
      }),
    ).toThrow('Scope chapter not found');
  });
});

describe('original table identifiers and chapter continuations', () => {
  test('keeps a sibling object description together through the next actual chapter title with original locations', () => {
    const doc = input();
    doc.chapters = [
      chapter({
        textBlocks: [],
        tableIds: [],
        children: [
          chapter({
            id: 'building',
            originTitle: '1) 건물지',
            textBlocks: [
              { id: 'h', text: '(5) 4호 건물지', pdfPageNo: 121 },
              {
                id: 'b',
                text: '4호 건물지는 위치와 조사 방법이 서술된다.',
                pdfPageNo: 121,
              },
            ],
          }),
          chapter({
            id: 'well',
            originTitle: '2) 우물',
            textBlocks: [
              {
                id: 'continuation',
                sourceRef: '#/texts/2826',
                text: '조사 결과 4호 건물지의 규모는 435cm이다.',
                pdfPageNo: 122,
              },
              { id: 'well-heading', text: '2) 우물 (도면 80)', pdfPageNo: 122 },
              {
                id: 'well-body',
                text: '우물은 조사대상지에 있다.',
                pdfPageNo: 122,
              },
            ],
          }),
          chapter({
            id: 'other',
            originTitle: '3) 기타',
            textBlocks: [{ text: '제목을 찾을 수 없는 본문', pdfPageNo: 123 }],
          }),
        ],
      }),
    ];
    const before = structuredClone(doc);
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    });
    expect(plan.units[0].resources.map((r) => r.resourceId)).toEqual([
      'h',
      'b',
      'continuation',
    ]);
    expect(plan.units[0].resources[2]).toMatchObject({
      key: '/chapters/0/children/1/textBlocks/0',
      chapterIds: ['well'],
      sourceRefs: ['#/texts/2826'],
      pdfPageNo: 122,
    });
    expect(plan.units[1].resources.map((r) => r.resourceId)).toEqual([
      'well-heading',
      'well-body',
    ]);
    expect(plan.units[2].resources[0].data.text).toBe(
      '제목을 찾을 수 없는 본문',
    );
    expect(doc).toEqual(before);
  });
});
