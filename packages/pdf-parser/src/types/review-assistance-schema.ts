import { z } from 'zod/v4';

export const REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH = 2_000;
export const REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH = 2_000;
export const REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH = 2_000;

export const reviewAssistanceCommandOpSchema = z.enum([
  'replaceText',
  'addText',
  'updateTextRole',
  'removeText',
  'mergeTexts',
  'splitText',
  'updateTableCell',
  'replaceTable',
  'linkContinuedTable',
  'updatePictureCaption',
  'addPicture',
  'splitPicture',
  'hidePicture',
  'updateBbox',
  'linkFootnote',
  'moveNode',
]);

export type ReviewAssistanceCommandOp = z.infer<
  typeof reviewAssistanceCommandOpSchema
>;

const bboxSchema = z.object({
  l: z.number(),
  t: z.number(),
  r: z.number(),
  b: z.number(),
});

const tableCellSchema = z.object({
  text: z.string(),
  bbox: bboxSchema.nullable(),
  rowSpan: z.number().int().positive().nullable(),
  colSpan: z.number().int().positive().nullable(),
  columnHeader: z.boolean().nullable(),
  rowHeader: z.boolean().nullable(),
});

const imageRegionSchema = z.object({
  id: z.string().nullable(),
  bbox: bboxSchema,
  imageUri: z.string().nullable(),
  caption: z.string().nullable(),
});

const textPartSchema = z.object({
  text: z.string(),
  label: z.string().nullable(),
});

// Common metadata fields shared by every command. Kept inline (instead of a
// .merge() helper) so each discriminated-union variant is a single z.object —
// required for OpenAI structured-output strict mode.
const baseFields = {
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH),
  evidence: z.string().max(REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH).nullable(),
} as const;

export const replaceTextCommandSchema = z.object({
  op: z.literal('replaceText'),
  textRef: z.string().min(1),
  text: z.string(),
  ...baseFields,
});

export const addTextCommandSchema = z.object({
  op: z.literal('addText'),
  bbox: bboxSchema,
  text: z.string(),
  label: z.string(),
  pageNo: z.number().int().positive().nullable(),
  afterRef: z.string().nullable(),
  ...baseFields,
});

export const updateTextRoleCommandSchema = z.object({
  op: z.literal('updateTextRole'),
  textRef: z.string().min(1),
  label: z.string().min(1),
  ...baseFields,
});

export const removeTextCommandSchema = z.object({
  op: z.literal('removeText'),
  textRef: z.string().min(1),
  ...baseFields,
});

export const mergeTextsCommandSchema = z.object({
  op: z.literal('mergeTexts'),
  textRefs: z.array(z.string().min(1)).min(2),
  text: z.string(),
  keepRef: z.string().min(1),
  ...baseFields,
});

export const splitTextCommandSchema = z.object({
  op: z.literal('splitText'),
  textRef: z.string().min(1),
  parts: z.array(textPartSchema).min(2),
  ...baseFields,
});

export const updateTableCellCommandSchema = z.object({
  op: z.literal('updateTableCell'),
  tableRef: z.string().min(1),
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  text: z.string(),
  ...baseFields,
});

export const replaceTableCommandSchema = z.object({
  op: z.literal('replaceTable'),
  tableRef: z.string().min(1),
  grid: z.array(z.array(tableCellSchema)).min(1),
  caption: z.string().nullable(),
  ...baseFields,
});

export const linkContinuedTableCommandSchema = z.object({
  op: z.literal('linkContinuedTable'),
  sourceTableRef: z.string().min(1),
  continuedTableRef: z.string().min(1),
  relation: z.enum(['continues_on_next_page', 'continued_from_previous_page']),
  ...baseFields,
});

export const updatePictureCaptionCommandSchema = z.object({
  op: z.literal('updatePictureCaption'),
  pictureRef: z.string().min(1),
  caption: z.string(),
  ...baseFields,
});

export const addPictureCommandSchema = z.object({
  op: z.literal('addPicture'),
  bbox: bboxSchema,
  imageUri: z.string(),
  caption: z.string().nullable(),
  pageNo: z.number().int().positive().nullable(),
  ...baseFields,
});

export const splitPictureCommandSchema = z.object({
  op: z.literal('splitPicture'),
  pictureRef: z.string().min(1),
  regions: z.array(imageRegionSchema).min(2),
  ...baseFields,
});

export const hidePictureCommandSchema = z.object({
  op: z.literal('hidePicture'),
  pictureRef: z.string().min(1),
  reason: z.string().min(1),
  ...baseFields,
});

export const updateBboxCommandSchema = z.object({
  op: z.literal('updateBbox'),
  targetRef: z.string().min(1),
  bbox: bboxSchema,
  ...baseFields,
});

export const linkFootnoteCommandSchema = z.object({
  op: z.literal('linkFootnote'),
  markerTextRef: z.string().min(1),
  footnoteTextRef: z.string().min(1),
  ...baseFields,
});

export const moveNodeCommandSchema = z.object({
  op: z.literal('moveNode'),
  sourceRef: z.string().min(1),
  targetRef: z.string().min(1),
  position: z.enum(['before', 'after']),
  ...baseFields,
});

const ALL_COMMAND_SCHEMA_LIST = [
  replaceTextCommandSchema,
  addTextCommandSchema,
  updateTextRoleCommandSchema,
  removeTextCommandSchema,
  mergeTextsCommandSchema,
  splitTextCommandSchema,
  updateTableCellCommandSchema,
  replaceTableCommandSchema,
  linkContinuedTableCommandSchema,
  updatePictureCaptionCommandSchema,
  addPictureCommandSchema,
  splitPictureCommandSchema,
  hidePictureCommandSchema,
  updateBboxCommandSchema,
  linkFootnoteCommandSchema,
  moveNodeCommandSchema,
] as const;

type AnyCommandSchema = (typeof ALL_COMMAND_SCHEMA_LIST)[number];

const COMMAND_SCHEMA_BY_OP: Record<
  ReviewAssistanceCommandOp,
  AnyCommandSchema
> = {
  replaceText: replaceTextCommandSchema,
  addText: addTextCommandSchema,
  updateTextRole: updateTextRoleCommandSchema,
  removeText: removeTextCommandSchema,
  mergeTexts: mergeTextsCommandSchema,
  splitText: splitTextCommandSchema,
  updateTableCell: updateTableCellCommandSchema,
  replaceTable: replaceTableCommandSchema,
  linkContinuedTable: linkContinuedTableCommandSchema,
  updatePictureCaption: updatePictureCaptionCommandSchema,
  addPicture: addPictureCommandSchema,
  splitPicture: splitPictureCommandSchema,
  hidePicture: hidePictureCommandSchema,
  updateBbox: updateBboxCommandSchema,
  linkFootnote: linkFootnoteCommandSchema,
  moveNode: moveNodeCommandSchema,
};

export const reviewAssistanceRawCommandSchema = z.discriminatedUnion(
  'op',
  ALL_COMMAND_SCHEMA_LIST,
);

export const reviewAssistancePageSchema = z.object({
  pageNo: z.number().int().positive(),
  commands: z.array(reviewAssistanceRawCommandSchema).max(80),
  pageNotes: z
    .array(z.string().max(REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH))
    .max(10),
});

export type ReviewAssistanceRawCommand = z.infer<
  typeof reviewAssistanceRawCommandSchema
>;

export type ReviewAssistancePageOutput = z.infer<
  typeof reviewAssistancePageSchema
>;

/**
 * Build a page schema restricted to one task's allowed ops. When `allowedOps`
 * is empty (or omitted) the full union is returned. Used at the LLM call site
 * so that, for a `text_role_footnote` task, the model can only emit
 * `updateTextRole` or `linkFootnote` — `task_op_not_allowed` issues become
 * structurally impossible.
 */
export function buildReviewAssistancePageSchemaForOps(
  allowedOps: readonly ReviewAssistanceCommandOp[] | undefined,
) {
  if (!allowedOps || allowedOps.length === 0) {
    return reviewAssistancePageSchema;
  }
  const subset = allowedOps
    .map((op) => COMMAND_SCHEMA_BY_OP[op])
    .filter((schema): schema is AnyCommandSchema => Boolean(schema));
  if (subset.length === 0) return reviewAssistancePageSchema;

  const commandSchema =
    subset.length === 1
      ? subset[0]
      : z.discriminatedUnion(
          'op',
          subset as unknown as readonly [
            AnyCommandSchema,
            ...AnyCommandSchema[],
          ],
        );

  return z.object({
    pageNo: z.number().int().positive(),
    commands: z.array(commandSchema).max(80),
    pageNotes: z
      .array(z.string().max(REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH))
      .max(10),
  });
}
