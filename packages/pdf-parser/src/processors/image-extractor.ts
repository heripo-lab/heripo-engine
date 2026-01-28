import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import * as yauzl from 'yauzl';

import {
  jqExtractBase64PngStrings,
  jqReplaceBase64WithPaths,
} from '../utils/jq';

/**
 * ImageExtractor handles extraction and processing of images from PDF conversion results
 *
 * This class provides functionality to:
 * - Extract ZIP files containing converted PDF documents
 * - Extract base64-encoded images from JSON and HTML content
 * - Save images as separate PNG files
 * - Replace base64 data with relative file paths
 */
export class ImageExtractor {
  /**
   * Extract a ZIP file to a target directory
   */
  private static async extractZip(
    zipPath: string,
    targetDir: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          reject(err || new Error('Failed to open zip file'));
          return;
        }

        zipfile.readEntry();

        zipfile.on('entry', (entry) => {
          const entryPath = join(targetDir, entry.fileName);

          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            mkdirSync(entryPath, { recursive: true });
            zipfile.readEntry();
          } else {
            // File entry
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err || !readStream) {
                reject(err || new Error('Failed to open read stream'));
                return;
              }

              mkdirSync(join(entryPath, '..'), { recursive: true });
              const writeStream = createWriteStream(entryPath);

              readStream.pipe(writeStream);
              writeStream.on('finish', () => {
                zipfile.readEntry();
              });
              writeStream.on('error', reject);
            });
          }
        });

        zipfile.on('end', () => {
          resolve();
        });

        zipfile.on('error', reject);
      });
    });
  }

  /**
   * Extract base64 images from JSON file using jq (for large files)
   * Returns array of base64 data strings
   */
  private static async extractBase64ImagesFromJsonWithJq(
    jsonPath: string,
  ): Promise<string[]> {
    return jqExtractBase64PngStrings(jsonPath);
  }

  /**
   * Replace base64 images with file paths in JSON using jq (for large files)
   * Uses reduce to maintain counter state while walking the JSON
   */
  private static async replaceBase64ImagesInJsonWithJq(
    jsonPath: string,
    outputPath: string,
    dirName: string,
    prefix: string,
  ): Promise<number> {
    const { data, count } = (await jqReplaceBase64WithPaths(
      jsonPath,
      dirName,
      prefix,
    )) as { data: DoclingDocument; count: number };

    // Write transformed JSON to output file
    writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

    return count;
  }

  /**
   * Extract a base64-encoded image to a file and return the relative path
   */
  private static extractBase64ImageToFile(
    base64Data: string,
    imagesDir: string,
    index: number,
    prefix: string,
    dirName: string,
  ): string {
    const PREFIX = 'data:image/png;base64,';
    const base64Content = base64Data.startsWith(PREFIX)
      ? base64Data.slice(PREFIX.length)
      : base64Data;

    const filename = `${prefix}_${index}.png`;
    const filepath = join(imagesDir, filename);

    // Convert base64 to buffer and write to file
    const buffer = Buffer.from(base64Content, 'base64');
    writeFileSync(filepath, buffer);

    return `${dirName}/${filename}`;
  }

  /**
   * Save JSON and HTML documents with base64 images extracted to separate files
   * Uses jq for JSON processing to handle large files
   *
   * This method:
   * 1. Extracts base64-encoded images from JSON and HTML content
   * 2. Saves images as separate PNG files
   * 3. Replaces base64 data with relative file paths
   * 4. Saves the transformed documents to the output directory
   */
  private static async saveDocumentsWithExtractedImages(
    logger: LoggerMethods,
    outputDir: string,
    filename: string,
    jsonSourcePath: string,
    htmlContent: string,
  ): Promise<void> {
    // Clear output directory completely at the start, then recreate it
    try {
      if (existsSync(outputDir)) {
        rmSync(outputDir, { recursive: true, force: true });
      }
    } catch (e) {
      logger.warn('[PDFConverter] Failed to clear output directory:', e);
    }
    mkdirSync(outputDir, { recursive: true });

    // Get filename without extension
    const baseName = filename.replace(extname(filename), '');

    // Save JSON with extracted images (using jq for large files)
    const jsonPath = join(outputDir, `${baseName}.json`);
    try {
      // Create pages directory for JSON images
      const pagesDir = join(outputDir, 'pages');
      if (!existsSync(pagesDir)) {
        mkdirSync(pagesDir, { recursive: true });
      }

      // Step 1: Extract base64 images using jq (doesn't load full JSON into memory)
      const base64Images =
        await ImageExtractor.extractBase64ImagesFromJsonWithJq(jsonSourcePath);

      // Step 2: Save each image to file
      base64Images.forEach((base64Data, index) => {
        ImageExtractor.extractBase64ImageToFile(
          base64Data,
          pagesDir,
          index,
          'page',
          'pages',
        );
      });

      logger.info(
        `[PDFConverter] Extracted ${base64Images.length} images from JSON to ${pagesDir}`,
      );

      // Step 3: Replace base64 images with file paths using jq
      const replacedCount =
        await ImageExtractor.replaceBase64ImagesInJsonWithJq(
          jsonSourcePath,
          jsonPath,
          'pages',
          'page',
        );

      logger.info(
        `[PDFConverter] Replaced ${replacedCount} base64 images with file paths`,
      );
    } catch (e) {
      logger.warn(
        '[PDFConverter] Failed to extract images from JSON using jq. Error:',
        e,
      );
      throw e;
    }
    logger.info('[PDFConverter] Saved JSON:', jsonPath);

    // Save HTML with extracted images
    const htmlPath = join(outputDir, `${baseName}.html`);
    try {
      // Create images directory for HTML images
      const imagesDir = join(outputDir, 'images');
      if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
      }

      // Extract base64 images from HTML src attributes, save them as PNG files, and replace with file paths
      let imageIndex = 0;
      const transformedHtml = htmlContent.replace(
        /src="data:image\/png;base64,([^"]+)"/g,
        (_, base64Content) => {
          const filename = `image_${imageIndex}.png`;
          const filepath = join(imagesDir, filename);

          // Convert base64 to buffer and write to file
          const buffer = Buffer.from(base64Content, 'base64');
          writeFileSync(filepath, buffer);

          const relativePath = `images/${filename}`;
          imageIndex += 1;

          return `src="${relativePath}"`;
        },
      );

      logger.info(
        `[PDFConverter] Extracted ${imageIndex} images from HTML to ${imagesDir}`,
      );
      writeFileSync(htmlPath, transformedHtml, 'utf-8');
    } catch (e) {
      logger.warn(
        '[PDFConverter] Failed to extract images from HTML, writing original. Error:',
        e,
      );
      writeFileSync(htmlPath, htmlContent, 'utf-8');
    }
    logger.info('[PDFConverter] Saved HTML:', htmlPath);
  }

  /**
   * Extract documents from ZIP and save with extracted images
   * Uses jq for JSON processing to handle large files without loading into Node.js memory
   *
   * Complete workflow:
   * 1. Extract ZIP file to temporary directory
   * 2. Find JSON and HTML files from extracted files
   * 3. Use jq to extract base64 images from JSON and save as separate files
   * 4. Use jq to replace base64 with file paths in JSON
   * 5. Process HTML with regex to extract and replace images
   * 6. Save transformed documents to output directory (as result.json and result.html)
   */
  static async extractAndSaveDocumentsFromZip(
    logger: LoggerMethods,
    zipPath: string,
    extractDir: string,
    outputDir: string,
  ): Promise<void> {
    // Extract zip file
    logger.info('[PDFConverter] Extracting ZIP file...');
    await ImageExtractor.extractZip(zipPath, extractDir);

    // Find JSON and HTML files dynamically
    const files = readdirSync(extractDir);
    const jsonFile = files.find((f) => extname(f).toLowerCase() === '.json');
    const htmlFile = files.find((f) => extname(f).toLowerCase() === '.html');

    if (!jsonFile || !htmlFile) {
      throw new Error(
        `Expected one JSON and one HTML file in extracted directory. Found: ${files.join(', ')}`,
      );
    }

    // Get file paths
    const jsonPath = join(extractDir, jsonFile);
    const htmlPath = join(extractDir, htmlFile);

    // Read HTML content (HTML is typically smaller, safe to read into memory)
    const htmlContent = readFileSync(htmlPath, 'utf-8');

    // Save converted files to output directory with extracted images
    // JSON is processed with jq to avoid loading large files into memory
    logger.info('[PDFConverter] Saving converted files to output...');
    await ImageExtractor.saveDocumentsWithExtractedImages(
      logger,
      outputDir,
      'result',
      jsonPath,
      htmlContent,
    );

    logger.info('[PDFConverter] Files saved to:', outputDir);
  }
}
