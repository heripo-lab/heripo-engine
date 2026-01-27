/**
 * Generates sequential IDs for different types of items.
 *
 * IDs are formatted as: `{prefix}-{number}` where number is zero-padded to 3 digits.
 * - Chapters: ch-001, ch-002, ...
 * - Images: img-001, img-002, ...
 * - Tables: tbl-001, tbl-002, ...
 *
 * Each type maintains its own independent counter.
 */
export class IdGenerator {
  private chapterCounter = 0;
  private imageCounter = 0;
  private tableCounter = 0;
  private footnoteCounter = 0;

  /**
   * Generate a chapter ID
   * @returns A chapter ID in the format "ch-001"
   */
  generateChapterId(): string {
    this.chapterCounter++;
    return `ch-${this.padNumber(this.chapterCounter)}`;
  }

  /**
   * Generate an image ID
   * @returns An image ID in the format "img-001"
   */
  generateImageId(): string {
    this.imageCounter++;
    return `img-${this.padNumber(this.imageCounter)}`;
  }

  /**
   * Generate a table ID
   * @returns A table ID in the format "tbl-001"
   */
  generateTableId(): string {
    this.tableCounter++;
    return `tbl-${this.padNumber(this.tableCounter)}`;
  }

  /**
   * Generate a footnote ID
   * @returns A footnote ID in the format "ftn-001"
   */
  generateFootnoteId(): string {
    this.footnoteCounter++;
    return `ftn-${this.padNumber(this.footnoteCounter)}`;
  }

  /**
   * Reset all counters to zero
   */
  reset(): void {
    this.chapterCounter = 0;
    this.imageCounter = 0;
    this.tableCounter = 0;
    this.footnoteCounter = 0;
  }

  /**
   * Get current counter values (for testing/debugging)
   */
  getCounters(): {
    chapter: number;
    image: number;
    table: number;
    footnote: number;
  } {
    return {
      chapter: this.chapterCounter,
      image: this.imageCounter,
      table: this.tableCounter,
      footnote: this.footnoteCounter,
    };
  }

  /**
   * Pad a number to 3 digits with leading zeros
   */
  private padNumber(num: number): string {
    return num.toString().padStart(3, '0');
  }
}
