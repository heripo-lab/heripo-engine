import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingGroupItem,
  DoclingPictureItem,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { RefResolver } from './ref-resolver';

describe('RefResolver', () => {
  let mockLogger: LoggerMethods;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });
  // Test fixtures
  const createMockTextItem = (index: number): DoclingTextItem => ({
    self_ref: `#/texts/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: 'text',
    prov: [
      {
        page_no: 1,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
        charspan: [0, 10],
      },
    ],
    orig: `Original text ${index}`,
    text: `Text ${index}`,
  });

  const createMockPictureItem = (index: number): DoclingPictureItem => ({
    self_ref: `#/pictures/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: 'picture',
    prov: [
      {
        page_no: 1,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
        charspan: [0, 0],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    annotations: [],
  });

  const createMockTableItem = (index: number): DoclingTableItem => ({
    self_ref: `#/tables/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: 'table',
    prov: [
      {
        page_no: 1,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
        charspan: [0, 0],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    data: {
      table_cells: [],
      num_rows: 0,
      num_cols: 0,
      grid: [],
    },
  });

  const createMockGroupItem = (index: number): DoclingGroupItem => ({
    self_ref: `#/groups/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    name: 'group',
    label: 'key_value_area',
  });

  const createMockDocument = (): DoclingDocument => ({
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'test-doc',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 123456,
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
    groups: [createMockGroupItem(0), createMockGroupItem(1)],
    texts: [
      createMockTextItem(0),
      createMockTextItem(1),
      createMockTextItem(2),
    ],
    pictures: [createMockPictureItem(0)],
    tables: [createMockTableItem(0), createMockTableItem(1)],
    pages: {},
  });

  describe('constructor', () => {
    test('should build indices for all collections', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      // Verify all items are indexed by attempting to resolve them
      expect(resolver.resolveText('#/texts/0')).toBeTruthy();
      expect(resolver.resolveText('#/texts/1')).toBeTruthy();
      expect(resolver.resolveText('#/texts/2')).toBeTruthy();
      expect(resolver.resolvePicture('#/pictures/0')).toBeTruthy();
      expect(resolver.resolveTable('#/tables/0')).toBeTruthy();
      expect(resolver.resolveTable('#/tables/1')).toBeTruthy();
      expect(resolver.resolveGroup('#/groups/0')).toBeTruthy();
      expect(resolver.resolveGroup('#/groups/1')).toBeTruthy();
    });

    test('should handle empty collections', () => {
      const emptyDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0',
        name: 'empty-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 0,
          filename: 'empty.pdf',
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
        texts: [],
        pictures: [],
        tables: [],
        pages: {},
      };

      const resolver = new RefResolver(mockLogger, emptyDoc);

      expect(resolver.resolveText('#/texts/0')).toBeNull();
      expect(resolver.resolvePicture('#/pictures/0')).toBeNull();
      expect(resolver.resolveTable('#/tables/0')).toBeNull();
      expect(resolver.resolveGroup('#/groups/0')).toBeNull();
    });
  });

  describe('resolve', () => {
    test('should resolve text reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolve('#/texts/1');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/texts/1');
      expect((result as DoclingTextItem).text).toBe('Text 1');
    });

    test('should resolve picture reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolve('#/pictures/0');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/pictures/0');
      expect((result as DoclingPictureItem).label).toBe('picture');
    });

    test('should resolve table reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolve('#/tables/0');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/tables/0');
      expect((result as DoclingTableItem).label).toBe('table');
    });

    test('should resolve group reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolve('#/groups/0');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/groups/0');
      expect((result as DoclingGroupItem).name).toBe('group');
    });

    test('should return null for non-existent reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolve('#/texts/999')).toBeNull();
      expect(resolver.resolve('#/pictures/999')).toBeNull();
      expect(resolver.resolve('#/tables/999')).toBeNull();
      expect(resolver.resolve('#/groups/999')).toBeNull();
    });

    test('should return null for invalid reference format', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolve('invalid')).toBeNull();
      expect(resolver.resolve('#/invalid/0')).toBeNull();
      expect(resolver.resolve('texts/0')).toBeNull();
      expect(resolver.resolve('#texts/0')).toBeNull();
      expect(resolver.resolve('')).toBeNull();
    });

    test('should return null for unknown collection type', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolve('#/unknown/0')).toBeNull();
    });
  });

  describe('resolveText', () => {
    test('should resolve existing text reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolveText('#/texts/0');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/texts/0');
      expect(result?.text).toBe('Text 0');
    });

    test('should return null for non-existent text reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolveText('#/texts/999')).toBeNull();
    });

    test('should return null for wrong collection type', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolveText('#/pictures/0')).toBeNull();
    });
  });

  describe('resolvePicture', () => {
    test('should resolve existing picture reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolvePicture('#/pictures/0');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/pictures/0');
      expect(result?.label).toBe('picture');
    });

    test('should return null for non-existent picture reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolvePicture('#/pictures/999')).toBeNull();
    });

    test('should return null for wrong collection type', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolvePicture('#/texts/0')).toBeNull();
    });
  });

  describe('resolveTable', () => {
    test('should resolve existing table reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolveTable('#/tables/1');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/tables/1');
      expect(result?.label).toBe('table');
    });

    test('should return null for non-existent table reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolveTable('#/tables/999')).toBeNull();
    });

    test('should return null for wrong collection type', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolveTable('#/groups/0')).toBeNull();
    });
  });

  describe('resolveGroup', () => {
    test('should resolve existing group reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const result = resolver.resolveGroup('#/groups/0');
      expect(result).toBeTruthy();
      expect(result?.self_ref).toBe('#/groups/0');
      expect(result?.name).toBe('group');
    });

    test('should return null for non-existent group reference', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolveGroup('#/groups/999')).toBeNull();
    });

    test('should return null for wrong collection type', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      expect(resolver.resolveGroup('#/tables/0')).toBeNull();
    });
  });

  describe('resolveMany', () => {
    test('should resolve multiple references', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const refs = [
        { $ref: '#/texts/0' },
        { $ref: '#/pictures/0' },
        { $ref: '#/tables/0' },
      ];
      const results = resolver.resolveMany(refs);

      expect(results).toHaveLength(3);
      expect(results[0]?.self_ref).toBe('#/texts/0');
      expect(results[1]?.self_ref).toBe('#/pictures/0');
      expect(results[2]?.self_ref).toBe('#/tables/0');
    });

    test('should handle mix of valid and invalid references', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const refs = [
        { $ref: '#/texts/0' },
        { $ref: '#/texts/999' },
        { $ref: '#/pictures/0' },
      ];
      const results = resolver.resolveMany(refs);

      expect(results).toHaveLength(3);
      expect(results[0]?.self_ref).toBe('#/texts/0');
      expect(results[1]).toBeNull();
      expect(results[2]?.self_ref).toBe('#/pictures/0');
    });

    test('should handle empty array', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const results = resolver.resolveMany([]);
      expect(results).toEqual([]);
    });

    test('should handle all invalid references', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      const refs = [
        { $ref: 'invalid' },
        { $ref: '#/unknown/0' },
        { $ref: '#/texts/999' },
      ];
      const results = resolver.resolveMany(refs);

      expect(results).toHaveLength(3);
      expect(results[0]).toBeNull();
      expect(results[1]).toBeNull();
      expect(results[2]).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle documents with large number of items', () => {
      const largeDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0',
        name: 'large-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 0,
          filename: 'large.pdf',
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
        texts: Array.from({ length: 1000 }, (_, i) => createMockTextItem(i)),
        pictures: [],
        tables: [],
        pages: {},
      };

      const resolver = new RefResolver(mockLogger, largeDoc);

      expect(resolver.resolveText('#/texts/0')).toBeTruthy();
      expect(resolver.resolveText('#/texts/500')).toBeTruthy();
      expect(resolver.resolveText('#/texts/999')).toBeTruthy();
      expect(resolver.resolveText('#/texts/1000')).toBeNull();
    });

    test('should handle special characters in reference strings', () => {
      const doc = createMockDocument();
      const resolver = new RefResolver(mockLogger, doc);

      // These should all return null as they don't match the expected format
      expect(resolver.resolve('#/texts/0#extra')).toBeNull();
      expect(resolver.resolve('#/texts/0?query')).toBeNull();
      expect(resolver.resolve('#/texts/0/nested')).toBeNull();
    });
  });
});
