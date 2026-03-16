import type { LoggerMethods } from '@heripo/logger';

import { rename } from 'node:fs/promises';
import { join } from 'node:path';

import { PAGE_RENDERING } from '../config/constants';
import { PageRenderer } from '../processors/page-renderer';
import { runJqFileToFile } from './jq';

/**
 * Render page images from a PDF using ImageMagick and update result.json.
 *
 * Uses jq to update the JSON file without loading it into Node.js memory.
 * Replaces Docling's generate_page_images which fails on large PDFs
 * due to memory limits when embedding all page images as base64.
 *
 * @param pdfPath - Absolute path to the source PDF file
 * @param outputDir - Directory containing result.json (pages/ subdirectory will be created)
 * @param logger - Logger instance
 * @param logPrefix - Log prefix (e.g. '[PDFConverter]')
 */
export async function renderAndUpdatePageImages(
  pdfPath: string,
  outputDir: string,
  logger: LoggerMethods,
  logPrefix: string,
): Promise<void> {
  logger.info(`${logPrefix} Rendering page images with ImageMagick...`);

  const renderer = new PageRenderer(logger);
  const renderResult = await renderer.renderPages(pdfPath, outputDir);

  // Update result.json with page image URIs using jq to avoid loading large JSON
  const resultPath = join(outputDir, 'result.json');
  const tmpPath = resultPath + '.tmp';
  const jqProgram = `
    .pages |= with_entries(
      if (.value.page_no - 1) >= 0 and (.value.page_no - 1) < ${renderResult.pageCount} then
        .value.image.uri = "pages/page_\\(.value.page_no - 1).png" |
        .value.image.mimetype = "image/png" |
        .value.image.dpi = ${PAGE_RENDERING.DEFAULT_DPI}
      else . end
    )
  `;
  await runJqFileToFile(jqProgram, resultPath, tmpPath);
  await rename(tmpPath, resultPath);

  logger.info(`${logPrefix} Rendered ${renderResult.pageCount} page images`);
}
