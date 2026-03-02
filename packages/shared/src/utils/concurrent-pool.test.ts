import { describe, expect, test, vi } from 'vitest';

import { ConcurrentPool } from './concurrent-pool';

describe('ConcurrentPool', () => {
  describe('run', () => {
    test('processes all items and returns results in order', async () => {
      const items = [1, 2, 3, 4, 5];

      const results = await ConcurrentPool.run(
        items,
        3,
        async (item) => item * 10,
      );

      expect(results).toEqual([10, 20, 30, 40, 50]);
    });

    test('returns empty array for empty input', async () => {
      const results = await ConcurrentPool.run(
        [],
        5,
        async (item: number) => item,
      );

      expect(results).toEqual([]);
    });

    test('does not exceed concurrency limit', async () => {
      let activeTasks = 0;
      let maxConcurrent = 0;
      const concurrency = 3;

      const items = Array.from({ length: 10 }, (_, i) => i);

      await ConcurrentPool.run(items, concurrency, async (item) => {
        activeTasks++;
        maxConcurrent = Math.max(maxConcurrent, activeTasks);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeTasks--;
        return item;
      });

      expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
      expect(maxConcurrent).toBe(concurrency);
    });

    test('handles items fewer than concurrency', async () => {
      const items = [1, 2];
      const concurrency = 10;

      const results = await ConcurrentPool.run(
        items,
        concurrency,
        async (item) => item * 2,
      );

      expect(results).toEqual([2, 4]);
    });

    test('calls onItemComplete callback for each completed item', async () => {
      const items = ['a', 'b', 'c'];
      const onItemComplete = vi.fn();

      await ConcurrentPool.run(
        items,
        2,
        async (item) => item.toUpperCase(),
        onItemComplete,
      );

      expect(onItemComplete).toHaveBeenCalledTimes(3);
      expect(onItemComplete).toHaveBeenCalledWith('A', 0);
      expect(onItemComplete).toHaveBeenCalledWith('B', 1);
      expect(onItemComplete).toHaveBeenCalledWith('C', 2);
    });

    test('works without onItemComplete callback', async () => {
      const results = await ConcurrentPool.run(
        [1, 2, 3],
        2,
        async (item) => item + 1,
      );

      expect(results).toEqual([2, 3, 4]);
    });

    test('passes correct index to processFn', async () => {
      const indices: number[] = [];

      await ConcurrentPool.run([10, 20, 30], 2, async (_item, index) => {
        indices.push(index);
        return index;
      });

      expect(indices).toContain(0);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
    });

    test('propagates errors from processFn', async () => {
      await expect(
        ConcurrentPool.run([1, 2, 3], 2, async (item) => {
          if (item === 2) throw new Error('Processing failed');
          return item;
        }),
      ).rejects.toThrow('Processing failed');
    });

    test('maintains result order even with varying processing times', async () => {
      const items = [3, 1, 2];
      // Items take different amounts of time (item value * 10ms)
      const results = await ConcurrentPool.run(items, 3, async (item) => {
        await new Promise((resolve) => setTimeout(resolve, item * 10));
        return `result-${item}`;
      });

      // Results should match input order, not completion order
      expect(results).toEqual(['result-3', 'result-1', 'result-2']);
    });

    test('processes with concurrency of 1 (sequential)', async () => {
      const order: number[] = [];

      await ConcurrentPool.run([1, 2, 3], 1, async (item) => {
        order.push(item);
        return item;
      });

      expect(order).toEqual([1, 2, 3]);
    });
  });
});
