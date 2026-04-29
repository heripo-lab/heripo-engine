import type { PageReviewContext } from '../processors/review-assistance/page-review-context-builder';

export const REVIEW_ASSISTANCE_SYSTEM_PROMPT = `You are a review assistance engine for Docling JSON produced from archaeological and cultural heritage report PDFs.

Analyze one page image together with the provided Docling refs and page context. Return only correction or review commands that are grounded in the image, text layer, or deterministic issue hints.

You MUST respond with valid JSON only. No markdown, no code fences, no explanation.

Output shape:
{
  "pageNo": number,
  "commands": [
    {
      "op": "replaceText" | "addText" | "updateTextRole" | "removeText" | "mergeTexts" | "splitText" | "updateTableCell" | "replaceTable" | "linkContinuedTable" | "updatePictureCaption" | "addPicture" | "splitPicture" | "hidePicture" | "updateBbox" | "linkFootnote" | "moveNode",
      "targetRef": string | null,
      "payload": object,
      "confidence": number,
      "rationale": string,
      "evidence": string | null
    }
  ],
  "pageNotes": string[]
}

Rules:
- Use only refs provided in the context for targetRef and ref payload fields.
- Compare OCR text with the page image and text layer. If the text layer is garbled, trust the image.
- Correct mixed-script OCR errors, including dropped CJK characters, mojibake, and phonetic substitutions when the image supports the correction.
- For table cell text errors, prefer updateTableCell. Use replaceTable only when the visible grid structure is clearly wrong.
- Suggest updatePictureCaption when a nearby caption is visible or already extracted but unlinked.
- If a caption remains as body text, connect it to the nearest matching table or picture; do not rewrite the caption text unless OCR is visibly wrong.
- Suggest moveNode for obvious reading-order mistakes inside the current page only.
- Suggest updateTextRole for repeated page headers, page footers, footnotes, and captions misclassified as body text.
- Suggest addText only when visible page text is missing from Docling and the bbox is clear.
- Suggest removeText only for clear duplicate, empty, or OCR-noise text.
- Suggest addPicture or splitPicture with page-coordinate bboxes when the page image clearly shows missing or combined pictures.
- Suggest updateBbox only when the existing bbox is clearly outside the visual element.
- Suggest linkContinuedTable only for adjacent-page tables with compatible columns, headers, or captions.
- Keep confidence conservative for delete, hide, merge, split, replaceTable, updateBbox, and continued-table commands.
- Keep payloads small and concrete. Do not include unrelated paragraphs as captions.`;

export function buildReviewAssistancePrompt(
  context: PageReviewContext,
): string {
  return [
    REVIEW_ASSISTANCE_SYSTEM_PROMPT,
    'PAGE CONTEXT JSON:',
    JSON.stringify(toPromptContext(context)),
  ].join('\n\n');
}

function toPromptContext(context: PageReviewContext): unknown {
  return {
    pageNo: context.pageNo,
    pageSize: context.pageSize,
    textBlocks: context.textBlocks.map((block) => ({
      ref: block.ref,
      label: block.label,
      text: block.text,
      bbox: block.bbox,
      textLayerReference: block.textLayerReference,
      previousRef: block.previousRef,
      nextRef: block.nextRef,
      repeatedAcrossPages: block.repeatedAcrossPages,
      suspectReasons: block.suspectReasons,
    })),
    tables: context.tables.map((table) => ({
      ref: table.ref,
      caption: table.caption,
      bbox: table.bbox,
      gridPreview: table.gridPreview,
      emptyCellRatio: table.emptyCellRatio,
      previousPageTableSummary: table.previousPageTableSummary,
      nextPageTableSummary: table.nextPageTableSummary,
      suspectReasons: table.suspectReasons,
    })),
    pictures: context.pictures.map((picture) => ({
      ref: picture.ref,
      caption: picture.caption,
      imageUri: picture.imageUri,
      bbox: picture.bbox,
      suspectReasons: picture.suspectReasons,
    })),
    orphanCaptions: context.orphanCaptions,
    footnotes: context.footnotes,
    layout: context.layout,
    domainPatterns: context.domainPatterns,
  };
}
