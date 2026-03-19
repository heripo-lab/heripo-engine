import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import type { VlmTextCorrectionOutput } from '../types/vlm-text-correction-schema';

/** Type abbreviation codes for text element labels */
export const LABEL_TO_TYPE_CODE: Record<string, string> = {
  section_header: 'sh',
  text: 'tx',
  caption: 'ca',
  footnote: 'fn',
  list_item: 'li',
  page_header: 'ph',
  page_footer: 'pf',
};

/** Text labels that should be included in VLM correction */
export const TEXT_LABELS = new Set(Object.keys(LABEL_TO_TYPE_CODE));

/**
 * Get text items on a specific page, with their indices for prompt building.
 */
export function getPageTexts(
  doc: DoclingDocument,
  pageNo: number,
): Array<{ index: number; item: DoclingTextItem }> {
  return doc.texts
    .map((item, index) => ({ index, item }))
    .filter(
      ({ item }) =>
        TEXT_LABELS.has(item.label) &&
        item.prov.some((p) => p.page_no === pageNo),
    );
}

/**
 * Get table items on a specific page, with their indices.
 */
export function getPageTables(
  doc: DoclingDocument,
  pageNo: number,
): Array<{ index: number; item: DoclingTableItem }> {
  return doc.tables
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => item.prov.some((p) => p.page_no === pageNo));
}

/**
 * Apply VLM corrections to the DoclingDocument.
 */
export function applyCorrections(
  doc: DoclingDocument,
  pageNo: number,
  corrections: VlmTextCorrectionOutput,
  logger: LoggerMethods,
): void {
  // Apply text corrections (substitution-based)
  if (corrections.tc.length > 0) {
    const pageTexts = getPageTexts(doc, pageNo);
    corrections.tc.forEach((correction) => {
      if (correction.i >= 0 && correction.i < pageTexts.length) {
        const docIndex = pageTexts[correction.i].index;
        const text = correction.s.reduce((acc, sub) => {
          const idx = acc.indexOf(sub.f);
          if (idx >= 0) {
            return (
              acc.substring(0, idx) + sub.r + acc.substring(idx + sub.f.length)
            );
          }
          logger.warn(
            `[VlmTextCorrector] Page ${pageNo}, text ${correction.i}: ` +
              `find string not found, skipping substitution`,
          );
          return acc;
        }, doc.texts[docIndex].text);
        if (text !== doc.texts[docIndex].text) {
          doc.texts[docIndex].text = text;
          doc.texts[docIndex].orig = text;
        }
      }
    });
  }

  // Apply cell corrections
  if (corrections.cc.length > 0) {
    const pageTables = getPageTables(doc, pageNo);
    corrections.cc.forEach((correction) => {
      if (correction.ti >= 0 && correction.ti < pageTables.length) {
        const table = pageTables[correction.ti].item;

        // Update table_cells
        const matchingCell = table.data.table_cells.find(
          (cell) =>
            cell.start_row_offset_idx === correction.r &&
            cell.start_col_offset_idx === correction.c,
        );
        if (matchingCell) {
          matchingCell.text = correction.t;
        }

        // Sync grid cell (grid stores separate objects from table_cells)
        const gridRow = table.data.grid[correction.r];
        if (gridRow) {
          const gridCell = gridRow[correction.c];
          if (gridCell) {
            gridCell.text = correction.t;
          }
        }
      }
    });
  }
}
