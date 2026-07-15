import type { ProcessedDocument } from '@heripo/model';
import type { Chapter } from '@heripo/model';

import { z } from 'zod';

/**
 * Maximum number of validation issues included in the error message.
 * Keeps error payloads small even for deeply broken inputs.
 */
const MAX_REPORTED_ISSUES = 5;

const captionSchema = z.object({
  num: z.string().optional(),
  fullText: z.string(),
});

const pageRangeSchema = z.object({
  startPageNo: z.number(),
  endPageNo: z.number(),
});

const processedDocumentSourceSchema = z.object({
  pipelineRunId: z.string().optional(),
  doclingObjectKey: z.string().optional(),
  doclingSha256: z.string().optional(),
  handoffManifestObjectKey: z.string().optional(),
});

const textBlockSchema = z.object({
  id: z.string().optional(),
  sourceRef: z.string().optional(),
  text: z.string(),
  pdfPageNo: z.number(),
});

const chapterSchema: z.ZodType<Chapter> = z.lazy(() =>
  z.object({
    id: z.string(),
    originTitle: z.string(),
    title: z.string(),
    pageNo: z.number(),
    level: z.number(),
    sourceRefs: z.array(z.string()).optional(),
    textBlocks: z.array(textBlockSchema),
    imageIds: z.array(z.string()),
    tableIds: z.array(z.string()),
    footnoteIds: z.array(z.string()),
    children: z.array(chapterSchema).optional(),
  }),
);

const processedImageSchema = z.object({
  id: z.string(),
  sourceRef: z.string().optional(),
  captionSourceRefs: z.array(z.string()).optional(),
  caption: captionSchema.optional(),
  pdfPageNo: z.number(),
  path: z.string(),
});

const processedTableCellSchema = z.object({
  text: z.string(),
  rowSpan: z.number(),
  colSpan: z.number(),
  isHeader: z.boolean(),
});

const processedTableSchema = z.object({
  id: z.string(),
  sourceRef: z.string().optional(),
  captionSourceRefs: z.array(z.string()).optional(),
  caption: captionSchema.optional(),
  pdfPageNo: z.number(),
  numRows: z.number(),
  numCols: z.number(),
  grid: z.array(z.array(processedTableCellSchema)),
});

const processedFootnoteSchema = z.object({
  id: z.string(),
  sourceRef: z.string().optional(),
  text: z.string(),
  pdfPageNo: z.number(),
});

const processedDocumentSchema = z.object({
  reportId: z.string(),
  schemaVersion: z.string().optional(),
  source: processedDocumentSourceSchema.optional(),
  pageRangeMap: z.record(z.string().regex(/^\d+$/), pageRangeSchema),
  chapters: z.array(chapterSchema),
  images: z.array(processedImageSchema),
  tables: z.array(processedTableSchema),
  footnotes: z.array(processedFootnoteSchema),
});

/**
 * Error thrown when an unknown value fails ProcessedDocument validation.
 *
 * The message contains a bounded list of issue paths so it stays safe to
 * surface in API responses and task logs.
 */
export class ProcessedDocumentValidationError extends Error {
  /**
   * Flattened validation issues (bounded by {@link MAX_REPORTED_ISSUES})
   */
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    const summary = issues
      .map((issue) =>
        issue.path.length > 0
          ? `${issue.path}: ${issue.message}`
          : issue.message,
      )
      .join('; ');
    super(`Invalid ProcessedDocument: ${summary}`);
    this.name = 'ProcessedDocumentValidationError';
    this.issues = issues;
  }
}

/**
 * Validate an unknown value (e.g. an uploaded JSON payload) against the
 * ProcessedDocument model and return it as a typed document.
 *
 * The input value is never mutated; validation returns a new object with
 * unknown properties stripped.
 *
 * @param input - Unknown value to validate
 * @returns The validated ProcessedDocument
 * @throws {ProcessedDocumentValidationError} When the value does not match
 */
export function parseProcessedDocument(input: unknown): ProcessedDocument {
  const result = processedDocumentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, MAX_REPORTED_ISSUES)
      .map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
    throw new ProcessedDocumentValidationError(issues);
  }

  const document: ProcessedDocument = result.data;
  return document;
}
