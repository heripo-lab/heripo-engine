import { z } from 'zod/v4';

/**
 * Zod schema for VLM text correction response.
 *
 * The VLM returns only corrections (items that differ from OCR output).
 * If all text is correct, both arrays are empty.
 *
 * Short field names are used to minimize output tokens:
 * - tc = text corrections
 * - cc = cell corrections
 * - i  = text element index
 * - ti = table index (within the page)
 * - r  = row index
 * - c  = column index
 * - t  = corrected text
 */
export const vlmTextCorrectionSchema = z.object({
  /** Text element corrections */
  tc: z.array(
    z.object({
      /** Text element index (from prompt) */
      i: z.number().int().nonnegative(),
      /** Corrected text */
      t: z.string(),
    }),
  ),
  /** Table cell corrections */
  cc: z.array(
    z.object({
      /** Table index (within the page) */
      ti: z.number().int().nonnegative(),
      /** Row index */
      r: z.number().int().nonnegative(),
      /** Column index */
      c: z.number().int().nonnegative(),
      /** Corrected cell text */
      t: z.string(),
    }),
  ),
});

/** Type inferred from the VLM text correction schema */
export type VlmTextCorrectionOutput = z.infer<typeof vlmTextCorrectionSchema>;
