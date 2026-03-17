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
  const results: Array<{ index: number; item: DoclingTextItem }> = [];

  for (let i = 0; i < doc.texts.length; i++) {
    const item = doc.texts[i];
    if (!TEXT_LABELS.has(item.label)) continue;
    if (item.prov.some((p) => p.page_no === pageNo)) {
      results.push({ index: i, item });
    }
  }

  return results;
}

/**
 * Get table items on a specific page, with their indices.
 */
export function getPageTables(
  doc: DoclingDocument,
  pageNo: number,
): Array<{ index: number; item: DoclingTableItem }> {
  const results: Array<{ index: number; item: DoclingTableItem }> = [];

  for (let i = 0; i < doc.tables.length; i++) {
    const item = doc.tables[i];
    if (item.prov.some((p) => p.page_no === pageNo)) {
      results.push({ index: i, item });
    }
  }

  return results;
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
    for (const correction of corrections.tc) {
      if (correction.i >= 0 && correction.i < pageTexts.length) {
        const docIndex = pageTexts[correction.i].index;
        let text = doc.texts[docIndex].text;
        for (const sub of correction.s) {
          const idx = text.indexOf(sub.f);
          if (idx >= 0) {
            text =
              text.substring(0, idx) +
              sub.r +
              text.substring(idx + sub.f.length);
          } else {
            logger.warn(
              `[VlmTextCorrector] Page ${pageNo}, text ${correction.i}: ` +
                `find string not found, skipping substitution`,
            );
          }
        }
        if (text !== doc.texts[docIndex].text) {
          doc.texts[docIndex].text = text;
          doc.texts[docIndex].orig = text;
        }
      }
    }
  }

  // Apply cell corrections
  if (corrections.cc.length > 0) {
    const pageTables = getPageTables(doc, pageNo);
    for (const correction of corrections.cc) {
      if (correction.ti >= 0 && correction.ti < pageTables.length) {
        const table = pageTables[correction.ti].item;

        // Update table_cells
        for (const cell of table.data.table_cells) {
          if (
            cell.start_row_offset_idx === correction.r &&
            cell.start_col_offset_idx === correction.c
          ) {
            cell.text = correction.t;
            break;
          }
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
    }
  }
}
