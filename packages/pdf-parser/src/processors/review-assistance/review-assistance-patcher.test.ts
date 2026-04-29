import type {
  DoclingBBox,
  DoclingDocument,
  DoclingTableItem,
  DoclingTextItem,
  ReviewAssistanceCommand,
  ReviewAssistanceDecision,
  ReviewAssistancePageResult,
} from '@heripo/model';

import type { PageReviewContext } from './page-review-context-builder';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ReviewAssistancePatcher } from './review-assistance-patcher';

const { mockSpawnAsync } = vi.hoisted(() => ({
  mockSpawnAsync: vi.fn(),
}));

vi.mock('@heripo/shared', () => ({
  spawnAsync: mockSpawnAsync,
}));

const bbox: DoclingBBox = {
  l: 10,
  t: 10,
  r: 90,
  b: 40,
  coord_origin: 'TOPLEFT',
};

function makeDoc(): DoclingDocument {
  return {
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'sample',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 1,
      filename: 'sample.pdf',
    },
    furniture: {
      self_ref: '#/furniture',
      children: [],
      content_layer: 'furniture',
      name: '_root_',
      label: 'unspecified',
    },
    body: {
      self_ref: '#/body',
      children: [
        { $ref: '#/texts/0' },
        { $ref: '#/pictures/0' },
        { $ref: '#/texts/1' },
        { $ref: '#/tables/0' },
        { $ref: '#/texts/2' },
      ],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts: [
      makeText('#/texts/0', 'Old text', bbox),
      makeText('#/texts/1', 'Figure 1', {
        l: 10,
        t: 42,
        r: 90,
        b: 55,
        coord_origin: 'TOPLEFT',
      }),
      makeText('#/texts/2', 'Move me', {
        l: 10,
        t: 70,
        r: 90,
        b: 85,
        coord_origin: 'TOPLEFT',
      }),
    ],
    pictures: [
      {
        self_ref: '#/pictures/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'picture',
        prov: [
          {
            page_no: 1,
            bbox,
            charspan: [0, 0],
          },
        ],
        captions: [],
        references: [],
        footnotes: [],
        annotations: [],
      },
    ],
    tables: [makeTable('#/tables/0', ''), makeTable('#/tables/1', 'continued')],
    pages: {
      '1': {
        page_no: 1,
        size: { width: 100, height: 100 },
        image: {
          mimetype: 'image/png',
          dpi: 200,
          size: { width: 100, height: 100 },
          uri: 'pages/page_0.png',
        },
      },
    },
  };
}

function makeText(
  selfRef: string,
  text: string,
  textBbox: DoclingBBox,
  label = 'text',
): DoclingTextItem {
  return {
    self_ref: selfRef,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label,
    prov: [
      {
        page_no: 1,
        bbox: textBbox,
        charspan: [0, text.length],
      },
    ],
    orig: text,
    text,
  };
}

function makeTable(selfRef: string, text: string): DoclingTableItem {
  return {
    self_ref: selfRef,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: 'table',
    prov: [
      {
        page_no: 1,
        bbox,
        charspan: [0, 0],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    data: {
      num_rows: 1,
      num_cols: 1,
      table_cells: [
        {
          bbox,
          row_span: 1,
          col_span: 1,
          start_row_offset_idx: 0,
          end_row_offset_idx: 1,
          start_col_offset_idx: 0,
          end_col_offset_idx: 1,
          text,
          column_header: false,
          row_header: false,
          row_section: false,
          fillable: false,
        },
      ],
      grid: [
        [
          {
            bbox,
            row_span: 1,
            col_span: 1,
            start_row_offset_idx: 0,
            end_row_offset_idx: 1,
            start_col_offset_idx: 0,
            end_col_offset_idx: 1,
            text,
            column_header: false,
            row_header: false,
            row_section: false,
            fillable: false,
          },
        ],
      ],
    },
  };
}

function makeContext(outputDir: string): PageReviewContext {
  return {
    pageNo: 1,
    pageSize: { width: 100, height: 100 },
    pageImagePath: join(outputDir, 'pages', 'page_0.png'),
    textBlocks: [
      {
        ref: '#/texts/1',
        label: 'text',
        text: 'Figure 1',
        bbox: {
          l: 15,
          t: 56,
          r: 55,
          b: 65,
          coord_origin: 'TOPLEFT',
        },
        suspectReasons: ['caption_like_body_text'],
      },
    ],
    missingTextCandidates: [],
    tables: [
      {
        ref: '#/tables/0',
        bbox,
        gridPreview: [['']],
        emptyCellRatio: 1,
        suspectReasons: [],
      },
    ],
    pictures: [
      {
        ref: '#/pictures/0',
        bbox,
        suspectReasons: [],
      },
    ],
    orphanCaptions: [
      {
        ref: '#/texts/1',
        text: 'Figure 1',
        bbox: {
          l: 15,
          t: 56,
          r: 55,
          b: 65,
          coord_origin: 'TOPLEFT',
        },
        currentLabel: 'text',
        captionLikeBodyText: true,
        nearestMediaRefs: [],
      },
    ],
    footnotes: [],
    layout: {
      readingOrderRefs: [],
      visualOrderRefs: [],
      bboxWarnings: [],
    },
    domainPatterns: [],
  };
}

function makePageResult(
  commands: ReviewAssistanceCommand[],
): ReviewAssistancePageResult {
  return {
    pageNo: 1,
    status: 'succeeded',
    decisions: commands.map((command, index) => makeDecision(command, index)),
    issues: [],
  };
}

function makeDecision(
  command: ReviewAssistanceCommand,
  index: number,
): ReviewAssistanceDecision {
  return {
    id: `ra-test-${index + 1}`,
    pageNo: 1,
    command,
    confidence: 0.95,
    disposition: 'auto_applied',
    reasons: ['test'],
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('ReviewAssistancePatcher', () => {
  let outputDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outputDir = mkdtempSync(join(tmpdir(), 'review-patcher-'));
    mkdirSync(join(outputDir, 'pages'), { recursive: true });
    writeFileSync(join(outputDir, 'pages', 'page_0.png'), Buffer.from([1]));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  test('applies supported document mutations and keeps sidecar-only metadata', async () => {
    const doc = makeDoc();
    const nextBbox: DoclingBBox = {
      l: 11,
      t: 12,
      r: 91,
      b: 41,
      coord_origin: 'TOPLEFT',
    };

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          { op: 'replaceText', textRef: '#/texts/0', text: 'New text' },
          { op: 'updateTextRole', textRef: '#/texts/1', label: 'caption' },
          {
            op: 'updatePictureCaption',
            pictureRef: '#/pictures/0',
            caption: 'Figure 1. Site',
          },
          {
            op: 'updateTableCell',
            tableRef: '#/tables/0',
            row: 0,
            col: 0,
            text: 'Cell',
          },
          { op: 'updateBbox', targetRef: '#/texts/0', bbox: nextBbox },
          {
            op: 'moveNode',
            sourceRef: '#/texts/2',
            targetRef: '#/texts/0',
            position: 'before',
          },
          {
            op: 'linkContinuedTable',
            sourceTableRef: '#/tables/0',
            continuedTableRef: '#/tables/1',
            relation: 'continues_on_next_page',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.texts[0].text).toBe('New text');
    expect(result.doc.texts[1].label).toBe('caption');
    expect(result.doc.pictures[0].captions).toHaveLength(1);
    expect(result.doc.tables[0].data.grid[0][0].text).toBe('Cell');
    expect(result.doc.tables[0].data.table_cells[0].text).toBe('Cell');
    expect(result.doc.texts[0].prov[0].bbox).toEqual(nextBbox);
    expect(result.doc.body.children[0].$ref).toBe('#/texts/2');
    expect(result.pages[0].decisions[4].evidence?.previousBbox).toEqual(bbox);
    expect(result.pages[0].decisions[6].metadata).toEqual({
      continuedTable: {
        sourceTableRef: '#/tables/0',
        continuedTableRef: '#/tables/1',
        relation: 'continues_on_next_page',
      },
    });
  });

  test('snaps and crops added pictures, then links nearby orphan captions', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '80x70+10+20', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    const doc = makeDoc();
    doc.pictures = [];
    doc.body.children = [{ $ref: '#/texts/1' }];

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'addPicture',
            pageNo: 1,
            bbox: { l: 10, t: 10, r: 90, b: 90, coord_origin: 'TOPLEFT' },
            imageUri: '',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.pictures).toHaveLength(1);
    expect(result.doc.pictures[0].captions).toEqual([{ $ref: '#/texts/1' }]);
    expect(result.doc.texts[1].label).toBe('caption');
    expect(
      (result.doc.pictures[0] as unknown as { image: { uri: string } }).image
        .uri,
    ).toBe('images/assisted_page1_ra-test-1.png');
    expect(result.pages[0].decisions[0].evidence?.snappedBbox).toMatchObject({
      l: 15,
      t: 20,
      r: 55,
      b: 55,
    });
    expect(result.pages[0].decisions[0].evidence?.generatedRefs).toEqual([
      '#/pictures/0',
      '#/texts/1',
    ]);
  });

  test('preserves non-applicable pages and records patch conflicts as skipped', async () => {
    const logger = makeLogger();
    const doc = makeDoc();
    const proposal: ReviewAssistanceDecision = {
      ...makeDecision(
        { op: 'replaceText', textRef: '#/texts/0', text: 'Proposal only' },
        0,
      ),
      disposition: 'proposal',
    };
    const invalid = makeDecision(
      { op: 'replaceText', textRef: '#/texts/404', text: 'Missing' },
      1,
    );
    const failedPage: ReviewAssistancePageResult = {
      pageNo: 1,
      status: 'failed',
      decisions: [makeDecision({ op: 'removeText', textRef: '#/texts/0' }, 2)],
      issues: [],
    };
    const noContextPage: ReviewAssistancePageResult = {
      pageNo: 2,
      status: 'succeeded',
      decisions: [makeDecision({ op: 'removeText', textRef: '#/texts/0' }, 3)],
      issues: [],
    };

    const result = await new ReviewAssistancePatcher(logger).apply(
      doc,
      [
        {
          pageNo: 1,
          status: 'succeeded',
          decisions: [proposal, invalid],
          issues: [],
        },
        failedPage,
        noContextPage,
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.texts[0].text).toBe('Old text');
    expect(result.pages[0].decisions[0]).toBe(proposal);
    expect(result.pages[0].decisions[1].disposition).toBe('skipped');
    expect(result.pages[0].decisions[1].reasons).toContain(
      'patch_skipped: text_ref_not_found',
    );
    expect(result.pages[1]).toBe(failedPage);
    expect(result.pages[2]).toBe(noContextPage);
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistancePatcher] Command ra-test-2 skipped',
      expect.any(Error),
    );
  });

  test('applies remaining text, table, footnote, and hiding commands', async () => {
    const doc = makeDoc();
    doc.pictures[0].captions = [{ $ref: '#/texts/1' }];
    doc.tables[0].captions = [{ $ref: '#/texts/1' }];

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'addText',
            pageNo: 1,
            bbox,
            text: 'Header',
            label: 'page_header',
          },
          {
            op: 'addText',
            pageNo: 1,
            bbox,
            text: 'Body tail',
            label: 'text',
          },
          {
            op: 'addText',
            pageNo: 1,
            bbox,
            text: 'Inserted',
            label: 'text',
            afterRef: '#/texts/0',
          },
          {
            op: 'splitText',
            textRef: '#/texts/0',
            parts: [
              { text: 'First', label: 'section_header' },
              { text: 'Second' },
            ],
          },
          {
            op: 'mergeTexts',
            textRefs: ['#/texts/0', '#/texts/2'],
            keepRef: '#/texts/0',
            text: 'Merged',
          },
          { op: 'removeText', textRef: '#/texts/1' },
          {
            op: 'replaceTable',
            tableRef: '#/tables/0',
            grid: [
              [
                {
                  text: 'A',
                  rowSpan: 2,
                  colSpan: 3,
                  columnHeader: true,
                  rowHeader: true,
                },
              ],
            ],
          },
          {
            op: 'replaceTable',
            tableRef: '#/tables/1',
            grid: [[{ text: 'B' }]],
            caption: 'Table 1',
          },
          { op: 'hidePicture', pictureRef: '#/pictures/0', reason: 'split' },
          {
            op: 'linkFootnote',
            markerTextRef: '#/texts/5',
            footnoteTextRef: '#/texts/6',
          },
          {
            op: 'moveNode',
            sourceRef: '#/texts/5',
            targetRef: '#/texts/0',
            position: 'after',
          },
          { op: 'updateTextRole', textRef: '#/texts/5', label: 'page_header' },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.furniture.children).toEqual(
      expect.arrayContaining([{ $ref: '#/texts/3' }, { $ref: '#/texts/5' }]),
    );
    expect(result.doc.texts[0]).toMatchObject({
      text: 'Merged',
      label: 'section_header',
    });
    expect(result.doc.texts[6]).toMatchObject({
      text: 'Second',
      label: 'footnote',
    });
    expect(result.doc.pictures[0].captions).toEqual([]);
    expect(result.doc.tables[0].captions).toEqual([]);
    expect(result.doc.tables[0].data.grid[0][0]).toMatchObject({
      text: 'A',
      row_span: 2,
      col_span: 3,
      column_header: true,
      row_header: true,
    });
    expect(result.doc.tables[1].captions).toHaveLength(1);
    expect(result.doc.body.children.map((child) => child.$ref)).not.toContain(
      '#/pictures/0',
    );
    expect(result.pages[0].decisions[8].metadata).toEqual({
      hiddenPicture: { pictureRef: '#/pictures/0', reason: 'split' },
    });
    expect(result.pages[0].decisions[9].metadata).toEqual({
      footnoteLink: {
        markerTextRef: '#/texts/5',
        footnoteTextRef: '#/texts/6',
      },
    });
    expect(result.doc.furniture.children).toEqual(
      expect.arrayContaining([{ $ref: '#/texts/5' }]),
    );
  });

  test('updates existing picture and table caption refs', async () => {
    const doc = makeDoc();
    doc.pictures[0].captions = [{ $ref: '#/texts/1' }];
    doc.tables[0].captions = [{ $ref: '#/texts/2' }];

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'updatePictureCaption',
            pictureRef: '#/pictures/0',
            caption: 'Updated figure',
          },
          {
            op: 'replaceTable',
            tableRef: '#/tables/0',
            grid: [[{ text: 'A' }]],
            caption: 'Updated table',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.texts[1]).toMatchObject({
      text: 'Updated figure',
      label: 'caption',
    });
    expect(result.doc.texts[2]).toMatchObject({
      text: 'Updated table',
      label: 'caption',
    });
    expect(result.pages[0].decisions[0].evidence?.generatedRefs).toEqual([
      '#/texts/1',
    ]);
    expect(result.pages[0].decisions[1].evidence?.generatedRefs).toEqual([
      '#/texts/2',
    ]);
  });

  test('splits pictures into deterministic assisted crops', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '60x60+0+0', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '60x60+0+0', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    const doc = makeDoc();

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'splitPicture',
            pictureRef: '#/pictures/0',
            regions: [
              {
                bbox: { l: 10, t: 10, r: 70, b: 70, coord_origin: 'TOPLEFT' },
                caption: 'Figure 1-A',
              },
              {
                id: 'right-panel',
                bbox: { l: 30, t: 30, r: 90, b: 90, coord_origin: 'TOPLEFT' },
              },
            ],
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    const bodyRefs = result.doc.body.children.map((child) => child.$ref);
    expect(bodyRefs).not.toContain('#/pictures/0');
    expect(bodyRefs).toEqual(
      expect.arrayContaining(['#/pictures/1', '#/pictures/2']),
    );
    expect(result.doc.pictures[1].captions).toHaveLength(1);
    expect(result.doc.pictures[2].captions).toEqual([{ $ref: '#/texts/1' }]);
    expect(result.pages[0].decisions[0].metadata).toMatchObject({
      splitPicture: {
        sourcePictureRef: '#/pictures/0',
        replacementRefs: ['#/pictures/1', '#/pictures/2'],
      },
    });
  });

  test('adds a picture with an explicit caption', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '80x70+10+20', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    const doc = makeDoc();
    doc.pictures = [];

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'addPicture',
            pageNo: 1,
            bbox: { l: 10, t: 10, r: 90, b: 90, coord_origin: 'TOPLEFT' },
            imageUri: '',
            caption: 'Figure 2',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.pictures[0].captions).toEqual([{ $ref: '#/texts/3' }]);
    expect(result.doc.texts[3]).toMatchObject({
      text: 'Figure 2',
      label: 'caption',
    });
  });

  test('covers defensive fallback branches in patch helpers', async () => {
    const logger = makeLogger();
    const patcher = new ReviewAssistancePatcher(logger) as unknown as {
      apply: ReviewAssistancePatcher['apply'];
      applyCommand: (
        doc: DoclingDocument,
        context: PageReviewContext,
        decision: ReviewAssistanceDecision,
        outputDir: string,
      ) => Promise<unknown>;
      appendPicture: (
        doc: DoclingDocument,
        pageNo: number,
        bbox: DoclingBBox,
        imageUri: string,
      ) => string;
      resolveContainer: (doc: DoclingDocument, ref: string) => unknown;
      resolvePicture: (doc: DoclingDocument, ref: string) => unknown;
      resolveOrphanCaptions: (
        doc: DoclingDocument,
        context: PageReviewContext,
        targets: Array<{ ref: string; kind: 'table'; bbox?: DoclingBBox }>,
      ) => string[];
      insertByPagePosition: (
        doc: DoclingDocument,
        ref: string,
        pageNo: number,
        bbox: DoclingBBox,
      ) => void;
      insertRef: (
        doc: DoclingDocument,
        ref: string,
        afterRef: string | undefined,
        parentRef: string,
      ) => void;
      replaceRefInContainers: (
        doc: DoclingDocument,
        ref: string,
        replacements: string[],
      ) => void;
      setTableCaption: (
        doc: DoclingDocument,
        tableRef: string,
        caption: string,
      ) => string;
      refIndex: (ref: string, collection: string) => number | undefined;
    };
    const doc = makeDoc();
    doc.groups = [
      {
        self_ref: '#/groups/0',
        parent: { $ref: '#/body' },
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'body',
        name: 'group',
        label: 'list',
      },
    ];
    doc.texts[0].parent = { $ref: '#/groups/0' };
    doc.texts[2].prov = [];
    doc.tables[1].prov = [];
    doc.pictures.push({
      self_ref: '#/pictures/1',
      parent: { $ref: '#/body' },
      children: [],
      content_layer: 'body',
      label: 'picture',
      prov: [],
      captions: [],
      references: [],
      footnotes: [],
      annotations: [],
      image: { uri: 'images/existing.png' },
    } as never);

    await expect(
      patcher.applyCommand(
        doc,
        makeContext(outputDir),
        {
          id: 'no-command',
          pageNo: 1,
          confidence: 1,
          disposition: 'auto_applied',
          reasons: [],
        },
        outputDir,
      ),
    ).resolves.toEqual({});
    expect(patcher.appendPicture(doc, 1, bbox, 'images/existing.png')).toBe(
      '#/pictures/1',
    );
    expect(patcher.resolveContainer(doc, '#/groups/0')).toBe(doc.groups[0]);
    expect(patcher.resolveContainer(doc, '#/missing/0')).toBeUndefined();
    expect(patcher.resolvePicture(doc, 'not-a-picture-ref')).toBeUndefined();
    expect(patcher.refIndex('#/texts/x', 'texts')).toBeUndefined();

    const bboxResult = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'splitText',
            textRef: '#/texts/2',
            parts: [{ text: 'A' }, { text: 'B' }],
          },
          {
            op: 'updateBbox',
            targetRef: '#/texts/2',
            bbox,
          },
          {
            op: 'replaceTable',
            tableRef: '#/tables/1',
            grid: [],
            caption: 'Fallback table caption',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );
    expect(bboxResult.doc.texts[2].prov[0].bbox).toEqual(bbox);
    expect(bboxResult.doc.tables[1].data.num_cols).toBe(0);
    expect(bboxResult.doc.texts[3].prov[0].bbox).toEqual({
      l: 0,
      t: 0,
      r: 1,
      b: 1,
      coord_origin: 'TOPLEFT',
    });

    const tableContext = makeContext(outputDir);
    tableContext.orphanCaptions[0].nearestMediaRefs = [
      { ref: '#/tables/0', kind: 'table', distance: 0.1 },
    ];
    const tableCaptionRefs = patcher.resolveOrphanCaptions(doc, tableContext, [
      { ref: '#/tables/0', kind: 'table', bbox },
    ]);
    expect(tableCaptionRefs).toEqual(['#/texts/1']);
    expect(doc.tables[0].captions).toEqual([{ $ref: '#/texts/1' }]);
    expect(
      patcher.resolveOrphanCaptions(doc, tableContext, [
        { ref: '#/tables/0', kind: 'table', bbox },
      ]),
    ).toEqual(['#/texts/1']);

    const missingCaptionContext = makeContext(outputDir);
    missingCaptionContext.orphanCaptions[0].ref = '#/texts/404';
    missingCaptionContext.orphanCaptions[0].nearestMediaRefs = [
      { ref: '#/tables/0', kind: 'table', distance: 0.1 },
    ];
    expect(
      patcher.resolveOrphanCaptions(doc, missingCaptionContext, [
        { ref: '#/tables/0', kind: 'table', bbox },
      ]),
    ).toEqual([]);

    patcher.insertByPagePosition(doc, '#/texts/404', 1, {
      l: 10,
      t: 90,
      r: 90,
      b: 50,
      coord_origin: 'BOTTOMLEFT',
    });
    const positionedDoc = makeDoc();
    positionedDoc.texts[2].prov = [];
    positionedDoc.body.children = [{ $ref: '#/texts/2' }];
    patcher.insertByPagePosition(positionedDoc, '#/texts/404', 99, bbox);

    const fallbackParentDoc = makeDoc();
    patcher.insertRef(
      fallbackParentDoc,
      '#/texts/404',
      undefined,
      '#/groups/404',
    );
    expect(fallbackParentDoc.body.children.at(-1)).toEqual({
      $ref: '#/texts/404',
    });

    expect(() =>
      patcher.setTableCaption(doc, '#/tables/404', 'Missing table'),
    ).toThrow('table_ref_not_found');
    expect(patcher.refIndex(`#/texts/${'9'.repeat(400)}`, 'texts')).toBe(
      undefined,
    );
    patcher.replaceRefInContainers(doc, '#/pictures/404', ['#/pictures/1']);
    expect(doc.body.children.map((child) => child.$ref)).toContain(
      '#/pictures/1',
    );
  });

  test('records skipped decisions for invalid patch targets', async () => {
    const logger = makeLogger();
    const doc = makeDoc();

    const result = await new ReviewAssistancePatcher(logger).apply(
      doc,
      [
        makePageResult([
          {
            op: 'updateTextRole',
            textRef: '#/texts/404',
            label: 'caption',
          },
          {
            op: 'mergeTexts',
            textRefs: ['#/texts/404'],
            keepRef: '#/texts/404',
            text: 'Merged',
          },
          {
            op: 'splitText',
            textRef: '#/texts/404',
            parts: [{ text: 'Split' }],
          },
          {
            op: 'updateTableCell',
            tableRef: '#/tables/404',
            row: 0,
            col: 0,
            text: 'Cell',
          },
          {
            op: 'replaceTable',
            tableRef: '#/tables/404',
            grid: [[{ text: 'A' }]],
          },
          {
            op: 'splitPicture',
            pictureRef: '#/pictures/404',
            regions: [
              {
                bbox,
              },
            ],
          },
          {
            op: 'updateBbox',
            targetRef: '#/texts/404',
            bbox,
          },
          {
            op: 'moveNode',
            sourceRef: '#/texts/404',
            targetRef: '#/texts/0',
            position: 'before',
          },
          {
            op: 'updatePictureCaption',
            pictureRef: '#/pictures/404',
            caption: 'Missing picture',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(
      result.pages[0].decisions.map((decision) => decision.reasons),
    ).toEqual([
      ['test', 'patch_skipped: text_ref_not_found'],
      ['test', 'patch_skipped: merge_keep_ref_not_found'],
      ['test', 'patch_skipped: split_text_ref_not_found'],
      ['test', 'patch_skipped: table_ref_not_found'],
      ['test', 'patch_skipped: table_ref_not_found'],
      ['test', 'patch_skipped: picture_ref_not_found'],
      ['test', 'patch_skipped: bbox_target_ref_not_found'],
      ['test', 'patch_skipped: move_ref_not_found'],
      ['test', 'patch_skipped: picture_ref_not_found'],
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(9);
  });

  test('handles sparse table cells and dangling caption refs', async () => {
    const doc = makeDoc();
    doc.pictures[0].captions = [{ $ref: '#/texts/404' }];
    doc.tables[0].captions = [{ $ref: '#/texts/404' }];

    const result = await new ReviewAssistancePatcher(makeLogger()).apply(
      doc,
      [
        makePageResult([
          {
            op: 'updateTableCell',
            tableRef: '#/tables/0',
            row: 3,
            col: 3,
            text: 'Out of grid',
          },
          {
            op: 'updatePictureCaption',
            pictureRef: '#/pictures/0',
            caption: 'Recovered picture caption',
          },
          {
            op: 'replaceTable',
            tableRef: '#/tables/0',
            grid: [[{ text: 'A' }]],
            caption: 'Recovered table caption',
          },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.doc.tables[0].data.grid[0][0].text).toBe('A');
    expect(result.doc.pictures[0].captions).toEqual([
      { $ref: '#/texts/404' },
      { $ref: '#/texts/3' },
    ]);
    expect(result.doc.tables[0].captions).toEqual([
      { $ref: '#/texts/404' },
      { $ref: '#/texts/4' },
    ]);
    expect(result.doc.texts[3].text).toBe('Recovered picture caption');
    expect(result.doc.texts[4].text).toBe('Recovered table caption');
  });

  test('records non-Error patch failures', async () => {
    const patcher = new ReviewAssistancePatcher(makeLogger()) as unknown as {
      apply: ReviewAssistancePatcher['apply'];
      applyCommand: unknown;
    };
    patcher.applyCommand = vi.fn().mockRejectedValue('string failure');

    const result = await patcher.apply(
      makeDoc(),
      [
        makePageResult([
          { op: 'replaceText', textRef: '#/texts/0', text: 'x' },
        ]),
      ],
      { outputDir, contexts: [makeContext(outputDir)] },
    );

    expect(result.pages[0].decisions[0]).toMatchObject({
      disposition: 'skipped',
      reasons: ['test', 'patch_skipped: string failure'],
    });
  });
});
