import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingBBox,
  DoclingBody,
  DoclingDocument,
  DoclingPictureItem,
  DoclingReference,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
  ReviewAssistanceCommand,
  ReviewAssistanceDecision,
  ReviewAssistanceImageRegion,
  ReviewAssistancePageResult,
  ReviewAssistanceTableCell,
} from '@heripo/model';

import type { PageReviewContext } from './page-review-context-builder';

import { ImageCropWriter } from './image-crop-writer';
import { ImageRegionSnapper } from './image-region-snapper';
import { OrphanCaptionResolver } from './orphan-caption-resolver';

export interface ReviewAssistancePatcherOptions {
  outputDir: string;
  contexts: PageReviewContext[];
}

export interface ReviewAssistancePatcherResult {
  doc: DoclingDocument;
  pages: ReviewAssistancePageResult[];
}

interface ContainerMatch {
  container: { self_ref: string; children: DoclingReference[] };
  index: number;
}

interface PatchMetadata {
  reasons?: string[];
  evidence?: ReviewAssistanceDecision['evidence'];
  metadata?: Record<string, unknown>;
}

const FURNITURE_LABELS = new Set(['page_header', 'page_footer']);

export class ReviewAssistancePatcher {
  private readonly snapper: ImageRegionSnapper;
  private readonly cropWriter: ImageCropWriter;
  private readonly captionResolver = new OrphanCaptionResolver();

  constructor(private readonly logger: LoggerMethods) {
    this.snapper = new ImageRegionSnapper(logger);
    this.cropWriter = new ImageCropWriter(logger);
  }

  async apply(
    doc: DoclingDocument,
    pages: ReviewAssistancePageResult[],
    options: ReviewAssistancePatcherOptions,
  ): Promise<ReviewAssistancePatcherResult> {
    const contexts = new Map(
      options.contexts.map((context) => [context.pageNo, context]),
    );
    const patchedPages: ReviewAssistancePageResult[] = [];

    for (const page of pages) {
      const context = contexts.get(page.pageNo);
      if (!context || page.status === 'failed') {
        patchedPages.push(page);
        continue;
      }

      const decisions: ReviewAssistanceDecision[] = [];
      for (const decision of page.decisions) {
        if (decision.disposition !== 'auto_applied' || !decision.command) {
          decisions.push(decision);
          continue;
        }

        const beforeCommand = this.cloneDoc(doc);
        try {
          const metadata = await this.applyCommand(
            doc,
            context,
            decision,
            options.outputDir,
          );
          decisions.push(this.withPatchMetadata(decision, metadata));
        } catch (error) {
          this.logger.warn(
            `[ReviewAssistancePatcher] Command ${decision.id} skipped`,
            error,
          );
          this.restoreDoc(doc, beforeCommand);
          decisions.push(
            this.skipDecision(
              decision,
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }

      patchedPages.push({ ...page, decisions });
    }

    return { doc, pages: patchedPages };
  }

  private async applyCommand(
    doc: DoclingDocument,
    context: PageReviewContext,
    decision: ReviewAssistanceDecision,
    outputDir: string,
  ): Promise<PatchMetadata> {
    const command = decision.command;
    if (!command) return {};

    switch (command.op) {
      case 'replaceText':
        this.applyReplaceText(doc, command);
        return {};
      case 'addText':
        return {
          evidence: {
            generatedRefs: [
              this.applyAddText(doc, command.pageNo, command.bbox, {
                text: command.text,
                label: command.label,
                afterRef: command.afterRef,
              }),
            ],
          },
        };
      case 'updateTextRole':
        this.applyUpdateTextRole(doc, command);
        return {};
      case 'removeText':
        this.removeRefFromContainers(doc, command.textRef);
        this.removeCaptionRefs(doc, command.textRef);
        return {};
      case 'mergeTexts':
        this.applyMergeTexts(doc, command);
        return {};
      case 'splitText':
        return {
          evidence: {
            generatedRefs: this.applySplitText(doc, command),
          },
        };
      case 'updateTableCell':
        this.applyUpdateTableCell(doc, command);
        return {};
      case 'replaceTable':
        return this.applyReplaceTable(doc, command);
      case 'linkContinuedTable':
        return {
          reasons: ['sidecar_metadata_only'],
          metadata: {
            continuedTable: {
              sourceTableRef: command.sourceTableRef,
              continuedTableRef: command.continuedTableRef,
              relation: command.relation,
            },
          },
        };
      case 'updatePictureCaption':
        return {
          evidence: {
            generatedRefs: [
              this.setPictureCaption(doc, command.pictureRef, command.caption),
            ],
          },
        };
      case 'addPicture':
        return await this.applyAddPicture(
          doc,
          context,
          decision.id,
          command,
          outputDir,
        );
      case 'splitPicture':
        return await this.applySplitPicture(
          doc,
          context,
          decision.id,
          command.pictureRef,
          command.regions,
          outputDir,
        );
      case 'hidePicture':
        this.removeRefFromContainers(doc, command.pictureRef);
        return {
          reasons: ['picture_hidden_from_reading_order'],
          metadata: {
            hiddenPicture: {
              pictureRef: command.pictureRef,
              reason: command.reason,
            },
          },
        };
      case 'updateBbox':
        return this.applyUpdateBbox(doc, command);
      case 'linkFootnote':
        this.applyUpdateTextRole(doc, {
          op: 'updateTextRole',
          textRef: command.footnoteTextRef,
          label: 'footnote',
        });
        return {
          reasons: ['footnote_link_sidecar_metadata_only'],
          metadata: {
            footnoteLink: {
              markerTextRef: command.markerTextRef,
              footnoteTextRef: command.footnoteTextRef,
            },
          },
        };
      case 'moveNode':
        this.applyMoveNode(doc, command);
        return {};
    }
  }

  private applyReplaceText(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'replaceText' }>,
  ): void {
    const text = this.resolveText(doc, command.textRef);
    if (!text) throw new Error('text_ref_not_found');
    text.text = command.text;
    text.orig = command.text;
  }

  private applyAddText(
    doc: DoclingDocument,
    pageNo: number,
    bbox: DoclingBBox,
    options: { text: string; label: string; afterRef?: string },
  ): string {
    const ref = `#/texts/${doc.texts.length}`;
    const parentRef = FURNITURE_LABELS.has(options.label)
      ? '#/furniture'
      : (this.findContainer(doc, options.afterRef ?? '')?.container.self_ref ??
        '#/body');
    const item: DoclingTextItem = {
      self_ref: ref,
      parent: { $ref: parentRef },
      children: [],
      content_layer: FURNITURE_LABELS.has(options.label) ? 'furniture' : 'body',
      label: options.label,
      prov: [
        {
          page_no: pageNo,
          bbox,
          charspan: [0, options.text.length],
        },
      ],
      orig: options.text,
      text: options.text,
    };
    doc.texts.push(item);
    this.insertRef(doc, ref, options.afterRef, parentRef);
    return ref;
  }

  private applyUpdateTextRole(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'updateTextRole' }>,
  ): void {
    const text = this.resolveText(doc, command.textRef);
    if (!text) throw new Error('text_ref_not_found');
    text.label = command.label;
    text.content_layer = FURNITURE_LABELS.has(command.label)
      ? 'furniture'
      : 'body';
    this.moveTextToLayerContainer(doc, command.textRef, command.label);
  }

  private applyMergeTexts(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'mergeTexts' }>,
  ): void {
    const keep = this.resolveText(doc, command.keepRef);
    if (!keep) throw new Error('merge_keep_ref_not_found');
    keep.text = command.text;
    keep.orig = command.text;
    for (const ref of command.textRefs) {
      if (ref !== command.keepRef) {
        this.removeRefFromContainers(doc, ref);
        this.removeCaptionRefs(doc, ref);
      }
    }
  }

  private applySplitText(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'splitText' }>,
  ): string[] {
    const text = this.resolveText(doc, command.textRef);
    if (!text) throw new Error('split_text_ref_not_found');
    const [first, ...rest] = command.parts;
    text.text = first.text;
    text.orig = first.text;
    if (first.label) {
      text.label = first.label;
    }

    const generatedRefs: string[] = [];
    let afterRef = command.textRef;
    for (const part of rest) {
      const ref = this.applyAddText(
        doc,
        text.prov[0]?.page_no ?? 1,
        text.prov[0]?.bbox ?? {
          l: 0,
          t: 0,
          r: 1,
          b: 1,
          coord_origin: 'TOPLEFT',
        },
        {
          text: part.text,
          label: part.label ?? text.label,
          afterRef,
        },
      );
      generatedRefs.push(ref);
      afterRef = ref;
    }
    return generatedRefs;
  }

  private applyUpdateTableCell(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'updateTableCell' }>,
  ): void {
    const table = this.resolveTable(doc, command.tableRef);
    if (!table) throw new Error('table_ref_not_found');

    const matchingCell = table.data.table_cells.find(
      (cell) =>
        cell.start_row_offset_idx === command.row &&
        cell.start_col_offset_idx === command.col,
    );
    if (matchingCell) {
      matchingCell.text = command.text;
    }

    const gridCell = table.data.grid[command.row]?.[command.col];
    if (gridCell) {
      gridCell.text = command.text;
    }
  }

  private applyReplaceTable(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'replaceTable' }>,
  ): PatchMetadata {
    const table = this.resolveTable(doc, command.tableRef);
    if (!table) throw new Error('table_ref_not_found');
    const { grid, tableCells } = this.buildTableData(table, command.grid);
    table.data = {
      grid,
      table_cells: tableCells,
      num_rows: grid.length,
      num_cols: grid[0]?.length ?? 0,
    };
    if (command.caption?.trim()) {
      const captionRef = this.setTableCaption(
        doc,
        command.tableRef,
        command.caption,
      );
      return { evidence: { generatedRefs: [captionRef] } };
    }
    return {};
  }

  private async applyAddPicture(
    doc: DoclingDocument,
    context: PageReviewContext,
    decisionId: string,
    command: Extract<ReviewAssistanceCommand, { op: 'addPicture' }>,
    outputDir: string,
  ): Promise<PatchMetadata> {
    const snapped = await this.snapper.snap(
      context.pageImagePath,
      context.pageSize,
      command.bbox,
    );
    const crop = await this.cropWriter.writeCrop({
      outputDir,
      pageNo: command.pageNo,
      pageImagePath: context.pageImagePath,
      pageSize: context.pageSize,
      bbox: snapped.snappedBbox,
      decisionId,
    });
    const pictureRef = this.appendPicture(
      doc,
      command.pageNo,
      snapped.snappedBbox,
      crop.imageUri,
    );
    this.insertByPagePosition(
      doc,
      pictureRef,
      command.pageNo,
      snapped.snappedBbox,
    );

    const generatedRefs = [pictureRef];
    if (command.caption?.trim()) {
      generatedRefs.push(
        this.setPictureCaption(doc, pictureRef, command.caption),
      );
    } else {
      generatedRefs.push(
        ...this.resolveOrphanCaptions(doc, context, [
          { ref: pictureRef, kind: 'picture', bbox: snapped.snappedBbox },
        ]),
      );
    }

    return {
      reasons: snapped.warnings,
      evidence: {
        snappedBbox: snapped.snappedBbox,
        generatedRefs,
      },
      metadata: {
        image: {
          source: snapped.source,
          originalBbox: snapped.originalBbox,
          imageUri: crop.imageUri,
          snapConfidence: snapped.confidence,
        },
      },
    };
  }

  private async applySplitPicture(
    doc: DoclingDocument,
    context: PageReviewContext,
    decisionId: string,
    sourcePictureRef: string,
    regions: ReviewAssistanceImageRegion[],
    outputDir: string,
  ): Promise<PatchMetadata> {
    const sourcePicture = this.resolvePicture(doc, sourcePictureRef);
    if (!sourcePicture) throw new Error('picture_ref_not_found');

    const generatedRefs: string[] = [];
    const pictureRefs: string[] = [];
    const snappedRegions: Array<Record<string, unknown>> = [];
    const preparedRegions: Array<{
      region: ReviewAssistanceImageRegion;
      snappedBbox: DoclingBBox;
      imageUri: string;
      snapMetadata: Record<string, unknown>;
    }> = [];
    const captionTargets: Array<{
      ref: string;
      kind: 'picture';
      bbox?: DoclingBBox;
      caption?: string;
    }> = [];

    for (const [index, region] of regions.entries()) {
      const snapped = await this.snapper.snap(
        context.pageImagePath,
        context.pageSize,
        region.bbox,
      );
      const crop = await this.cropWriter.writeCrop({
        outputDir,
        pageNo: context.pageNo,
        pageImagePath: context.pageImagePath,
        pageSize: context.pageSize,
        bbox: snapped.snappedBbox,
        decisionId,
        regionId: region.id ?? String(index + 1),
      });
      preparedRegions.push({
        region,
        snappedBbox: snapped.snappedBbox,
        imageUri: crop.imageUri,
        snapMetadata: {
          regionId: region.id,
          source: snapped.source,
          originalBbox: snapped.originalBbox,
          snappedBbox: snapped.snappedBbox,
          imageUri: crop.imageUri,
          warnings: snapped.warnings,
        },
      });
    }

    for (const prepared of preparedRegions) {
      const pictureRef = this.appendPicture(
        doc,
        context.pageNo,
        prepared.snappedBbox,
        prepared.imageUri,
      );
      pictureRefs.push(pictureRef);
      generatedRefs.push(pictureRef);
      captionTargets.push({
        ref: pictureRef,
        kind: 'picture',
        bbox: prepared.snappedBbox,
        caption: prepared.region.caption,
      });
      if (prepared.region.caption?.trim()) {
        generatedRefs.push(
          this.setPictureCaption(doc, pictureRef, prepared.region.caption),
        );
      }
      snappedRegions.push(prepared.snapMetadata);
    }

    const preservedCaptionRefs = this.preserveSourceCaptionRefs(
      doc,
      sourcePicture,
      pictureRefs,
    );
    generatedRefs.push(...preservedCaptionRefs);
    this.replaceRefInContainers(doc, sourcePictureRef, pictureRefs);
    generatedRefs.push(
      ...this.resolveOrphanCaptions(doc, context, captionTargets),
    );

    return {
      reasons: ['picture_split_replaced_source_in_reading_order'],
      evidence: { generatedRefs },
      metadata: {
        splitPicture: {
          sourcePictureRef,
          replacementRefs: generatedRefs.filter((ref) =>
            ref.startsWith('#/pictures/'),
          ),
          preservedCaptionRefs,
          regions: snappedRegions,
        },
      },
    };
  }

  private applyUpdateBbox(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'updateBbox' }>,
  ): PatchMetadata {
    const target = this.resolveProvTarget(doc, command.targetRef);
    if (!target) throw new Error('bbox_target_ref_not_found');
    const previousBbox = target.prov[0]?.bbox;
    if (!target.prov[0]) {
      target.prov.push({
        page_no: 1,
        bbox: command.bbox,
        charspan: [0, 0],
      });
    } else {
      target.prov[0].bbox = command.bbox;
    }
    return { evidence: { previousBbox } };
  }

  private applyMoveNode(
    doc: DoclingDocument,
    command: Extract<ReviewAssistanceCommand, { op: 'moveNode' }>,
  ): void {
    const source = this.findContainer(doc, command.sourceRef);
    const target = this.findContainer(doc, command.targetRef);
    if (!source || !target) throw new Error('move_ref_not_found');
    source.container.children.splice(source.index, 1);
    const targetIndex = target.container.children.findIndex(
      (child) => child.$ref === command.targetRef,
    );
    const insertAt =
      command.position === 'before' ? targetIndex : targetIndex + 1;
    target.container.children.splice(insertAt, 0, { $ref: command.sourceRef });
    this.setParent(doc, command.sourceRef, target.container.self_ref);
  }

  private buildTableData(
    table: DoclingTableItem,
    inputGrid: ReviewAssistanceTableCell[][],
  ): { grid: DoclingTableCell[][]; tableCells: DoclingTableCell[] } {
    const fallbackBbox = table.prov[0]?.bbox ?? {
      l: 0,
      t: 0,
      r: 1,
      b: 1,
      coord_origin: 'TOPLEFT',
    };
    const tableCells: DoclingTableCell[] = [];
    const grid = inputGrid.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const doclingCell: DoclingTableCell = {
          bbox: cell.bbox ?? fallbackBbox,
          row_span: cell.rowSpan ?? 1,
          col_span: cell.colSpan ?? 1,
          start_row_offset_idx: rowIndex,
          end_row_offset_idx: rowIndex + (cell.rowSpan ?? 1),
          start_col_offset_idx: colIndex,
          end_col_offset_idx: colIndex + (cell.colSpan ?? 1),
          text: cell.text,
          column_header: cell.columnHeader ?? false,
          row_header: cell.rowHeader ?? false,
          row_section: false,
          fillable: false,
        };
        tableCells.push(doclingCell);
        return doclingCell;
      }),
    );
    return { grid, tableCells };
  }

  private appendPicture(
    doc: DoclingDocument,
    pageNo: number,
    bbox: DoclingBBox,
    imageUri: string,
  ): string {
    const existing = this.findPictureByImageUri(doc, imageUri);
    if (existing) return existing;

    const ref = `#/pictures/${doc.pictures.length}`;
    const picture: DoclingPictureItem & {
      image?: { uri: string; mimetype: string };
    } = {
      self_ref: ref,
      parent: { $ref: '#/body' },
      children: [],
      content_layer: 'body',
      label: 'picture',
      prov: [
        {
          page_no: pageNo,
          bbox,
          charspan: [0, 0],
        },
      ],
      captions: [],
      references: [],
      footnotes: [],
      annotations: [],
      image: {
        uri: imageUri,
        mimetype: 'image/png',
      },
    };
    doc.pictures.push(picture);
    return ref;
  }

  private preserveSourceCaptionRefs(
    doc: DoclingDocument,
    sourcePicture: DoclingPictureItem,
    replacementRefs: string[],
  ): string[] {
    const captionRefs = sourcePicture.captions
      .map((caption) => caption.$ref)
      .filter((ref) => {
        const caption = this.resolveText(doc, ref);
        if (!caption) return false;
        caption.label = 'caption';
        return true;
      });
    if (captionRefs.length === 0) return [];
    if (replacementRefs.length === 0) return [];

    const targetPicture =
      replacementRefs
        .map((ref) => this.resolvePicture(doc, ref))
        .find((picture) => picture && picture.captions.length === 0) ??
      this.resolvePicture(doc, replacementRefs[0]);
    if (!targetPicture) return [];

    for (const ref of captionRefs) {
      targetPicture.captions = this.appendUniqueRef(
        targetPicture.captions,
        ref,
      );
    }
    return captionRefs;
  }

  private setPictureCaption(
    doc: DoclingDocument,
    pictureRef: string,
    caption: string,
  ): string {
    const picture = this.resolvePicture(doc, pictureRef);
    if (!picture) throw new Error('picture_ref_not_found');
    const existingRef = picture.captions[0]?.$ref;
    if (existingRef) {
      const existing = this.resolveText(doc, existingRef);
      if (existing) {
        existing.text = caption;
        existing.orig = caption;
        existing.label = 'caption';
        return existingRef;
      }
    }

    const captionRef = this.addCaptionText(
      doc,
      caption,
      picture.prov[0],
      pictureRef,
    );
    picture.captions = this.appendUniqueRef(picture.captions, captionRef);
    return captionRef;
  }

  private setTableCaption(
    doc: DoclingDocument,
    tableRef: string,
    caption: string,
  ): string {
    const table = this.resolveTable(doc, tableRef);
    if (!table) throw new Error('table_ref_not_found');
    const existingRef = table.captions[0]?.$ref;
    if (existingRef) {
      const existing = this.resolveText(doc, existingRef);
      if (existing) {
        existing.text = caption;
        existing.orig = caption;
        existing.label = 'caption';
        return existingRef;
      }
    }

    const captionRef = this.addCaptionText(
      doc,
      caption,
      table.prov[0],
      tableRef,
    );
    table.captions = this.appendUniqueRef(table.captions, captionRef);
    return captionRef;
  }

  private addCaptionText(
    doc: DoclingDocument,
    caption: string,
    prov: { page_no: number; bbox: DoclingBBox } | undefined,
    afterRef: string,
  ): string {
    return this.applyAddText(
      doc,
      prov?.page_no ?? 1,
      prov?.bbox ?? { l: 0, t: 0, r: 1, b: 1, coord_origin: 'TOPLEFT' },
      {
        text: caption,
        label: 'caption',
        afterRef,
      },
    );
  }

  private resolveOrphanCaptions(
    doc: DoclingDocument,
    context: PageReviewContext,
    targets: Array<{
      ref: string;
      kind: 'picture' | 'table';
      bbox?: DoclingBBox;
      caption?: string;
    }>,
  ): string[] {
    const generatedRefs: string[] = [];
    for (const resolution of this.captionResolver.resolve(context, targets)) {
      const caption = this.resolveText(doc, resolution.captionRef);
      if (!caption) continue;
      caption.label = 'caption';
      const picture = this.resolvePicture(doc, resolution.targetRef);
      const table = this.resolveTable(doc, resolution.targetRef);
      if (picture) {
        picture.captions = this.appendUniqueRef(
          picture.captions,
          resolution.captionRef,
        );
      }
      if (table) {
        table.captions = this.appendUniqueRef(
          table.captions,
          resolution.captionRef,
        );
      }
      generatedRefs.push(resolution.captionRef);
    }
    return generatedRefs;
  }

  private insertByPagePosition(
    doc: DoclingDocument,
    ref: string,
    pageNo: number,
    bbox: DoclingBBox,
  ): void {
    if (this.findContainer(doc, ref)) return;
    const children = doc.body.children;
    const top = this.bboxTop(bbox, this.getPageSize(doc, pageNo));
    const insertIndex = children.findIndex((child) => {
      const target = this.resolveProvTarget(doc, child.$ref);
      if (!target?.prov[0] || target.prov[0].page_no !== pageNo) return false;
      return (
        this.bboxTop(target.prov[0].bbox, this.getPageSize(doc, pageNo)) > top
      );
    });
    const index = insertIndex >= 0 ? insertIndex : children.length;
    children.splice(index, 0, { $ref: ref });
    this.setParent(doc, ref, '#/body');
  }

  private insertRef(
    doc: DoclingDocument,
    ref: string,
    afterRef: string | undefined,
    parentRef: string,
  ): void {
    const parent = this.resolveContainer(doc, parentRef) ?? doc.body;
    const afterIndex = afterRef
      ? parent.children.findIndex((child) => child.$ref === afterRef)
      : -1;
    parent.children.splice(
      afterIndex >= 0 ? afterIndex + 1 : parent.children.length,
      0,
      {
        $ref: ref,
      },
    );
    this.setParent(doc, ref, parent.self_ref);
  }

  private moveTextToLayerContainer(
    doc: DoclingDocument,
    textRef: string,
    label: string,
  ): void {
    const target = FURNITURE_LABELS.has(label) ? doc.furniture : doc.body;
    const current = this.findContainer(doc, textRef);
    if (current?.container.self_ref === target.self_ref) return;
    this.removeRefFromContainers(doc, textRef);
    target.children.push({ $ref: textRef });
    this.setParent(doc, textRef, target.self_ref);
  }

  private replaceRefInContainers(
    doc: DoclingDocument,
    ref: string,
    replacements: string[],
  ): void {
    let replaced = false;
    for (const container of this.getContainers(doc)) {
      const index = container.children.findIndex((child) => child.$ref === ref);
      if (index < 0) continue;
      container.children.splice(
        index,
        1,
        ...replacements.map((replacement) => ({ $ref: replacement })),
      );
      replacements.forEach((replacement) =>
        this.setParent(doc, replacement, container.self_ref),
      );
      replaced = true;
    }
    if (!replaced) {
      replacements.forEach((replacement) => {
        doc.body.children.push({ $ref: replacement });
        this.setParent(doc, replacement, '#/body');
      });
    }
  }

  private removeRefFromContainers(doc: DoclingDocument, ref: string): void {
    for (const container of this.getContainers(doc)) {
      container.children = container.children.filter(
        (child) => child.$ref !== ref,
      );
    }
  }

  private removeCaptionRefs(doc: DoclingDocument, ref: string): void {
    for (const picture of doc.pictures) {
      picture.captions = picture.captions.filter(
        (caption) => caption.$ref !== ref,
      );
    }
    for (const table of doc.tables) {
      table.captions = table.captions.filter((caption) => caption.$ref !== ref);
    }
  }

  private findContainer(
    doc: DoclingDocument,
    ref: string,
  ): ContainerMatch | undefined {
    for (const container of this.getContainers(doc)) {
      const index = container.children.findIndex((child) => child.$ref === ref);
      if (index >= 0) return { container, index };
    }
    return undefined;
  }

  private resolveContainer(
    doc: DoclingDocument,
    ref: string,
  ): DoclingBody | undefined {
    if (ref === '#/body') return doc.body;
    if (ref === '#/furniture') return doc.furniture;
    const match = ref.match(/^#\/groups\/(\d+)$/);
    if (!match) return undefined;
    return doc.groups[Number(match[1])] as DoclingBody | undefined;
  }

  private getContainers(
    doc: DoclingDocument,
  ): Array<{ self_ref: string; children: DoclingReference[] }> {
    return [doc.body, doc.furniture, ...doc.groups];
  }

  private resolveText(
    doc: DoclingDocument,
    ref: string,
  ): DoclingTextItem | undefined {
    const index = this.refIndex(ref, 'texts');
    return index === undefined ? undefined : doc.texts[index];
  }

  private resolveTable(
    doc: DoclingDocument,
    ref: string,
  ): DoclingTableItem | undefined {
    const index = this.refIndex(ref, 'tables');
    return index === undefined ? undefined : doc.tables[index];
  }

  private resolvePicture(
    doc: DoclingDocument,
    ref: string,
  ): DoclingPictureItem | undefined {
    const index = this.refIndex(ref, 'pictures');
    return index === undefined ? undefined : doc.pictures[index];
  }

  private resolveProvTarget(
    doc: DoclingDocument,
    ref: string,
  ): DoclingTextItem | DoclingTableItem | DoclingPictureItem | undefined {
    return (
      this.resolveText(doc, ref) ??
      this.resolveTable(doc, ref) ??
      this.resolvePicture(doc, ref)
    );
  }

  private setParent(
    doc: DoclingDocument,
    ref: string,
    parentRef: string,
  ): void {
    const item = this.resolveProvTarget(doc, ref);
    if (item) {
      item.parent = { $ref: parentRef };
    }
  }

  private appendUniqueRef(
    refs: DoclingReference[],
    ref: string,
  ): DoclingReference[] {
    return refs.some((entry) => entry.$ref === ref)
      ? refs
      : [...refs, { $ref: ref }];
  }

  private findPictureByImageUri(
    doc: DoclingDocument,
    imageUri: string,
  ): string | undefined {
    const index = doc.pictures.findIndex((picture) => {
      const image = (picture as unknown as { image?: { uri?: string } }).image;
      return image?.uri === imageUri;
    });
    return index >= 0 ? `#/pictures/${index}` : undefined;
  }

  private getPageSize(
    doc: DoclingDocument,
    pageNo: number,
  ): { width: number; height: number } | null {
    return (
      Object.values(doc.pages).find((page) => page.page_no === pageNo)?.size ??
      null
    );
  }

  private bboxTop(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
  ): number {
    if (bbox.coord_origin === 'BOTTOMLEFT' && pageSize) {
      return pageSize.height - Math.max(bbox.t, bbox.b);
    }
    return Math.min(bbox.t, bbox.b);
  }

  private refIndex(ref: string, collection: string): number | undefined {
    const match = ref.match(new RegExp(`^#/${collection}/(\\d+)$`));
    if (!match) return undefined;
    const index = Number(match[1]);
    return Number.isInteger(index) ? index : undefined;
  }

  private withPatchMetadata(
    decision: ReviewAssistanceDecision,
    metadata: PatchMetadata,
  ): ReviewAssistanceDecision {
    return {
      ...decision,
      reasons: [...decision.reasons, ...(metadata.reasons ?? [])],
      evidence: {
        ...decision.evidence,
        ...metadata.evidence,
      },
      metadata: metadata.metadata
        ? { ...decision.metadata, ...metadata.metadata }
        : decision.metadata,
    };
  }

  private skipDecision(
    decision: ReviewAssistanceDecision,
    reason: string,
  ): ReviewAssistanceDecision {
    return {
      ...decision,
      disposition: 'skipped',
      reasons: [...decision.reasons, `patch_skipped: ${reason}`],
    };
  }

  private cloneDoc(doc: DoclingDocument): DoclingDocument {
    return JSON.parse(JSON.stringify(doc)) as DoclingDocument;
  }

  private restoreDoc(target: DoclingDocument, snapshot: DoclingDocument): void {
    for (const key of Object.keys(target)) {
      delete (target as unknown as Record<string, unknown>)[key];
    }
    Object.assign(target, snapshot);
  }
}
