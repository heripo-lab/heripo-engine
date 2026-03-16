import type { LoggerMethods } from '@heripo/logger';
import type { DoclingAPIClient } from 'docling-sdk';

import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/**
 * Download the ZIP result from a completed Docling conversion task.
 *
 * Uses 3-step fallback: fileStream → data → direct HTTP fetch.
 *
 * @param client - Docling API client
 * @param taskId - Completed task ID
 * @param zipPath - Local path to save the ZIP file
 * @param logger - Logger instance
 * @param logPrefix - Log prefix (e.g. '[PDFConverter]' or '[ChunkedPDFConverter]')
 */
export async function downloadTaskResult(
  client: DoclingAPIClient,
  taskId: string,
  zipPath: string,
  logger: LoggerMethods,
  logPrefix: string,
): Promise<void> {
  logger.info(`\n${logPrefix} Task completed, downloading ZIP file...`);

  const zipResult = await client.getTaskResultFile(taskId);

  logger.info(`${logPrefix} Saving ZIP file to:`, zipPath);

  if (zipResult.fileStream) {
    const writeStream = createWriteStream(zipPath);
    await pipeline(zipResult.fileStream, writeStream);
    return;
  }

  if (zipResult.data) {
    await writeFile(zipPath, zipResult.data);
    return;
  }

  // Fallback: direct HTTP download when SDK stream/data unavailable
  logger.warn(
    `${logPrefix} SDK file result unavailable, falling back to direct download...`,
  );
  const baseUrl = client.getConfig().baseUrl;
  const response = await fetch(`${baseUrl}/v1/result/${taskId}`, {
    headers: { Accept: 'application/zip' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download ZIP file: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  await writeFile(zipPath, buffer);
}
