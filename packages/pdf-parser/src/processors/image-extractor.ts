import type { LoggerMethods } from '@heripo/logger';

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

import {
  jqExtractBase64PngStringsStreaming,
  jqReplaceBase64WithPathsToFile,
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
   * Extract base64 images from HTML using streaming.
   * Reads HTML file as a stream, extracts base64 images from src attributes,
   * saves them as PNG files, and replaces with file paths in the output HTML.
   * Returns the number of images extracted.
   */
  static async extractImagesFromHtmlStream(
    htmlInputPath: string,
    htmlOutputPath: string,
    imagesDir: string,
  ): Promise<number> {
    let imageIndex = 0;
    let pending = '';
    const MARKER = 'src="data:image/png;base64,';

    const transform = new Transform({
      decodeStrings: false,
      encoding: 'utf-8',
      transform(chunk: string, _encoding, callback) {
        pending += chunk;
        let result = '';

        while (true) {
          const markerIdx = pending.indexOf(MARKER);

          if (markerIdx === -1) {
            // Keep a tail that could be a partial marker match
            const safeEnd = Math.max(0, pending.length - MARKER.length);
            result += pending.slice(0, safeEnd);
            pending = pending.slice(safeEnd);
            break;
          }

          // Flush everything before the marker
          result += pending.slice(0, markerIdx);

          // Find the closing quote after base64 data
          const dataStart = markerIdx + MARKER.length;
          const quoteIdx = pending.indexOf('"', dataStart);

          if (quoteIdx === -1) {
            // Closing quote not in buffer yet — keep everything from marker onward
            pending = pending.slice(markerIdx);
            break;
          }

          // Extract base64 content and save as image file
          const base64Content = pending.slice(dataStart, quoteIdx);
          const filename = `image_${imageIndex}.png`;
          const filepath = join(imagesDir, filename);
          const buf = Buffer.from(base64Content, 'base64');
          writeFileSync(filepath, buf);

          const relativePath = `images/${filename}`;
          result += `src="${relativePath}"`;
          imageIndex++;

          pending = pending.slice(quoteIdx + 1);
        }

        if (result.length > 0) {
          this.push(result);
        }
        callback();
      },
      flush(callback) {
        if (pending.length > 0) {
          this.push(pending);
        }
        callback();
      },
    });

    const rs = createReadStream(htmlInputPath, { encoding: 'utf-8' });
    const ws = createWriteStream(htmlOutputPath, { encoding: 'utf-8' });

    await pipeline(rs, transform, ws);

    return imageIndex;
  }

  /**
   * Save JSON and HTML documents with base64 images extracted to separate files.
   * Uses jq for JSON processing and streaming for HTML to handle large files.
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
    htmlSourcePath: string,
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

    // Save JSON with extracted images (using jq streaming for large files)
    const jsonPath = join(outputDir, `${baseName}.json`);
    try {
      // Create images directory for picture images from JSON
      const imagesDir = join(outputDir, 'images');
      if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
      }

      // Step 1: Extract base64 images using streaming jq (one at a time, no accumulation)
      const imageCount = await jqExtractBase64PngStringsStreaming(
        jsonSourcePath,
        (base64Data, index) => {
          ImageExtractor.extractBase64ImageToFile(
            base64Data,
            imagesDir,
            index,
            'pic',
            'images',
          );
        },
      );

      logger.info(
        `[PDFConverter] Extracted ${imageCount} picture images from JSON to ${imagesDir}`,
      );

      // Step 2: Replace base64 images with file paths using jq, pipe directly to file
      await jqReplaceBase64WithPathsToFile(
        jsonSourcePath,
        jsonPath,
        'images',
        'pic',
      );

      logger.info(
        `[PDFConverter] Replaced ${imageCount} base64 images with file paths`,
      );
    } catch (e) {
      logger.warn(
        '[PDFConverter] Failed to extract images from JSON using jq. Error:',
        e,
      );
      throw e;
    }
    logger.info('[PDFConverter] Saved JSON:', jsonPath);

    // Save HTML with extracted images using streaming
    const htmlPath = join(outputDir, `${baseName}.html`);
    try {
      // Create images directory for HTML images
      const imagesDir = join(outputDir, 'images');
      if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
      }

      const htmlImageCount = await ImageExtractor.extractImagesFromHtmlStream(
        htmlSourcePath,
        htmlPath,
        imagesDir,
      );

      logger.info(
        `[PDFConverter] Extracted ${htmlImageCount} images from HTML to ${imagesDir}`,
      );
    } catch (e) {
      logger.warn(
        '[PDFConverter] Failed to extract images from HTML, copying original. Error:',
        e,
      );
      // Fallback: copy original HTML using streaming
      const rs = createReadStream(htmlSourcePath);
      const ws = createWriteStream(htmlPath);
      await pipeline(rs, ws);
    }
    logger.info('[PDFConverter] Saved HTML:', htmlPath);
  }

  /**
   * Extract documents from ZIP and save with extracted images
   * Uses jq for JSON processing and streaming for HTML to handle large files
   * without loading into Node.js memory
   *
   * Complete workflow:
   * 1. Extract ZIP file to temporary directory
   * 2. Find JSON and HTML files from extracted files
   * 3. Use jq to stream-extract base64 images from JSON and save as separate files
   * 4. Use jq to replace base64 with file paths in JSON (piped to file)
   * 5. Process HTML with streaming Transform to extract and replace images
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

    // Save converted files to output directory with extracted images
    // Both JSON and HTML are processed with streaming to avoid loading large files into memory
    logger.info('[PDFConverter] Saving converted files to output...');
    await ImageExtractor.saveDocumentsWithExtractedImages(
      logger,
      outputDir,
      'result',
      jsonPath,
      htmlPath,
    );

    logger.info('[PDFConverter] Files saved to:', outputDir);
  }
}
