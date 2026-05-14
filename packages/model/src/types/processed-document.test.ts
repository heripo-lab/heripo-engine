import type {
  Chapter,
  ProcessedDocument,
  ProcessedDocumentSource,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  TextBlock,
} from './processed-document';

import { describe, expect, expectTypeOf, test } from 'vitest';

describe('ProcessedDocument source reference fields', () => {
  test('allows legacy objects without optional provenance fields', () => {
    const textBlock: TextBlock = {
      text: 'Legacy body text',
      pdfPageNo: 1,
    };
    const chapter: Chapter = {
      id: 'ch-001',
      originTitle: 'Introduction',
      title: 'Introduction',
      pageNo: 1,
      level: 1,
      textBlocks: [textBlock],
      imageIds: ['img-001'],
      tableIds: ['tbl-001'],
      footnoteIds: ['ftn-001'],
    };
    const image: ProcessedImage = {
      id: 'img-001',
      pdfPageNo: 1,
      path: '/images/image_0.png',
    };
    const table: ProcessedTable = {
      id: 'tbl-001',
      pdfPageNo: 1,
      numRows: 1,
      numCols: 1,
      grid: [
        [
          {
            text: 'Cell',
            rowSpan: 1,
            colSpan: 1,
            isHeader: false,
          },
        ],
      ],
    };
    const footnote: ProcessedFootnote = {
      id: 'ftn-001',
      text: 'Legacy footnote',
      pdfPageNo: 1,
    };
    const document: ProcessedDocument = {
      reportId: 'report-legacy',
      pageRangeMap: {
        1: { startPageNo: 1, endPageNo: 1 },
      },
      chapters: [chapter],
      images: [image],
      tables: [table],
      footnotes: [footnote],
    };

    expect(document.schemaVersion).toBeUndefined();
    expect(document.source).toBeUndefined();
    expect(document.chapters[0].sourceRefs).toBeUndefined();
    expect(document.chapters[0].textBlocks[0].id).toBeUndefined();
    expect(document.chapters[0].textBlocks[0].sourceRef).toBeUndefined();
    expect(document.images[0].sourceRef).toBeUndefined();
    expect(document.images[0].captionSourceRefs).toBeUndefined();
    expect(document.tables[0].sourceRef).toBeUndefined();
    expect(document.tables[0].captionSourceRefs).toBeUndefined();
    expect(document.footnotes[0].sourceRef).toBeUndefined();
  });

  test('accepts source metadata and node-level source references', () => {
    expectTypeOf<ProcessedDocument['source']>().toEqualTypeOf<
      ProcessedDocumentSource | undefined
    >();

    const source: ProcessedDocumentSource = {
      pipelineRunId: 'run-001',
      doclingObjectKey: 'docling/report-001.json',
      doclingSha256: 'abc123',
      handoffManifestObjectKey: 'manifests/run-001.json',
    };
    const document: ProcessedDocument = {
      reportId: 'report-001',
      schemaVersion: 'processed-document.v2',
      source,
      pageRangeMap: {
        1: { startPageNo: 1, endPageNo: 1 },
      },
      chapters: [
        {
          id: 'ch-001',
          originTitle: 'Chapter 1',
          title: 'Chapter 1',
          pageNo: 1,
          level: 1,
          sourceRefs: ['#/texts/0'],
          textBlocks: [
            {
              id: 'txt-001',
              sourceRef: '#/texts/1',
              text: 'Body text',
              pdfPageNo: 1,
            },
          ],
          imageIds: ['img-001'],
          tableIds: ['tbl-001'],
          footnoteIds: ['ftn-001'],
        },
      ],
      images: [
        {
          id: 'img-001',
          sourceRef: '#/pictures/0',
          captionSourceRefs: ['#/texts/2'],
          caption: { fullText: 'Figure 1 Site overview' },
          pdfPageNo: 1,
          path: '/images/image_0.png',
        },
      ],
      tables: [
        {
          id: 'tbl-001',
          sourceRef: '#/tables/0',
          captionSourceRefs: ['#/texts/3'],
          caption: { fullText: 'Table 1 Artifact list' },
          pdfPageNo: 1,
          numRows: 1,
          numCols: 1,
          grid: [
            [
              {
                text: 'Artifact',
                rowSpan: 1,
                colSpan: 1,
                isHeader: true,
              },
            ],
          ],
        },
      ],
      footnotes: [
        {
          id: 'ftn-001',
          sourceRef: '#/texts/4',
          text: 'Footnote text',
          pdfPageNo: 1,
        },
      ],
    };

    expect(document.source).toBe(source);
    expect(document.chapters[0].sourceRefs).toEqual(['#/texts/0']);
    expect(document.chapters[0].textBlocks[0].id).toBe('txt-001');
    expect(document.chapters[0].textBlocks[0].sourceRef).toBe('#/texts/1');
    expect(document.images[0].sourceRef).toBe('#/pictures/0');
    expect(document.images[0].captionSourceRefs).toEqual(['#/texts/2']);
    expect(document.tables[0].sourceRef).toBe('#/tables/0');
    expect(document.tables[0].captionSourceRefs).toEqual(['#/texts/3']);
    expect(document.footnotes[0].sourceRef).toBe('#/texts/4');
  });
});
