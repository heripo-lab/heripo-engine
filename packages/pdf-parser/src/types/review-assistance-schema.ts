import { z } from 'zod/v4';

export const REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH = 200;
export const REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH = 2_000;
export const REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH = 200;

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

export const reviewAssistanceRawCommandSchema = z.object({
  op: reviewAssistanceCommandOpSchema,
  targetRef: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH),
  evidence: z.string().max(REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH).nullable(),
});

export const reviewAssistancePageSchema = z.object({
  pageNo: z.number().int().positive(),
  commands: z.array(reviewAssistanceRawCommandSchema).max(80),
  pageNotes: z
    .array(z.string().max(REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH))
    .max(10),
});

export type ReviewAssistanceCommandOp = z.infer<
  typeof reviewAssistanceCommandOpSchema
>;

export type ReviewAssistanceRawCommand = z.infer<
  typeof reviewAssistanceRawCommandSchema
>;

export type ReviewAssistancePageOutput = z.infer<
  typeof reviewAssistancePageSchema
>;
