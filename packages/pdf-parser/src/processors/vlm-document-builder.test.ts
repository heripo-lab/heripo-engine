import type { DoclingDocument } from '@heripo/model';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { VlmDocumentBuilder } from './vlm-document-builder';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** Helper to create a minimal DoclingDocument for testing */
function createTestDoc(
  pageCount: number,
  pictureCount: number = 0,
): DoclingDocument {
  const pages: Record<string, any> = {};
  for (let i = 1; i <= pageCount; i++) {
    pages[String(i)] = {
      page_no: i,
      size: { width: 1000, height: 1400 },
      image: {
        mimetype: 'image/png',
        dpi: 300,
        size: { width: 1000, height: 1400 },
        uri: '', // Empty, to be filled by builder
      },
    };
  }

  const pictures = Array.from({ length: pictureCount }, (_, i) => ({
    self_ref: `#/pictures/${i}`,
    children: [],
    content_layer: 'body',
    label: 'picture',
    prov: [
      {
        page_no: 1,
        bbox: { l: 0, t: 0, r: 0, b: 0, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, 0] as [number, number],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    annotations: [],
  }));

  return {
    schema_name: 'DoclingDocument',
    version: '1.0.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 0,
      filename: 'test.pdf',
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
      children: [],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts: [
      {
        self_ref: '#/texts/0',
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [],
        orig: 'test text',
        text: 'test text',
      },
    ],
    pictures,
    tables: [],
    pages,
  };
}

describe('VlmDocumentBuilder', () => {
  let builder: VlmDocumentBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new VlmDocumentBuilder(mockLogger);
  });

  describe('build', () => {
    test('maps page image URIs for all pages', () => {
      const doc = createTestDoc(3);

      const result = builder.build(
        doc,
        [
          '/tmp/pages/page_0.png',
          '/tmp/pages/page_1.png',
          '/tmp/pages/page_2.png',
        ],
        [],
      );

      expect(result.pages['1'].image.uri).toBe('pages/page_0.png');
      expect(result.pages['2'].image.uri).toBe('pages/page_1.png');
      expect(result.pages['3'].image.uri).toBe('pages/page_2.png');
    });

    test('uses basename of page file paths', () => {
      const doc = createTestDoc(1);

      const result = builder.build(
        doc,
        ['/very/deep/nested/path/pages/page_0.png'],
        [],
      );

      expect(result.pages['1'].image.uri).toBe('pages/page_0.png');
    });

    test('returns the same document reference (mutated)', () => {
      const doc = createTestDoc(1);

      const result = builder.build(doc, ['/tmp/pages/page_0.png'], []);

      expect(result).toBe(doc);
    });

    test('handles empty page files array', () => {
      const doc = createTestDoc(0);

      const result = builder.build(doc, [], []);

      expect(Object.keys(result.pages)).toHaveLength(0);
    });

    test('skips pages not found in document', () => {
      // Document has 1 page but we provide 3 page files
      const doc = createTestDoc(1);

      const result = builder.build(
        doc,
        ['/tmp/page_0.png', '/tmp/page_1.png', '/tmp/page_2.png'],
        [],
      );

      expect(result.pages['1'].image.uri).toBe('pages/page_0.png');
      // Pages 2 and 3 don't exist in doc, so they're skipped
      expect(result.pages['2']).toBeUndefined();
    });

    test('logs mapped page count', () => {
      const doc = createTestDoc(2);

      builder.build(
        doc,
        ['/tmp/pages/page_0.png', '/tmp/pages/page_1.png'],
        [],
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmDocumentBuilder] Mapped 2 page images',
      );
    });

    test('logs picture image count when images exist', () => {
      const doc = createTestDoc(1, 2);

      builder.build(
        doc,
        ['/tmp/pages/page_0.png'],
        ['images/image_0.png', 'images/image_1.png'],
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmDocumentBuilder] Mapped 2 picture images',
      );
    });

    test('does not log picture mapping when no images', () => {
      const doc = createTestDoc(1);

      builder.build(doc, ['/tmp/pages/page_0.png'], []);

      const pictureMapCalls = mockLogger.info.mock.calls.filter(
        (call: string[]) => call[0].includes('picture images'),
      );
      expect(pictureMapCalls).toHaveLength(0);
    });

    test('warns when picture count does not match image files', () => {
      const doc = createTestDoc(1, 3);

      builder.build(
        doc,
        ['/tmp/pages/page_0.png'],
        ['images/image_0.png', 'images/image_1.png'],
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[VlmDocumentBuilder] Picture count mismatch: 3 in document, 2 image files',
      );
    });

    test('does not warn when picture count matches image files', () => {
      const doc = createTestDoc(1, 2);

      builder.build(
        doc,
        ['/tmp/pages/page_0.png'],
        ['images/image_0.png', 'images/image_1.png'],
      );

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('logs document summary', () => {
      const doc = createTestDoc(2, 1);

      builder.build(
        doc,
        ['/tmp/pages/page_0.png', '/tmp/pages/page_1.png'],
        ['images/image_0.png'],
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmDocumentBuilder] Document built: 2 pages, 1 texts, 1 pictures, 0 tables',
      );
    });

    test('preserves existing document structure', () => {
      const doc = createTestDoc(1);

      const result = builder.build(doc, ['/tmp/pages/page_0.png'], []);

      expect(result.schema_name).toBe('DoclingDocument');
      expect(result.version).toBe('1.0.0');
      expect(result.name).toBe('test');
      expect(result.origin.filename).toBe('test.pdf');
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0].text).toBe('test text');
      expect(result.body.self_ref).toBe('#/body');
      expect(result.furniture.self_ref).toBe('#/furniture');
    });

    test('preserves page metadata while filling URI', () => {
      const doc = createTestDoc(1);

      const result = builder.build(doc, ['/tmp/pages/page_0.png'], []);

      const page = result.pages['1'];
      expect(page.page_no).toBe(1);
      expect(page.size).toEqual({ width: 1000, height: 1400 });
      expect(page.image.mimetype).toBe('image/png');
      expect(page.image.dpi).toBe(300);
      expect(page.image.size).toEqual({ width: 1000, height: 1400 });
      expect(page.image.uri).toBe('pages/page_0.png');
    });
  });
});
