/**
 * ConcurrentPool - Worker pool utility for concurrent task execution.
 *
 * Unlike batch processing where all items in a batch must complete before
 * the next batch starts, the pool keeps N workers active at all times.
 * When a worker finishes, it immediately picks up the next available item.
 */
export class ConcurrentPool {
  /**
   * Process items concurrently using a worker pool pattern.
   *
   * Spawns up to `concurrency` workers that pull items from a shared queue.
   * Each worker processes one item at a time; when it finishes, it immediately
   * takes the next available item. Results maintain the original item order.
   *
   * @param items - Array of items to process
   * @param concurrency - Maximum number of concurrent workers
   * @param processFn - Async function to process each item
   * @param onItemComplete - Optional callback fired after each item completes
   * @returns Array of results in the same order as the input items
   */
  static async run<T, R>(
    items: T[],
    concurrency: number,
    processFn: (item: T, index: number) => Promise<R>,
    onItemComplete?: (result: R, index: number) => void,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await processFn(items[index], index);
        onItemComplete?.(results[index], index);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  }
}
