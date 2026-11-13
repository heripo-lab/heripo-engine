import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';

/** A page is turned when the weight of its lines reading bottom to top exceeds all other lines by this factor. */
export const PAGE_ORIENTATION_UPWARD_RATIO = 2;
/** ...and is at least this many confidence-weighted characters, so a few sideways labels do not turn a page. */
export const PAGE_ORIENTATION_MIN_UPWARD_CHARS = 30;

/**
 * Reads every page with Apple Vision at 72 dpi and weighs each recognized line by its characters times confidence,
 * grouped by the direction its baseline runs (Vision reports the corners of a line in its reading orientation). A page
 * whose lines mostly read bottom to top, as a landscape table or figure printed sideways does, is turned a quarter
 * clockwise through its PDF rotation. Lines reading top to bottom are left alone, since vertical writing reads that
 * way too. When any page is turned, a copy is saved to the output path. Prints
 * `{"pages": n, "rotated": [one-based page numbers]}`.
 */
const SCRIPT = `
import json, sys
import objc, Vision
import pypdfium2 as pdfium
from ocrmac.ocrmac import pil2buf
source, target, languages, ratio, minimum = sys.argv[1], sys.argv[2], sys.argv[3].split(','), float(sys.argv[4]), float(sys.argv[5])
pdf = pdfium.PdfDocument(source)
rotated = []
for index in range(len(pdf)):
    page = pdf[index]
    image = page.render(scale=1).to_pil()
    width, height = image.size
    upward = other = 0.0
    with objc.autorelease_pool():
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(0)
        request.setRecognitionLanguages_(languages)
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(pil2buf(image), None)
        handler.performRequests_error_([request], None)
        for line in request.results() or []:
            text = line.topCandidates_(1)[0]
            weight = len(text.string().strip()) * text.confidence()
            if weight < 2:
                continue
            start, end = line.bottomLeft(), line.bottomRight()
            dx, dy = (end.x - start.x) * width, (end.y - start.y) * height
            if dy > abs(dx):
                upward += weight
            else:
                other += weight
    if upward >= minimum and upward > ratio * other:
        page.set_rotation((page.get_rotation() + 90) % 360)
        rotated.append(index + 1)
if rotated:
    pdf.save(target)
print(json.dumps({'pages': len(pdf), 'rotated': rotated}))
`;

export interface PageOrientationResult {
  /** Pages in the document. */
  pages: number;
  /** One-based page numbers turned a quarter clockwise in the saved copy; empty when no copy was saved. */
  rotatedPages: number[];
}

/**
 * Turns pages printed sideways (rotated landscape tables and figures) upright before Docling reads them, so layout and
 * table structure see upright text. Runs locally with the parser's Python environment.
 */
export class PageOrientationCorrector {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly pythonPath: string,
  ) {}

  /**
   * Detects sideways pages of `pdfPath` and, when there are any, saves an upright copy to `outputPath`. Returns null
   * when detection fails, so conversion goes on with the original PDF. Aborting `abortSignal` ends the detection
   * process and rejects with the abort error.
   */
  async correct(
    pdfPath: string,
    outputPath: string,
    languages: readonly string[],
    abortSignal?: AbortSignal,
  ): Promise<PageOrientationResult | null> {
    const result = await spawnAsync(
      this.pythonPath,
      [
        '-I',
        '-c',
        SCRIPT,
        pdfPath,
        outputPath,
        languages.join(','),
        String(PAGE_ORIENTATION_UPWARD_RATIO),
        String(PAGE_ORIENTATION_MIN_UPWARD_CHARS),
      ],
      { signal: abortSignal },
    ).catch((error: Error) => {
      if (abortSignal?.aborted) throw error;
      return { code: -1, stdout: '', stderr: error.message };
    });
    if (result.code !== 0) {
      this.logger.warn(
        '[PageOrientationCorrector] Page orientation detection failed; converting the original PDF:',
        result.stderr.trim(),
      );
      return null;
    }
    const output = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as {
      pages: number;
      rotated: number[];
    };
    this.logger.info(
      `[PageOrientationCorrector] ${output.rotated.length} of ${output.pages} pages turned upright${output.rotated.length ? `: ${output.rotated.join(', ')}` : ''}`,
    );
    return { pages: output.pages, rotatedPages: output.rotated };
  }
}
