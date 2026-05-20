import type { TableCorrectionContext } from '../processors/review-assistance/table-correction-context-builder';

/**
 * System prompt for the `tables` task. Mirrors the backoffice "AI 표 보정"
 * feature (`apps/backoffice/.../suggest-table-correction.server.ts`): the model
 * is handed the page image plus the full current grid and asked to return a
 * single corrected `{ grid, caption }`. The engine previously used the flat
 * command schema + sparse per-cell edits, which the same capable model handled
 * far worse than this direct grid shape. Structure is reconciled
 * deterministically afterwards (TableCorrectionRunner.carryOverTableStructure),
 * so the model's job is essentially "fix the cell text from the image".
 */
export const TABLE_CORRECTION_SYSTEM_PROMPT = `You are a table correction engine for Docling JSON produced from archaeological and cultural heritage report PDFs.

Analyze exactly one target table using the page image and the current table data below, then return the corrected table. Ground every change in what is visible in the page image.

You MUST respond with valid JSON only — no markdown, no code fences, no explanation — in exactly this shape:
{
  "grid": [[{ "text": <string>, "rowSpan": <int or null>, "colSpan": <int or null>, "columnHeader": <bool or null>, "rowHeader": <bool or null> }, ...], ...],
  "caption": <string or null>
}

Correction rules:
- Fix only the cell text that is wrong in the page image. Keep correct cells exactly as given, and do not invent values for genuinely blank cells.
- Preserve the table structure. Every row must have the same number of columns. For a merged cell, set rowSpan/colSpan on its master (top-left) cell AND keep every position it covers as a repeated placeholder ("shadow") cell with empty text, so the grid stays rectangular with the same dimensions as the current data.
- Mark header rows with columnHeader: true and header columns with rowHeader: true, matching the current data.
- Preserve the units (cm, mm, 점, …) and footnote markers (※, *, ¹, (1), …) that appear in the table.
- Use only the target table. Do not borrow rows or cells from other tables visible on the page.
- If the table already matches the page image, return the current grid unchanged.`;

export function buildTableCorrectionPrompt(
  context: TableCorrectionContext,
  options: {
    outputLanguage?: string;
    validationFeedback?: string[];
    attempt?: number;
  } = {},
): string {
  const outputLanguage = options.outputLanguage?.trim();
  const languagePrompt = outputLanguage
    ? `OUTPUT LANGUAGE: write corrected cell text and the caption in ${outputLanguage} when the source is in that language. Keep numbers, units, and footnote markers verbatim.`
    : undefined;
  const feedbackPrompt =
    options.validationFeedback && options.validationFeedback.length > 0
      ? [
          `VALIDATION FEEDBACK FOR ATTEMPT ${options.attempt ?? 2}:`,
          'Your previous response failed deterministic table validation. Fix only the listed issues and keep the grid rectangular with its structure preserved.',
          ...options.validationFeedback.map((reason) => `- ${reason}`),
        ].join('\n')
      : undefined;

  const target = context.targetTable;
  const captionLine = `Current caption: ${target.caption ?? '(none)'}`;
  const gridSection = target.fullGrid
    ? [
        'Current table data (JSON — one cell object per grid position, shadow cells included):',
        JSON.stringify(target.fullGrid),
      ].join('\n')
    : [
        'Current table preview (JSON — text only and possibly truncated; return a full corrected grid):',
        JSON.stringify(target.gridPreview),
      ].join('\n');

  return [
    TABLE_CORRECTION_SYSTEM_PROMPT,
    languagePrompt,
    feedbackPrompt,
    captionLine,
    gridSection,
  ]
    .filter(Boolean)
    .join('\n\n');
}
