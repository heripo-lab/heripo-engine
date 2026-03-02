import type {
  VlmBBox,
  VlmElementType,
  VlmPageElement,
  VlmPageResult,
} from './vlm-page-result';

import { z } from 'zod/v4';

/**
 * Short field name mapping for VLM output token optimization.
 *
 * VLM outputs JSON with abbreviated field names to reduce output tokens.
 * These are then mapped back to full VlmPageElement fields.
 *
 * Mapping:
 *   t  → type
 *   c  → content
 *   l  → level
 *   m  → marker
 *   o  → order
 *   b  → bbox { l, t, r, b }
 */

/** Short type abbreviations for element types */
const TYPE_ABBREVIATIONS: Record<string, VlmElementType> = {
  tx: 'text',
  sh: 'section_header',
  ca: 'caption',
  fn: 'footnote',
  ph: 'page_header',
  pf: 'page_footer',
  li: 'list_item',
  pi: 'picture',
  tb: 'table',
};

/** Reverse mapping: full type → abbreviation */
const TYPE_TO_ABBREVIATION: Record<VlmElementType, string> = Object.fromEntries(
  Object.entries(TYPE_ABBREVIATIONS).map(([k, v]) => [v, k]),
) as Record<VlmElementType, string>;

/** All valid short type codes */
const SHORT_TYPE_VALUES = Object.keys(TYPE_ABBREVIATIONS) as [
  string,
  ...string[],
];

/** Zod schema for a single bounding box */
const bboxSchema = z.object({
  l: z.number().min(0).max(1).describe('Left edge (0-1 normalized)'),
  t: z.number().min(0).max(1).describe('Top edge (0-1 normalized)'),
  r: z.number().min(0).max(1).describe('Right edge (0-1 normalized)'),
  b: z.number().min(0).max(1).describe('Bottom edge (0-1 normalized)'),
});

/**
 * Zod schema for a single element with short field names.
 *
 * All fields use `.nullable()` instead of `.optional()` because
 * OpenAI structured output requires every property to be in the
 * `required` array. Nullable fields remain required but accept `null`.
 */
const shortElementSchema = z.object({
  t: z
    .enum(SHORT_TYPE_VALUES)
    .describe('Type abbreviation (e.g., "tx", "sh", "pi")'),
  c: z.string().describe('Content text'),
  l: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('Level (for section headers, null if not applicable)'),
  m: z
    .string()
    .nullable()
    .describe('Marker (for list items, null if not applicable)'),
  o: z.number().int().nonnegative().describe('Reading order'),
  b: bboxSchema
    .nullable()
    .describe('Bounding box (required for picture elements, null for others)'),
});

/** Zod schema for VLM page output with short field names */
export const vlmPageOutputSchema = z.object({
  /** Array of detected elements */
  e: z.array(shortElementSchema),
});

/** Type inferred from the short-field schema */
export type VlmPageOutput = z.infer<typeof vlmPageOutputSchema>;

/**
 * Maps a short type abbreviation to its full VlmElementType.
 * @throws Error if the abbreviation is not recognized
 */
export function expandTypeAbbreviation(short: string): VlmElementType {
  const fullType = TYPE_ABBREVIATIONS[short];
  if (!fullType) {
    throw new Error(`Unknown element type abbreviation: "${short}"`);
  }
  return fullType;
}

/**
 * Converts a full VlmElementType to its short abbreviation.
 */
export function abbreviateType(type: VlmElementType): string {
  return TYPE_TO_ABBREVIATION[type];
}

/**
 * Converts a VLM short-field output to a full VlmPageResult.
 *
 * @param pageNo - 1-based page number
 * @param output - Parsed VLM output with short field names
 * @returns Full VlmPageResult with expanded field names
 */
export function toVlmPageResult(
  pageNo: number,
  output: VlmPageOutput,
): VlmPageResult {
  const elements: VlmPageElement[] = output.e.map((el) => {
    const element: VlmPageElement = {
      type: expandTypeAbbreviation(el.t),
      content: el.c,
      order: el.o,
    };

    if (el.l != null) {
      element.level = el.l;
    }

    if (el.m != null) {
      element.marker = el.m;
    }

    if (el.b != null) {
      const bbox: VlmBBox = {
        l: el.b.l,
        t: el.b.t,
        r: el.b.r,
        b: el.b.b,
      };
      element.bbox = bbox;
    }

    return element;
  });

  return { pageNo, elements };
}

export { TYPE_ABBREVIATIONS, TYPE_TO_ABBREVIATION };
