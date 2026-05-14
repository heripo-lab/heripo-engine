import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingGroupItem,
  DoclingPictureItem,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

/**
 * Resolves $ref references in DoclingDocument to actual objects.
 *
 * DoclingDocument uses JSON references (e.g., "#/texts/0") to link nodes.
 * This class builds an index for quick lookups of texts, pictures, tables, and groups.
 */
export class RefResolver {
  private readonly logger: LoggerMethods;
  private readonly textMap: Map<string, DoclingTextItem>;
  private readonly pictureMap: Map<string, DoclingPictureItem>;
  private readonly tableMap: Map<string, DoclingTableItem>;
  private readonly groupMap: Map<string, DoclingGroupItem>;

  constructor(logger: LoggerMethods, doc: DoclingDocument) {
    this.logger = logger;
    this.logger.info('[RefResolver] Initializing reference resolver...');

    this.textMap = this.buildIndex(doc.texts, 'texts');
    this.pictureMap = this.buildIndex(doc.pictures, 'pictures');
    this.tableMap = this.buildIndex(doc.tables, 'tables');
    this.groupMap = this.buildIndex(doc.groups, 'groups');

    this.logger.info(
      `[RefResolver] Indexed ${this.textMap.size} texts, ${this.pictureMap.size} pictures, ${this.tableMap.size} tables, ${this.groupMap.size} groups`,
    );
  }

  /**
   * Build an index mapping self_ref to the actual item
   */
  private buildIndex<T extends { self_ref: string }>(
    items: T[],
    _prefix: string,
  ): Map<string, T> {
    return new Map(items.map((item) => [item.self_ref, item]));
  }

  /**
   * Check whether a Docling self reference exists in the indexed document.
   */
  hasRef(ref: string): boolean {
    const match = ref.match(/^#\/(\w+)\//);
    if (!match) {
      return false;
    }

    const collection = match[1];

    if (collection === 'texts') {
      return this.textMap.has(ref);
    }
    if (collection === 'pictures') {
      return this.pictureMap.has(ref);
    }
    if (collection === 'tables') {
      return this.tableMap.has(ref);
    }
    if (collection === 'groups') {
      return this.groupMap.has(ref);
    }

    return false;
  }

  /**
   * Assert that a Docling self reference exists in the indexed document.
   */
  assertRef(ref: string, context: string): void {
    if (this.hasRef(ref)) {
      return;
    }

    const message = `[RefResolver] Missing source reference in ${context}: ${ref}`;
    this.logger.warn(message);
    throw new Error(message);
  }

  /**
   * Assert that every Docling self reference exists in the indexed document.
   */
  assertRefs(refs: string[], context: string): void {
    const missingRefs = refs.filter((ref) => !this.hasRef(ref));
    if (missingRefs.length === 0) {
      return;
    }

    const message = `[RefResolver] Missing source references in ${context}: ${missingRefs.join(', ')}`;
    this.logger.warn(message);
    throw new Error(message);
  }

  /**
   * Resolve a $ref string to the actual item
   * @param ref - Reference string (e.g., "#/texts/0")
   * @returns The resolved item, or null if not found
   */
  resolve(
    ref: string,
  ):
    | DoclingTextItem
    | DoclingPictureItem
    | DoclingTableItem
    | DoclingGroupItem
    | null {
    // Extract the collection type from the reference
    // Format: "#/texts/0" or "#/pictures/5" etc.
    const match = ref.match(/^#\/(\w+)\//);
    if (!match) {
      this.logger.warn(`[RefResolver] Invalid reference format: ${ref}`);
      return null;
    }

    const collection = match[1];

    if (collection === 'texts') {
      const result = this.textMap.get(ref) ?? null;
      if (!result) {
        this.logger.warn(`[RefResolver] Text reference not found: ${ref}`);
      }
      return result;
    }
    if (collection === 'pictures') {
      const result = this.pictureMap.get(ref) ?? null;
      if (!result) {
        this.logger.warn(`[RefResolver] Picture reference not found: ${ref}`);
      }
      return result;
    }
    if (collection === 'tables') {
      const result = this.tableMap.get(ref) ?? null;
      if (!result) {
        this.logger.warn(`[RefResolver] Table reference not found: ${ref}`);
      }
      return result;
    }
    if (collection === 'groups') {
      const result = this.groupMap.get(ref) ?? null;
      if (!result) {
        this.logger.warn(`[RefResolver] Group reference not found: ${ref}`);
      }
      return result;
    }

    this.logger.warn(`[RefResolver] Unknown collection type: ${collection}`);
    return null;
  }

  /**
   * Resolve a text reference
   * @param ref - Reference string (e.g., "#/texts/0")
   * @returns The resolved text item, or null if not found
   */
  resolveText(ref: string): DoclingTextItem | null {
    return this.textMap.get(ref) ?? null;
  }

  /**
   * Resolve a picture reference
   * @param ref - Reference string (e.g., "#/pictures/0")
   * @returns The resolved picture item, or null if not found
   */
  resolvePicture(ref: string): DoclingPictureItem | null {
    return this.pictureMap.get(ref) ?? null;
  }

  /**
   * Resolve a table reference
   * @param ref - Reference string (e.g., "#/tables/0")
   * @returns The resolved table item, or null if not found
   */
  resolveTable(ref: string): DoclingTableItem | null {
    return this.tableMap.get(ref) ?? null;
  }

  /**
   * Resolve a group reference
   * @param ref - Reference string (e.g., "#/groups/0")
   * @returns The resolved group item, or null if not found
   */
  resolveGroup(ref: string): DoclingGroupItem | null {
    return this.groupMap.get(ref) ?? null;
  }

  /**
   * Resolve multiple references at once
   * @param refs - Array of reference objects with $ref property
   * @returns Array of resolved items (null for unresolved references)
   */
  resolveMany(
    refs: Array<{ $ref: string }>,
  ): Array<
    | DoclingTextItem
    | DoclingPictureItem
    | DoclingTableItem
    | DoclingGroupItem
    | null
  > {
    return refs.map((ref) => this.resolve(ref.$ref));
  }
}
