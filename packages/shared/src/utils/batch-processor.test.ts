import { describe, expect, test } from 'vitest';

import { BatchProcessor } from './batch-processor';

describe('BatchProcessor', () => {
  describe('createBatches', () => {
    test('accurate batch splitting', () => {
      const items = Array.from({ length: 15 }, (_, i) => i);
      const batches = BatchProcessor.createBatches(items, 5);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toEqual([0, 1, 2, 3, 4]);
      expect(batches[1]).toEqual([5, 6, 7, 8, 9]);
      expect(batches[2]).toEqual([10, 11, 12, 13, 14]);
    });

    test('items smaller than batch size', () => {
      const items = Array.from({ length: 5 }, (_, i) => i);
      const batches = BatchProcessor.createBatches(items, 10);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual([0, 1, 2, 3, 4]);
    });

    test('items exactly equal to batch size', () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const batches = BatchProcessor.createBatches(items, 5);

      expect(batches).toHaveLength(2);
      expect(batches[0]).toEqual([0, 1, 2, 3, 4]);
      expect(batches[1]).toEqual([5, 6, 7, 8, 9]);
    });

    test('empty array', () => {
      const batches = BatchProcessor.createBatches([], 5);

      expect(batches).toHaveLength(0);
    });

    test('batch size of 1', () => {
      const items = ['a', 'b', 'c'];
      const batches = BatchProcessor.createBatches(items, 1);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toEqual(['a']);
      expect(batches[1]).toEqual(['b']);
      expect(batches[2]).toEqual(['c']);
    });

    test('large batch size', () => {
      const items = Array.from({ length: 5 }, (_, i) => i);
      const batches = BatchProcessor.createBatches(items, 1000);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('processBatch', () => {
    test('async batch processing', async () => {
      const texts = ['a', 'b', 'c', 'd', 'e'];
      const result = await BatchProcessor.processBatch(
        texts,
        2,
        async (batch) => {
          return batch.map((t) => t.toUpperCase());
        },
      );

      expect(result).toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    test('process empty array', async () => {
      const result = await BatchProcessor.processBatch(
        [],
        2,
        async (batch) => batch,
      );

      expect(result).toEqual([]);
    });

    test('split and process multiple batches', async () => {
      const numbers = [1, 2, 3, 4, 5, 6];
      const result = await BatchProcessor.processBatch(
        numbers,
        2,
        async (batch) => {
          return batch.map((n) => n * 2);
        },
      );

      expect(result).toEqual([2, 4, 6, 8, 10, 12]);
    });

    test('process with batch size of 1', async () => {
      const items = ['x', 'y', 'z'];
      const result = await BatchProcessor.processBatch(
        items,
        1,
        async (batch) => {
          return batch.map((item) => `[${item}]`);
        },
      );

      expect(result).toEqual(['[x]', '[y]', '[z]']);
    });

    test('async operation error handling', async () => {
      const items = [1, 2, 3];
      const promise = BatchProcessor.processBatch(items, 2, async () => {
        throw new Error('processing error');
      });

      await expect(promise).rejects.toThrow('processing error');
    });

    test('complex object batch processing', async () => {
      interface Item {
        id: number;
        name: string;
      }

      const items: Item[] = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 3, name: 'c' },
      ];

      const result = await BatchProcessor.processBatch(
        items,
        2,
        async (batch) => {
          return batch.map((item) => ({
            ...item,
            name: item.name.toUpperCase(),
          }));
        },
      );

      expect(result).toEqual([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
      ]);
    });
  });

  describe('processBatchSync', () => {
    test('sync batch processing', () => {
      const numbers = [1, 2, 3, 4, 5];
      const result = BatchProcessor.processBatchSync(numbers, 2, (batch) => {
        return batch.map((n) => n * 2);
      });

      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    test('process empty array', () => {
      const result = BatchProcessor.processBatchSync([], 2, (batch) => batch);

      expect(result).toEqual([]);
    });

    test('split and process multiple batches', () => {
      const texts = ['a', 'b', 'c', 'd', 'e', 'f'];
      const result = BatchProcessor.processBatchSync(texts, 2, (batch) => {
        return batch.map((t) => t.toUpperCase());
      });

      expect(result).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    });

    test('process with batch size of 1', () => {
      const items = [10, 20, 30];
      const result = BatchProcessor.processBatchSync(items, 1, (batch) => {
        return batch.map((n) => n / 10);
      });

      expect(result).toEqual([1, 2, 3]);
    });

    test('complex transformation', () => {
      interface User {
        id: number;
        name: string;
      }

      const users: User[] = [
        { id: 1, name: 'alice' },
        { id: 2, name: 'bob' },
        { id: 3, name: 'charlie' },
        { id: 4, name: 'diana' },
      ];

      const result = BatchProcessor.processBatchSync(users, 2, (batch) => {
        return batch
          .filter((user) => user.id % 2 === 0) // even IDs only
          .map((user) => ({
            ...user,
            name: user.name.toUpperCase(),
          }));
      });

      expect(result).toEqual([
        { id: 2, name: 'BOB' },
        { id: 4, name: 'DIANA' },
      ]);
    });
  });

  describe('integration tests', () => {
    test('combine createBatches and processBatchSync', () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const batches = BatchProcessor.createBatches(items, 3);

      const results = batches.map((batch) => {
        return batch.map((n) => n * 2);
      });

      const flattened = results.flat();
      expect(flattened).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    });

    test('process large array', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      const result = await BatchProcessor.processBatch(
        largeArray,
        100,
        async (batch) => {
          return batch.map((n) => n + 1);
        },
      );

      expect(result).toHaveLength(1000);
      expect(result[0]).toBe(1);
      expect(result[999]).toBe(1000);
    });
  });
});
