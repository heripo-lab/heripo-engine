import { beforeEach, describe, expect, test } from 'vitest';

import { IdGenerator } from './id-generator';

describe('IdGenerator', () => {
  let generator: IdGenerator;

  beforeEach(() => {
    generator = new IdGenerator();
  });

  describe('generateChapterId', () => {
    test('should generate chapter IDs with correct format', () => {
      expect(generator.generateChapterId()).toBe('ch-001');
      expect(generator.generateChapterId()).toBe('ch-002');
      expect(generator.generateChapterId()).toBe('ch-003');
    });

    test('should pad single digits with zeros', () => {
      const id = generator.generateChapterId();
      expect(id).toBe('ch-001');
      expect(id).toHaveLength(6);
    });

    test('should pad double digits with zeros', () => {
      // Generate 10 IDs to get to double digits
      for (let i = 0; i < 9; i++) {
        generator.generateChapterId();
      }
      expect(generator.generateChapterId()).toBe('ch-010');
    });

    test('should handle triple digits', () => {
      // Generate 100 IDs to get to triple digits
      for (let i = 0; i < 99; i++) {
        generator.generateChapterId();
      }
      expect(generator.generateChapterId()).toBe('ch-100');
    });

    test('should handle numbers larger than 999', () => {
      // Generate 1000 IDs
      for (let i = 0; i < 999; i++) {
        generator.generateChapterId();
      }
      expect(generator.generateChapterId()).toBe('ch-1000');
    });

    test('should increment independently from other types', () => {
      generator.generateImageId();
      generator.generateTableId();
      expect(generator.generateChapterId()).toBe('ch-001');
      expect(generator.generateChapterId()).toBe('ch-002');
    });
  });

  describe('generateImageId', () => {
    test('should generate image IDs with correct format', () => {
      expect(generator.generateImageId()).toBe('img-001');
      expect(generator.generateImageId()).toBe('img-002');
      expect(generator.generateImageId()).toBe('img-003');
    });

    test('should pad single digits with zeros', () => {
      const id = generator.generateImageId();
      expect(id).toBe('img-001');
      expect(id).toHaveLength(7);
    });

    test('should pad double digits with zeros', () => {
      for (let i = 0; i < 9; i++) {
        generator.generateImageId();
      }
      expect(generator.generateImageId()).toBe('img-010');
    });

    test('should handle triple digits', () => {
      for (let i = 0; i < 99; i++) {
        generator.generateImageId();
      }
      expect(generator.generateImageId()).toBe('img-100');
    });

    test('should handle numbers larger than 999', () => {
      for (let i = 0; i < 999; i++) {
        generator.generateImageId();
      }
      expect(generator.generateImageId()).toBe('img-1000');
    });

    test('should increment independently from other types', () => {
      generator.generateChapterId();
      generator.generateTableId();
      expect(generator.generateImageId()).toBe('img-001');
      expect(generator.generateImageId()).toBe('img-002');
    });
  });

  describe('generateTableId', () => {
    test('should generate table IDs with correct format', () => {
      expect(generator.generateTableId()).toBe('tbl-001');
      expect(generator.generateTableId()).toBe('tbl-002');
      expect(generator.generateTableId()).toBe('tbl-003');
    });

    test('should pad single digits with zeros', () => {
      const id = generator.generateTableId();
      expect(id).toBe('tbl-001');
      expect(id).toHaveLength(7);
    });

    test('should pad double digits with zeros', () => {
      for (let i = 0; i < 9; i++) {
        generator.generateTableId();
      }
      expect(generator.generateTableId()).toBe('tbl-010');
    });

    test('should handle triple digits', () => {
      for (let i = 0; i < 99; i++) {
        generator.generateTableId();
      }
      expect(generator.generateTableId()).toBe('tbl-100');
    });

    test('should handle numbers larger than 999', () => {
      for (let i = 0; i < 999; i++) {
        generator.generateTableId();
      }
      expect(generator.generateTableId()).toBe('tbl-1000');
    });

    test('should increment independently from other types', () => {
      generator.generateChapterId();
      generator.generateImageId();
      expect(generator.generateTableId()).toBe('tbl-001');
      expect(generator.generateTableId()).toBe('tbl-002');
    });
  });

  describe('generateFootnoteId', () => {
    test('should generate footnote IDs with correct format', () => {
      expect(generator.generateFootnoteId()).toBe('ftn-001');
      expect(generator.generateFootnoteId()).toBe('ftn-002');
      expect(generator.generateFootnoteId()).toBe('ftn-003');
    });

    test('should pad single digits with zeros', () => {
      const id = generator.generateFootnoteId();
      expect(id).toBe('ftn-001');
      expect(id).toHaveLength(7);
    });

    test('should pad double digits with zeros', () => {
      for (let i = 0; i < 9; i++) {
        generator.generateFootnoteId();
      }
      expect(generator.generateFootnoteId()).toBe('ftn-010');
    });

    test('should handle triple digits', () => {
      for (let i = 0; i < 99; i++) {
        generator.generateFootnoteId();
      }
      expect(generator.generateFootnoteId()).toBe('ftn-100');
    });

    test('should handle numbers larger than 999', () => {
      for (let i = 0; i < 999; i++) {
        generator.generateFootnoteId();
      }
      expect(generator.generateFootnoteId()).toBe('ftn-1000');
    });

    test('should increment independently from other types', () => {
      generator.generateChapterId();
      generator.generateImageId();
      generator.generateTableId();
      expect(generator.generateFootnoteId()).toBe('ftn-001');
      expect(generator.generateFootnoteId()).toBe('ftn-002');
    });
  });

  describe('reset', () => {
    test('should reset all counters to zero', () => {
      generator.generateChapterId();
      generator.generateImageId();
      generator.generateTableId();
      generator.generateFootnoteId();

      generator.reset();

      expect(generator.generateChapterId()).toBe('ch-001');
      expect(generator.generateImageId()).toBe('img-001');
      expect(generator.generateTableId()).toBe('tbl-001');
      expect(generator.generateFootnoteId()).toBe('ftn-001');
    });

    test('should reset counters after multiple generations', () => {
      for (let i = 0; i < 10; i++) {
        generator.generateChapterId();
        generator.generateImageId();
        generator.generateTableId();
        generator.generateFootnoteId();
      }

      generator.reset();

      expect(generator.generateChapterId()).toBe('ch-001');
      expect(generator.generateImageId()).toBe('img-001');
      expect(generator.generateTableId()).toBe('tbl-001');
      expect(generator.generateFootnoteId()).toBe('ftn-001');
    });

    test('should allow generating IDs after reset', () => {
      generator.generateChapterId();
      generator.reset();

      expect(generator.generateChapterId()).toBe('ch-001');
      expect(generator.generateChapterId()).toBe('ch-002');
    });
  });

  describe('getCounters', () => {
    test('should return initial counter values', () => {
      const counters = generator.getCounters();
      expect(counters).toEqual({ chapter: 0, image: 0, table: 0, footnote: 0 });
    });

    test('should return current counter values after generation', () => {
      generator.generateChapterId();
      generator.generateChapterId();
      generator.generateImageId();
      generator.generateTableId();
      generator.generateTableId();
      generator.generateTableId();
      generator.generateFootnoteId();
      generator.generateFootnoteId();

      const counters = generator.getCounters();
      expect(counters).toEqual({ chapter: 2, image: 1, table: 3, footnote: 2 });
    });

    test('should return zero counters after reset', () => {
      generator.generateChapterId();
      generator.generateImageId();
      generator.generateTableId();
      generator.generateFootnoteId();
      generator.reset();

      const counters = generator.getCounters();
      expect(counters).toEqual({ chapter: 0, image: 0, table: 0, footnote: 0 });
    });

    test('should not modify counters when getting values', () => {
      generator.generateChapterId();
      const counters1 = generator.getCounters();
      const counters2 = generator.getCounters();

      expect(counters1).toEqual(counters2);
      expect(counters1).toEqual({
        chapter: 1,
        image: 0,
        table: 0,
        footnote: 0,
      });
    });
  });

  describe('independent counters', () => {
    test('should maintain separate counters for each type', () => {
      generator.generateChapterId();
      generator.generateImageId();
      generator.generateImageId();
      generator.generateTableId();
      generator.generateTableId();
      generator.generateTableId();
      generator.generateFootnoteId();
      generator.generateChapterId();

      expect(generator.getCounters()).toEqual({
        chapter: 2,
        image: 2,
        table: 3,
        footnote: 1,
      });
    });

    test('should generate IDs independently in mixed order', () => {
      const ids: string[] = [];

      ids.push(generator.generateChapterId()); // ch-001
      ids.push(generator.generateImageId()); // img-001
      ids.push(generator.generateTableId()); // tbl-001
      ids.push(generator.generateFootnoteId()); // ftn-001
      ids.push(generator.generateChapterId()); // ch-002
      ids.push(generator.generateImageId()); // img-002
      ids.push(generator.generateChapterId()); // ch-003

      expect(ids).toEqual([
        'ch-001',
        'img-001',
        'tbl-001',
        'ftn-001',
        'ch-002',
        'img-002',
        'ch-003',
      ]);
    });
  });

  describe('edge cases', () => {
    test('should handle rapid sequential generation', () => {
      const chapterIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        chapterIds.push(generator.generateChapterId());
      }

      expect(chapterIds[0]).toBe('ch-001');
      expect(chapterIds[99]).toBe('ch-100');
      expect(new Set(chapterIds).size).toBe(100); // All unique
    });

    test('should handle zero-padded numbers correctly', () => {
      // Test boundary cases for padding
      expect(generator.generateChapterId()).toBe('ch-001'); // 1 digit

      for (let i = 0; i < 8; i++) {
        generator.generateChapterId();
      }
      expect(generator.generateChapterId()).toBe('ch-010'); // 2 digits

      for (let i = 0; i < 89; i++) {
        generator.generateChapterId();
      }
      expect(generator.generateChapterId()).toBe('ch-100'); // 3 digits
    });

    test('should create new instance with fresh counters', () => {
      generator.generateChapterId();
      generator.generateImageId();
      generator.generateTableId();
      generator.generateFootnoteId();

      const newGenerator = new IdGenerator();
      expect(newGenerator.generateChapterId()).toBe('ch-001');
      expect(newGenerator.generateImageId()).toBe('img-001');
      expect(newGenerator.generateTableId()).toBe('tbl-001');
      expect(newGenerator.generateFootnoteId()).toBe('ftn-001');
    });
  });
});
