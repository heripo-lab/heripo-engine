import type { ProcessedDocument } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import {
  ProcessedDocumentValidationError,
  parseProcessedDocument,
} from './parse-processed-document';

function createValidDocument(): ProcessedDocument {
  return {
    reportId: 'report-001',
    schemaVersion: '1.0.0',
    source: {
      pipelineRunId: 'run-001',
      doclingObjectKey: 'artifacts/result.json',
      doclingSha256: 'abc123',
      handoffManifestObjectKey: 'artifacts/manifest.json',
    },
    pageRangeMap: {
      1: { startPageNo: 1, endPageNo: 1 },
      2: { startPageNo: 2, endPageNo: 3 },
    },
    chapters: [
      {
        id: 'ch-1',
        originTitle: ' Chapter 1 ',
        title: 'Chapter 1',
        pageNo: 1,
        level: 1,
        sourceRefs: ['#/texts/0'],
        textBlocks: [
          {
            id: 'tb-1',
            sourceRef: '#/texts/1',
            text: 'Introduction text.',
            pdfPageNo: 1,
          },
        ],
        imageIds: ['img-1'],
        tableIds: ['tbl-1'],
        footnoteIds: ['fn-1'],
        children: [
          {
            id: 'ch-1-1',
            originTitle: '1.1',
            title: '1.1 Background',
            pageNo: 2,
            level: 2,
            textBlocks: [],
            imageIds: [],
            tableIds: [],
            footnoteIds: [],
          },
        ],
      },
    ],
    images: [
      {
        id: 'img-1',
        sourceRef: '#/pictures/0',
        captionSourceRefs: ['#/texts/2'],
        caption: { num: 'Figure 1', fullText: 'Figure 1 Site overview' },
        pdfPageNo: 1,
        path: 'https://cdn.example.com/images/report-001/file-1/image.png',
      },
    ],
    tables: [
      {
        id: 'tbl-1',
        sourceRef: '#/tables/0',
        caption: { fullText: 'Table 1 Artifact list' },
        pdfPageNo: 2,
        numRows: 2,
        numCols: 2,
        grid: [
          [
            { text: 'Name', rowSpan: 1, colSpan: 1, isHeader: true },
            { text: 'Count', rowSpan: 1, colSpan: 1, isHeader: true },
          ],
          [
            { text: 'Pottery', rowSpan: 1, colSpan: 1, isHeader: false },
            { text: '3', rowSpan: 1, colSpan: 1, isHeader: false },
          ],
        ],
      },
    ],
    footnotes: [
      {
        id: 'fn-1',
        sourceRef: '#/texts/3',
        text: 'A footnote.',
        pdfPageNo: 1,
      },
    ],
  };
}

describe('parseProcessedDocument', () => {
  test('returns a typed document for valid input', () => {
    const input = createValidDocument();

    const document = parseProcessedDocument(input);

    expect(document.reportId).toBe('report-001');
    expect(document.chapters).toHaveLength(1);
    expect(document.chapters[0].children).toHaveLength(1);
    expect(document.images[0].path).toBe(
      'https://cdn.example.com/images/report-001/file-1/image.png',
    );
    expect(document.pageRangeMap[2]).toEqual({ startPageNo: 2, endPageNo: 3 });
  });

  test('accepts a document without optional fields', () => {
    const input: ProcessedDocument = {
      reportId: 'report-002',
      pageRangeMap: {},
      chapters: [],
      images: [],
      tables: [],
      footnotes: [],
    };

    const document = parseProcessedDocument(input);

    expect(document.schemaVersion).toBeUndefined();
    expect(document.chapters).toEqual([]);
  });

  test('does not mutate the input value', () => {
    const input = createValidDocument();
    const snapshot = JSON.parse(JSON.stringify(input));

    parseProcessedDocument(input);

    expect(input).toEqual(snapshot);
  });

  test('throws ProcessedDocumentValidationError for a non-object value', () => {
    expect(() => parseProcessedDocument('not a document')).toThrow(
      ProcessedDocumentValidationError,
    );

    try {
      parseProcessedDocument(null);
      expect.unreachable('should have thrown');
    } catch (error) {
      const validationError = error as ProcessedDocumentValidationError;
      expect(validationError.name).toBe('ProcessedDocumentValidationError');
      expect(validationError.issues.length).toBeGreaterThan(0);
      // Root-level issues have an empty path and only carry the message
      expect(validationError.message).toContain('Invalid ProcessedDocument:');
    }
  });

  test('throws with issue paths for missing required fields', () => {
    const input = { reportId: 'report-003' };

    try {
      parseProcessedDocument(input);
      expect.unreachable('should have thrown');
    } catch (error) {
      const validationError = error as ProcessedDocumentValidationError;
      expect(validationError.issues.map((issue) => issue.path)).toContain(
        'chapters',
      );
      expect(validationError.message).toContain('chapters:');
    }
  });

  test('rejects invalid nested chapter structures', () => {
    const input = createValidDocument() as unknown as Record<string, unknown>;
    input.chapters = [
      {
        id: 'ch-broken',
        originTitle: 'x',
        title: 'x',
        pageNo: 1,
        level: 1,
        textBlocks: [{ text: 42, pdfPageNo: 'one' }],
        imageIds: [],
        tableIds: [],
        footnoteIds: [],
      },
    ];

    expect(() => parseProcessedDocument(input)).toThrow(
      ProcessedDocumentValidationError,
    );
  });

  test('rejects non-numeric pageRangeMap keys', () => {
    const input = createValidDocument() as unknown as Record<string, unknown>;
    input.pageRangeMap = { abc: { startPageNo: 1, endPageNo: 1 } };

    expect(() => parseProcessedDocument(input)).toThrow(
      ProcessedDocumentValidationError,
    );
  });

  test('limits the number of reported issues', () => {
    try {
      parseProcessedDocument({});
      expect.unreachable('should have thrown');
    } catch (error) {
      const validationError = error as ProcessedDocumentValidationError;
      expect(validationError.issues.length).toBeLessThanOrEqual(5);
    }
  });
});
