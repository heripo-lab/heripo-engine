/**
 * BatchProcessor - Batch processing utility
 *
 * Provides functionality to split large arrays into batches for parallel processing.
 */
export class BatchProcessor {
  /**
   * Splits an array into batches of specified size.
   *
   * @param items - Array to split
   * @param batchSize - Size of each batch
   * @returns Array of batches
   *
   * @example
   * ```typescript
   * const items = [1, 2, 3, 4, 5];
   * const batches = BatchProcessor.createBatches(items, 2);
   * // [[1, 2], [3, 4], [5]]
   * ```
   */
  static createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Splits an array into batches and executes async function in parallel.
   *
   * @param items - Array to process
   * @param batchSize - Size of each batch
   * @param processFn - Async function to process each batch
   * @returns Flattened array of processed results
   *
   * @example
   * ```typescript
   * const texts = ['a', 'b', 'c', 'd', 'e'];
   * const results = await BatchProcessor.processBatch(
   *   texts,
   *   2,
   *   async (batch) => {
   *     return batch.map(t => t.toUpperCase());
   *   }
   * );
   * // ['A', 'B', 'C', 'D', 'E']
   * ```
   */
  static async processBatch<T, R>(
    items: T[],
    batchSize: number,
    processFn: (batch: T[]) => Promise<R[]>,
  ): Promise<R[]> {
    const batches = this.createBatches(items, batchSize);
    const results = await Promise.all(batches.map((batch) => processFn(batch)));
    return results.flat();
  }

  /**
   * Splits an array into batches and executes sync function in parallel.
   *
   * @param items - Array to process
   * @param batchSize - Size of each batch
   * @param processFn - Sync function to process each batch
   * @returns Flattened array of processed results
   *
   * @example
   * ```typescript
   * const numbers = [1, 2, 3, 4, 5];
   * const results = BatchProcessor.processBatchSync(
   *   numbers,
   *   2,
   *   (batch) => batch.map(n => n * 2)
   * );
   * // [2, 4, 6, 8, 10]
   * ```
   */
  static processBatchSync<T, R>(
    items: T[],
    batchSize: number,
    processFn: (batch: T[]) => R[],
  ): R[] {
    const batches = this.createBatches(items, batchSize);
    const results = batches.map((batch) => processFn(batch));
    return results.flat();
  }
}
