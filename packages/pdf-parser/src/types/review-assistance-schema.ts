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

// Docling text-item labels that review-assistance is allowed to assign or
// re-assign. Web's TEXT_LABEL_TO_ROLE adapter maps every value here to a
// concrete ReviewTextRole; enum-locking prevents the LLM from inventing
// labels (e.g. "toc_entry") that the web side cannot apply.
export const reviewAssistanceTextLabelSchema = z.enum([
  'text',
  'caption',
  'footnote',
  'section_header',
  'list_item',
  'page_header',
  'page_footer',
]);

export type ReviewAssistanceTextLabel = z.infer<
  typeof reviewAssistanceTextLabelSchema
>;

const textPartSchema = z.object({
  text: z.string(),
  label: reviewAssistanceTextLabelSchema.nullable(),
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
  label: reviewAssistanceTextLabelSchema,
  pageNo: z.number().int().positive().nullable(),
  afterRef: z.string().nullable(),
  ...baseFields,
});

export const updateTextRoleCommandSchema = z.object({
  op: z.literal('updateTextRole'),
  textRef: z.string().min(1),
  label: reviewAssistanceTextLabelSchema,
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

/**
 * Conflict-merge response schema. When multiple task work-items propose
 * different commands against the same Docling ref the runner asks the model
 * to either pick exactly one candidate by index or drop all of them. Keeping
 * the response shape narrow (a single pick/drop decision per group) avoids
 * the LLM inventing new edits during the merge phase.
 */
export const reviewAssistanceMergeChoiceSchema = z.discriminatedUnion(
  'decision',
  [
    z.object({
      decision: z.literal('pick'),
      chosenIndex: z.number().int().nonnegative(),
      confidence: z.number().min(0).max(1),
      rationale: z.string().max(REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH),
    }),
    z.object({
      decision: z.literal('drop'),
      rationale: z.string().max(REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH),
    }),
  ],
);

export type ReviewAssistanceMergeChoice = z.infer<
  typeof reviewAssistanceMergeChoiceSchema
>;

export type ReviewAssistanceRawCommand = z.infer<
  typeof reviewAssistanceRawCommandSchema
>;

export type ReviewAssistancePageOutput = z.infer<
  typeof reviewAssistancePageSchema
>;

/**
 * Sentinel written into a required enum field when the model omits it under
 * the flat schema. It is intentionally outside every command enum so the
 * deterministic validator rejects the command (`missing_required_field:*`)
 * instead of the engine silently inventing a plausible-but-wrong value. See
 * `flatCommandToRawCommand` and the validator's enum guards.
 */
export const REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL = '__missing__';

const FALLBACK_BBOX = { l: 0, t: 0, r: 0, b: 0 } as const;

/**
 * Flat command shape used for multi-op tasks. Instead of a discriminated
 * union (which emits an `anyOf` the smaller Gemini models reviewing these
 * pages frequently fail to satisfy — every observed `No object generated`
 * failure came from a multi-op union task, never from the single-op
 * `text_ocr_hanja`), every possible payload field is hoisted to one flat
 * object and made nullable. The model fills the fields its chosen `op` needs
 * and nulls the rest — no branch selection. `flatCommandToRawCommand`
 * (applied via `.transform`) folds the flat object back into the typed
 * discriminated-union command so the validator and runner are unchanged.
 */
// Op-specific fields are `.nullish()` (optional + nullable) so the model only
// emits the fields its chosen `op` needs and may omit the rest — emitting all
// ~25 fields with explicit nulls on every command would be its own source of
// schema-mismatch. `op` and `baseFields` stay required: the zero-failure
// single-op `text_ocr_hanja` proves the review model handles a required
// op + confidence/rationale/evidence object reliably.
const flatCommandFields = {
  op: reviewAssistanceCommandOpSchema,
  textRef: z.string().nullish(),
  text: z.string().nullish(),
  label: reviewAssistanceTextLabelSchema.nullish(),
  bbox: bboxSchema.nullish(),
  afterRef: z.string().nullish(),
  pageNo: z.number().int().nullish(),
  textRefs: z.array(z.string()).nullish(),
  keepRef: z.string().nullish(),
  parts: z.array(textPartSchema).nullish(),
  tableRef: z.string().nullish(),
  row: z.number().int().nullish(),
  col: z.number().int().nullish(),
  grid: z.array(z.array(tableCellSchema)).nullish(),
  caption: z.string().nullish(),
  sourceTableRef: z.string().nullish(),
  continuedTableRef: z.string().nullish(),
  relation: z
    .enum(['continues_on_next_page', 'continued_from_previous_page'])
    .nullish(),
  pictureRef: z.string().nullish(),
  imageUri: z.string().nullish(),
  regions: z.array(imageRegionSchema).nullish(),
  reason: z.string().nullish(),
  targetRef: z.string().nullish(),
  markerTextRef: z.string().nullish(),
  footnoteTextRef: z.string().nullish(),
  sourceRef: z.string().nullish(),
  position: z.enum(['before', 'after']).nullish(),
  ...baseFields,
} as const;

type FlatReviewAssistanceCommand = z.infer<
  z.ZodObject<typeof flatCommandFields>
>;

/**
 * Fold a flat command back into the typed discriminated-union command. Null
 * refs become `''` (self-rejecting via `target_ref_not_found`); null required
 * bboxes become a zero box (self-rejecting via the bbox order check); null
 * required enums become {@link REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL} (the
 * validator rejects with `missing_required_field:*`). Optional fields keep
 * their nullable contract. We never invent a plausible value for a field the
 * model left empty.
 */
function flatCommandToRawCommand(
  flat: FlatReviewAssistanceCommand,
): ReviewAssistanceRawCommand {
  const base = {
    confidence: flat.confidence,
    rationale: flat.rationale,
    evidence: flat.evidence,
  };
  const sentinelEnum = REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL;
  switch (flat.op) {
    case 'replaceText':
      return { op: 'replaceText', textRef: flat.textRef ?? '', text: flat.text ?? '', ...base };
    case 'addText':
      return {
        op: 'addText',
        bbox: flat.bbox ?? FALLBACK_BBOX,
        text: flat.text ?? '',
        label: flat.label ?? (sentinelEnum as ReviewAssistanceTextLabel),
        pageNo: flat.pageNo ?? null,
        afterRef: flat.afterRef ?? null,
        ...base,
      };
    case 'updateTextRole':
      return {
        op: 'updateTextRole',
        textRef: flat.textRef ?? '',
        label: flat.label ?? (sentinelEnum as ReviewAssistanceTextLabel),
        ...base,
      };
    case 'removeText':
      return { op: 'removeText', textRef: flat.textRef ?? '', ...base };
    case 'mergeTexts':
      return {
        op: 'mergeTexts',
        textRefs: flat.textRefs ?? [],
        text: flat.text ?? '',
        keepRef: flat.keepRef ?? '',
        ...base,
      };
    case 'splitText':
      return { op: 'splitText', textRef: flat.textRef ?? '', parts: flat.parts ?? [], ...base };
    case 'updateTableCell':
      return {
        op: 'updateTableCell',
        tableRef: flat.tableRef ?? '',
        row: flat.row ?? 0,
        col: flat.col ?? 0,
        text: flat.text ?? '',
        ...base,
      };
    case 'replaceTable':
      return {
        op: 'replaceTable',
        tableRef: flat.tableRef ?? '',
        grid: flat.grid ?? [],
        caption: flat.caption ?? null,
        ...base,
      };
    case 'linkContinuedTable':
      return {
        op: 'linkContinuedTable',
        sourceTableRef: flat.sourceTableRef ?? '',
        continuedTableRef: flat.continuedTableRef ?? '',
        relation:
          flat.relation ??
          (sentinelEnum as 'continues_on_next_page'),
        ...base,
      };
    case 'updatePictureCaption':
      return {
        op: 'updatePictureCaption',
        pictureRef: flat.pictureRef ?? '',
        caption: flat.caption ?? '',
        ...base,
      };
    case 'addPicture':
      return {
        op: 'addPicture',
        bbox: flat.bbox ?? FALLBACK_BBOX,
        imageUri: flat.imageUri ?? '',
        caption: flat.caption ?? null,
        pageNo: flat.pageNo ?? null,
        ...base,
      };
    case 'splitPicture':
      return { op: 'splitPicture', pictureRef: flat.pictureRef ?? '', regions: flat.regions ?? [], ...base };
    case 'hidePicture':
      return { op: 'hidePicture', pictureRef: flat.pictureRef ?? '', reason: flat.reason ?? '', ...base };
    case 'updateBbox':
      return { op: 'updateBbox', targetRef: flat.targetRef ?? '', bbox: flat.bbox ?? FALLBACK_BBOX, ...base };
    case 'linkFootnote':
      return {
        op: 'linkFootnote',
        markerTextRef: flat.markerTextRef ?? '',
        footnoteTextRef: flat.footnoteTextRef ?? '',
        ...base,
      };
    case 'moveNode':
      return {
        op: 'moveNode',
        sourceRef: flat.sourceRef ?? '',
        targetRef: flat.targetRef ?? '',
        position: flat.position ?? (sentinelEnum as 'before'),
        ...base,
      };
  }
}

/**
 * Build a page schema restricted to one task's allowed ops.
 *
 * - No/empty `allowedOps` → the full discriminated union (table-correction
 *   and tests still rely on this).
 * - Exactly one op → the strict single-object command schema. `text_ocr_hanja`
 *   is the only single-op task and is the control group with zero observed
 *   schema-mismatch failures, so it is deliberately left on the strict shape.
 * - Multiple ops → the {@link flatCommandFields} flat object. `op` stays an
 *   enum locked to `allowedOps`, so `task_op_not_allowed` remains structurally
 *   impossible while the `anyOf`-free shape is far easier for the review model
 *   to satisfy.
 */
export function buildReviewAssistancePageSchemaForOps(
  allowedOps: readonly ReviewAssistanceCommandOp[] | undefined,
) {
  if (!allowedOps || allowedOps.length === 0) {
    return reviewAssistancePageSchema;
  }
  const validOps = allowedOps.filter((op) => Boolean(COMMAND_SCHEMA_BY_OP[op]));
  if (validOps.length === 0) return reviewAssistancePageSchema;

  const commandSchema =
    validOps.length === 1
      ? COMMAND_SCHEMA_BY_OP[validOps[0]]
      : z
          .object({
            ...flatCommandFields,
            op: z.enum(
              validOps as unknown as [
                ReviewAssistanceCommandOp,
                ...ReviewAssistanceCommandOp[],
              ],
            ),
          })
          .transform(flatCommandToRawCommand);

  return z.object({
    pageNo: z.number().int().positive(),
    commands: z.array(commandSchema).max(80),
    pageNotes: z
      .array(z.string().max(REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH))
      .max(10),
  });
}
