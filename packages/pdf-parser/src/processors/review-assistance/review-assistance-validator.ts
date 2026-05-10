import type {
  DoclingBBox,
  ReviewAssistanceCommand,
  ReviewAssistanceDecision,
  ReviewAssistanceDecisionEvidence,
  ReviewAssistanceDisposition,
  ReviewAssistanceImageRegion,
  ReviewAssistanceTableCell,
} from '@heripo/model';

import type {
  ReviewAssistancePageOutput,
  ReviewAssistanceRawCommand,
} from '../../types/review-assistance-schema';
import type { PageReviewContext } from './page-review-context-builder';

import { createHash } from 'node:crypto';

const TRUSTED_VLM_AUTO_APPLY_THRESHOLD = 0.7;

export interface ReviewAssistanceValidatorOptions {
  autoApplyThreshold: number;
  proposalThreshold: number;
  allowAutoApply?: boolean;
}

export class ReviewAssistanceValidator {
  validatePageOutput(
    context: PageReviewContext,
    output: ReviewAssistancePageOutput,
    options: ReviewAssistanceValidatorOptions,
  ): ReviewAssistanceDecision[] {
    const refs = this.buildRefSet(context);
    const touchedRefs = new Set<string>();
    const pageReasons =
      output.pageNo === context.pageNo ? [] : ['page_number_mismatch'];

    return output.commands.map((rawCommand) => {
      const validation = this.validateCommand(
        context,
        rawCommand,
        refs,
        touchedRefs,
      );
      const valid = validation.valid && pageReasons.length === 0;
      const validationReasons = [...pageReasons, ...validation.reasons];
      const confidence = valid
        ? this.computeFinalConfidence(context, rawCommand, validation.command)
        : rawCommand.confidence;
      const autoApplyThreshold = valid
        ? this.getEffectiveAutoApplyThreshold(
            context,
            validation.command,
            options.autoApplyThreshold,
          )
        : options.autoApplyThreshold;
      const autoApplyBlockReason =
        valid && confidence >= autoApplyThreshold
          ? this.getAutoApplyBlockReason(context, validation.command)
          : undefined;
      const disposition = this.getDisposition(
        valid,
        confidence,
        { ...options, autoApplyThreshold },
        autoApplyBlockReason,
      );

      if (valid) {
        validation.touchedRefs?.forEach((ref) => touchedRefs.add(ref));
      }

      return {
        id: this.buildDecisionId(
          context.pageNo,
          rawCommand,
          validation.command,
        ),
        pageNo: context.pageNo,
        command: validation.command,
        invalidOp: validation.command ? undefined : rawCommand.op,
        confidence,
        disposition,
        reasons: this.buildReasons(rawCommand, validationReasons, disposition, {
          autoApplyEnabled: options.allowAutoApply === true,
          belowAutoApplyThreshold: confidence < autoApplyThreshold,
          autoApplyBlockReason,
        }),
        evidence: this.buildEvidence(context, rawCommand, validation.command),
      };
    });
  }

  private validateCommand(
    context: PageReviewContext,
    rawCommand: ReviewAssistanceRawCommand,
    refs: RefSet,
    touchedRefs: Set<string>,
  ): {
    valid: boolean;
    reasons: string[];
    command?: ReviewAssistanceCommand;
    touchedRefs?: string[];
  } {
    const reasons: string[] = [];
    const command = this.toCommand(context, rawCommand, reasons);
    if (!command) {
      return { valid: false, reasons };
    }

    const ownTouchedRefs = this.getOwnedTouchedRefs(command);
    for (const ref of ownTouchedRefs) {
      if (!this.refExistsForCommand(command, ref, refs)) {
        reasons.push('target_ref_not_found');
      }
      if (touchedRefs.has(ref)) {
        reasons.push('target_already_modified');
      }
    }

    this.validateCommandShape(context, command, refs, reasons);

    return {
      valid: reasons.length === 0,
      reasons,
      command,
      touchedRefs: ownTouchedRefs,
    };
  }

  private toCommand(
    context: PageReviewContext,
    rawCommand: ReviewAssistanceRawCommand,
    reasons: string[],
  ): ReviewAssistanceCommand | undefined {
    const payload = rawCommand.payload;
    const targetRef = rawCommand.targetRef ?? undefined;

    switch (rawCommand.op) {
      case 'replaceText': {
        const textRef = this.stringValue(payload.textRef) ?? targetRef;
        const text =
          this.stringValue(payload.text) ??
          this.replacementTextFromEvidence(
            context,
            textRef,
            rawCommand.evidence,
          );
        if (text !== undefined && !this.stringValue(payload.text)) {
          reasons.push('replace_text_payload_recovered_from_evidence');
        }
        if (!textRef || text === undefined) {
          reasons.push('invalid_replace_text_payload');
          return undefined;
        }
        return { op: 'replaceText', textRef, text };
      }
      case 'addText': {
        const bbox = this.bboxValue(payload.bbox);
        const text = this.stringValue(payload.text);
        const label = this.stringValue(payload.label) ?? 'text';
        if (!bbox || text === undefined) {
          reasons.push('invalid_add_text_payload');
          return undefined;
        }
        return {
          op: 'addText',
          pageNo: this.numberValue(payload.pageNo) ?? context.pageNo,
          bbox,
          text,
          label,
          afterRef: this.stringValue(payload.afterRef),
        };
      }
      case 'updateTextRole': {
        const textRef = this.stringValue(payload.textRef) ?? targetRef;
        const label = this.stringValue(payload.label);
        if (!textRef || !label) {
          reasons.push('invalid_update_text_role_payload');
          return undefined;
        }
        return { op: 'updateTextRole', textRef, label };
      }
      case 'removeText': {
        const textRef = this.stringValue(payload.textRef) ?? targetRef;
        if (!textRef) {
          reasons.push('invalid_remove_text_payload');
          return undefined;
        }
        return { op: 'removeText', textRef };
      }
      case 'mergeTexts': {
        const textRefs = this.stringArrayValue(payload.textRefs);
        const text = this.stringValue(payload.text);
        const keepRef = this.stringValue(payload.keepRef);
        if (textRefs.length < 2 || text === undefined || !keepRef) {
          reasons.push('invalid_merge_texts_payload');
          return undefined;
        }
        return { op: 'mergeTexts', textRefs, text, keepRef };
      }
      case 'splitText': {
        const textRef = this.stringValue(payload.textRef) ?? targetRef;
        const parts = this.textPartsValue(payload.parts);
        if (!textRef || parts.length < 2) {
          reasons.push('invalid_split_text_payload');
          return undefined;
        }
        return { op: 'splitText', textRef, parts };
      }
      case 'updateTableCell': {
        const tableRef = this.stringValue(payload.tableRef) ?? targetRef;
        const row = this.numberValue(payload.row);
        const col = this.numberValue(payload.col);
        const text = this.stringValue(payload.text);
        if (
          !tableRef ||
          row === undefined ||
          col === undefined ||
          text === undefined
        ) {
          reasons.push('invalid_update_table_cell_payload');
          return undefined;
        }
        return { op: 'updateTableCell', tableRef, row, col, text };
      }
      case 'replaceTable': {
        const tableRef = this.stringValue(payload.tableRef) ?? targetRef;
        const grid = this.tableGridValue(payload.grid);
        if (!tableRef || grid.length === 0) {
          reasons.push('invalid_replace_table_payload');
          return undefined;
        }
        return {
          op: 'replaceTable',
          tableRef,
          grid,
          caption: this.stringValue(payload.caption),
        };
      }
      case 'linkContinuedTable': {
        const sourceTableRef =
          this.stringValue(payload.sourceTableRef) ?? targetRef;
        const continuedTableRef = this.stringValue(payload.continuedTableRef);
        const relation = this.stringValue(payload.relation);
        if (
          !sourceTableRef ||
          !continuedTableRef ||
          (relation !== 'continues_on_next_page' &&
            relation !== 'continued_from_previous_page')
        ) {
          reasons.push('invalid_link_continued_table_payload');
          return undefined;
        }
        return {
          op: 'linkContinuedTable',
          sourceTableRef,
          continuedTableRef,
          relation,
        };
      }
      case 'updatePictureCaption': {
        const pictureRef = this.stringValue(payload.pictureRef) ?? targetRef;
        const caption = this.stringValue(payload.caption);
        if (!pictureRef || caption === undefined) {
          reasons.push('invalid_update_picture_caption_payload');
          return undefined;
        }
        return { op: 'updatePictureCaption', pictureRef, caption };
      }
      case 'addPicture': {
        const bbox = this.bboxValue(payload.bbox);
        if (!bbox) {
          reasons.push('invalid_add_picture_payload');
          return undefined;
        }
        return {
          op: 'addPicture',
          pageNo: this.numberValue(payload.pageNo) ?? context.pageNo,
          bbox,
          imageUri: this.stringValue(payload.imageUri) ?? '',
          caption: this.stringValue(payload.caption),
        };
      }
      case 'splitPicture': {
        const pictureRef = this.stringValue(payload.pictureRef) ?? targetRef;
        const regions = this.imageRegionsValue(payload.regions);
        if (!pictureRef || regions.length < 2) {
          reasons.push('invalid_split_picture_payload');
          return undefined;
        }
        return { op: 'splitPicture', pictureRef, regions };
      }
      case 'hidePicture': {
        const pictureRef = this.stringValue(payload.pictureRef) ?? targetRef;
        const reason = this.stringValue(payload.reason);
        if (!pictureRef || !reason) {
          reasons.push('invalid_hide_picture_payload');
          return undefined;
        }
        return { op: 'hidePicture', pictureRef, reason };
      }
      case 'updateBbox': {
        const target = this.stringValue(payload.targetRef) ?? targetRef;
        const bbox = this.bboxValue(payload.bbox);
        if (!target || !bbox) {
          reasons.push('invalid_update_bbox_payload');
          return undefined;
        }
        return { op: 'updateBbox', targetRef: target, bbox };
      }
      case 'linkFootnote': {
        const markerTextRef = this.stringValue(payload.markerTextRef);
        const footnoteTextRef = this.stringValue(payload.footnoteTextRef);
        if (!markerTextRef || !footnoteTextRef) {
          reasons.push('invalid_link_footnote_payload');
          return undefined;
        }
        return { op: 'linkFootnote', markerTextRef, footnoteTextRef };
      }
      case 'moveNode': {
        const sourceRef = this.stringValue(payload.sourceRef) ?? targetRef;
        const moveTargetRef = this.stringValue(payload.targetRef);
        const position = this.stringValue(payload.position);
        if (
          !sourceRef ||
          !moveTargetRef ||
          (position !== 'before' && position !== 'after')
        ) {
          reasons.push('invalid_move_node_payload');
          return undefined;
        }
        return {
          op: 'moveNode',
          sourceRef,
          targetRef: moveTargetRef,
          position,
        };
      }
    }
  }

  private validateCommandShape(
    context: PageReviewContext,
    command: ReviewAssistanceCommand,
    refs: RefSet,
    reasons: string[],
  ): void {
    switch (command.op) {
      case 'replaceText':
        this.validateTextReplacement(
          context,
          command.textRef,
          command.text,
          reasons,
        );
        break;
      case 'addText':
        this.validatePageNumber(context, command.pageNo, reasons);
        this.validateBbox(context, command.bbox, reasons);
        break;
      case 'removeText':
        this.validateRemoveText(context, command.textRef, reasons);
        break;
      case 'mergeTexts':
        command.textRefs.forEach((ref) =>
          this.validateTextRef(ref, refs, reasons),
        );
        if (!command.textRefs.includes(command.keepRef)) {
          reasons.push('merge_keep_ref_not_in_text_refs');
          this.validateTextRef(command.keepRef, refs, reasons);
        }
        break;
      case 'splitText':
        this.validateSplitText(
          context,
          command.textRef,
          command.parts,
          reasons,
        );
        break;
      case 'updateTableCell':
        this.validateTableCell(
          context,
          command.tableRef,
          command.row,
          command.col,
          reasons,
        );
        break;
      case 'replaceTable':
        this.validateTableGrid(command.grid, reasons);
        break;
      case 'linkContinuedTable':
        this.validateTableRef(command.sourceTableRef, refs, reasons);
        this.validateTableRef(command.continuedTableRef, refs, reasons, {
          allowAdjacent: true,
        });
        break;
      case 'updatePictureCaption':
        this.validateCaptionText(command.caption, reasons);
        break;
      case 'addPicture':
        this.validatePageNumber(context, command.pageNo, reasons);
        this.validateBbox(context, command.bbox, reasons);
        break;
      case 'splitPicture':
        command.regions.forEach((region) =>
          this.validateBbox(context, region.bbox, reasons),
        );
        this.validateSplitRegions(command.regions, reasons);
        break;
      case 'updateBbox':
        if (!this.refExists(command.targetRef, refs)) {
          reasons.push('bbox_target_ref_not_found');
        }
        this.validateBbox(context, command.bbox, reasons);
        break;
      case 'linkFootnote':
        this.validateTextRef(command.markerTextRef, refs, reasons);
        this.validateTextRef(command.footnoteTextRef, refs, reasons);
        break;
      case 'moveNode':
        if (!this.refExists(command.sourceRef, refs)) {
          reasons.push('move_source_ref_not_found');
        }
        if (!this.refExists(command.targetRef, refs)) {
          reasons.push('move_target_ref_not_found');
        }
        if (command.sourceRef === command.targetRef) {
          reasons.push('move_self_reference');
        }
        break;
      case 'updateTextRole':
      case 'hidePicture':
        break;
    }
  }

  private computeFinalConfidence(
    context: PageReviewContext,
    rawCommand: ReviewAssistanceRawCommand,
    command?: ReviewAssistanceCommand,
  ): number {
    const riskPenalty = command ? this.getRiskPenalty(context, command) : 0;
    return Math.max(0, Math.min(1, rawCommand.confidence - riskPenalty));
  }

  private getEffectiveAutoApplyThreshold(
    context: PageReviewContext,
    command: ReviewAssistanceCommand | undefined,
    defaultThreshold: number,
  ): number {
    if (
      this.isHanjaCorrectionCommand(context, command) ||
      this.isPictureInternalTextRemoval(context, command)
    ) {
      return Math.min(defaultThreshold, TRUSTED_VLM_AUTO_APPLY_THRESHOLD);
    }
    return defaultThreshold;
  }

  private getDisposition(
    valid: boolean,
    confidence: number,
    options: ReviewAssistanceValidatorOptions,
    autoApplyBlockReason?: string,
  ): ReviewAssistanceDisposition {
    if (!valid || confidence < options.proposalThreshold) {
      return 'skipped';
    }
    if (
      options.allowAutoApply &&
      confidence >= options.autoApplyThreshold &&
      !autoApplyBlockReason
    ) {
      return 'auto_applied';
    }
    return 'proposal';
  }

  private buildReasons(
    rawCommand: ReviewAssistanceRawCommand,
    validationReasons: string[],
    disposition: ReviewAssistanceDisposition,
    options: {
      autoApplyEnabled: boolean;
      belowAutoApplyThreshold: boolean;
      autoApplyBlockReason?: string;
    },
  ): string[] {
    const reasons = [
      rawCommand.rationale,
      ...validationReasons,
      ...(rawCommand.evidence ? [`evidence: ${rawCommand.evidence}`] : []),
    ].filter(Boolean);
    if (disposition === 'proposal') {
      if (!options.autoApplyEnabled) {
        reasons.push('auto_apply_disabled');
      } else if (options.belowAutoApplyThreshold) {
        reasons.push('below_auto_apply_threshold');
      } else if (options.autoApplyBlockReason) {
        reasons.push(options.autoApplyBlockReason);
      }
    }
    if (disposition === 'auto_applied') {
      reasons.push('auto_apply_pending_patcher_phase');
    }
    return reasons;
  }

  private getAutoApplyBlockReason(
    context: PageReviewContext,
    command?: ReviewAssistanceCommand,
  ): string | undefined {
    if (!command) return 'auto_apply_requires_valid_command';
    switch (command.op) {
      case 'replaceText':
      case 'updateTextRole':
      case 'updateTableCell':
      case 'updatePictureCaption':
        // Localized text/cell mutations: validation already guards against
        // invalid refs and excessive deletion, so no extra block reason.
        return undefined;
      case 'removeText':
        // validateRemoveText enforces deterministic suspect reasons before
        // a removal is considered valid; no further block needed here.
        return undefined;
      case 'addText':
        return this.missingTextMatches(context, command.text)
          ? undefined
          : 'add_text_requires_missing_text_candidate';
      case 'updateBbox':
        return context.layout.bboxWarnings.some(
          (warning) => warning.targetRef === command.targetRef,
        )
          ? undefined
          : 'update_bbox_requires_bbox_warning';
      case 'linkFootnote':
        return this.isFootnoteCandidate(context, command.footnoteTextRef)
          ? undefined
          : 'link_footnote_requires_footnote_candidate';
      case 'moveNode':
        return this.moveNodeImprovesReadingOrder(context, command)
          ? undefined
          : 'move_node_requires_visual_order_improvement';
      case 'addPicture':
      case 'splitPicture':
      case 'hidePicture':
      case 'mergeTexts':
      case 'splitText':
      case 'replaceTable':
      case 'linkContinuedTable':
        return 'structural_command_requires_manual_review';
    }
  }

  private buildEvidence(
    context: PageReviewContext,
    rawCommand: ReviewAssistanceRawCommand,
    command?: ReviewAssistanceCommand,
  ): ReviewAssistanceDecisionEvidence | undefined {
    const targetRef = command
      ? this.getPrimaryTargetRef(command)
      : rawCommand.targetRef;
    const suspectReasons = targetRef
      ? this.getSuspectReasons(context, targetRef)
      : [];

    if (!rawCommand.evidence && suspectReasons.length === 0) {
      return undefined;
    }

    return {
      imageEvidence: rawCommand.evidence ?? undefined,
      suspectReasons: suspectReasons.length > 0 ? suspectReasons : undefined,
    };
  }

  private buildRefSet(context: PageReviewContext): RefSet {
    const adjacentTables = new Set(
      context.tables.flatMap((table) => [
        ...(table.previousPageTableRefs ?? []),
        ...(table.nextPageTableRefs ?? []),
      ]),
    );
    return {
      texts: new Set(context.textBlocks.map((block) => block.ref)),
      tables: new Set(context.tables.map((table) => table.ref)),
      adjacentTables,
      pictures: new Set(context.pictures.map((picture) => picture.ref)),
    };
  }

  private getPrimaryTargetRef(
    command: ReviewAssistanceCommand,
  ): string | undefined {
    return this.getOwnedTouchedRefs(command)[0];
  }

  private getOwnedTouchedRefs(command: ReviewAssistanceCommand): string[] {
    switch (command.op) {
      case 'replaceText':
      case 'updateTextRole':
      case 'removeText':
      case 'splitText':
        return [command.textRef];
      case 'mergeTexts':
        return [command.keepRef];
      case 'updateTableCell':
      case 'replaceTable':
        return [command.tableRef];
      case 'linkContinuedTable':
        // continuedTableRef may live on an adjacent page; its existence is
        // checked by validateCommandShape with allowAdjacent.
        return [command.sourceTableRef];
      case 'updatePictureCaption':
      case 'splitPicture':
      case 'hidePicture':
        return [command.pictureRef];
      case 'updateBbox':
        return [command.targetRef];
      case 'linkFootnote':
        return [command.markerTextRef, command.footnoteTextRef];
      case 'moveNode':
        return [command.sourceRef];
      case 'addText':
      case 'addPicture':
        return [];
    }
  }

  private refExistsForCommand(
    command: ReviewAssistanceCommand,
    ref: string,
    refs: RefSet,
  ): boolean {
    if (
      command.op === 'replaceText' ||
      command.op === 'updateTextRole' ||
      command.op === 'removeText' ||
      command.op === 'mergeTexts' ||
      command.op === 'splitText' ||
      command.op === 'linkFootnote'
    ) {
      return refs.texts.has(ref);
    }
    if (command.op === 'updateTableCell' || command.op === 'replaceTable') {
      return refs.tables.has(ref);
    }
    if (command.op === 'linkContinuedTable') {
      return refs.tables.has(ref);
    }
    if (
      command.op === 'updatePictureCaption' ||
      command.op === 'splitPicture' ||
      command.op === 'hidePicture'
    ) {
      return refs.pictures.has(ref);
    }
    return this.refExists(ref, refs);
  }

  private refExists(ref: string, refs: RefSet): boolean {
    return (
      refs.texts.has(ref) || refs.tables.has(ref) || refs.pictures.has(ref)
    );
  }

  private validateTextRef(ref: string, refs: RefSet, reasons: string[]): void {
    if (!refs.texts.has(ref)) {
      reasons.push('text_ref_not_found');
    }
  }

  private validateTableRef(
    ref: string,
    refs: RefSet,
    reasons: string[],
    options: { allowAdjacent?: boolean } = {},
  ): void {
    if (!this.tableRefExists(ref, refs, options)) {
      reasons.push('table_ref_not_found');
    }
  }

  private tableRefExists(
    ref: string,
    refs: RefSet,
    options: { allowAdjacent?: boolean } = {},
  ): boolean {
    return (
      refs.tables.has(ref) ||
      (options.allowAdjacent === true && refs.adjacentTables.has(ref))
    );
  }

  private validatePageNumber(
    context: PageReviewContext,
    pageNo: number,
    reasons: string[],
  ): void {
    if (pageNo !== context.pageNo) {
      reasons.push('page_number_mismatch');
    }
  }

  private validateBbox(
    context: PageReviewContext,
    bbox: DoclingBBox,
    reasons: string[],
  ): void {
    if (![bbox.l, bbox.t, bbox.r, bbox.b].every(Number.isFinite)) {
      reasons.push('bbox_non_finite');
      return;
    }
    if (bbox.r <= bbox.l) {
      reasons.push('bbox_invalid_horizontal_order');
    }

    const top = Math.min(bbox.t, bbox.b);
    const bottom = Math.max(bbox.t, bbox.b);
    if (bottom <= top) {
      reasons.push('bbox_invalid_vertical_order');
    }

    if (!context.pageSize) return;
    const rect =
      bbox.coord_origin === 'BOTTOMLEFT'
        ? {
            left: bbox.l,
            right: bbox.r,
            top: context.pageSize.height - Math.max(bbox.t, bbox.b),
            bottom: context.pageSize.height - Math.min(bbox.t, bbox.b),
          }
        : {
            left: bbox.l,
            right: bbox.r,
            top,
            bottom,
          };

    if (
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > context.pageSize.width ||
      rect.bottom > context.pageSize.height
    ) {
      reasons.push('bbox_outside_page');
    }
  }

  private validateTextReplacement(
    context: PageReviewContext,
    textRef: string,
    replacement: string,
    reasons: string[],
  ): void {
    const original = context.textBlocks.find(
      (block) => block.ref === textRef,
    )?.text;
    if (!original) return;
    if (original.length > 20 && replacement.length < original.length * 0.3) {
      reasons.push('replacement_deletes_too_much_text');
    }
  }

  private replacementTextFromEvidence(
    context: PageReviewContext,
    textRef: string | undefined,
    evidence: string | null,
  ): string | undefined {
    if (!textRef || !evidence) return undefined;
    const original = context.textBlocks.find(
      (block) => block.ref === textRef,
    )?.text;
    if (!original) return undefined;

    const candidate = evidence.trim();
    if (candidate.length < 2) return undefined;
    if (!/[0-9A-Za-z가-힣一-龯]/u.test(candidate)) return undefined;
    if (
      /^(?:image reads|visible text|correct(?:ed)? ocr|add missing|fix|the image|이미지|보이는|수정|교정|근거)[:\s]/iu.test(
        candidate,
      )
    ) {
      return undefined;
    }
    if (candidate.length > Math.max(original.length * 4, 400)) {
      return undefined;
    }
    return candidate;
  }

  private validateRemoveText(
    context: PageReviewContext,
    textRef: string,
    reasons: string[],
  ): void {
    const suspectReasons = this.getSuspectReasons(context, textRef);
    const allowed = [
      'empty_text',
      'ocr_noise',
      'orphan_caption',
      'caption_like_body_text',
      'picture_internal_text',
      'repeated_across_pages',
    ];
    if (!suspectReasons.some((reason) => allowed.includes(reason))) {
      reasons.push('remove_text_without_deterministic_suspect_reason');
    }
  }

  private validateSplitText(
    context: PageReviewContext,
    textRef: string,
    parts: Array<{ text: string; label?: string }>,
    reasons: string[],
  ): void {
    const original = context.textBlocks.find(
      (block) => block.ref === textRef,
    )?.text;
    if (!original) return;
    const joined = this.normalizeText(parts.map((part) => part.text).join(''));
    const normalizedOriginal = this.normalizeText(original);
    if (
      joined.length < normalizedOriginal.length * 0.5 ||
      joined.length > normalizedOriginal.length * 1.5
    ) {
      reasons.push('split_text_parts_do_not_match_original_length');
    }
  }

  private validateTableCell(
    context: PageReviewContext,
    tableRef: string,
    row: number,
    col: number,
    reasons: string[],
  ): void {
    const table = context.tables.find((entry) => entry.ref === tableRef);
    if (!table) return;
    if (row < 0 || col < 0) {
      reasons.push('table_cell_negative_index');
      return;
    }
    if (
      row >= table.gridPreview.length ||
      col >= table.gridPreview[row].length
    ) {
      reasons.push('table_cell_out_of_preview_range');
    }
  }

  private validateTableGrid(
    grid: ReviewAssistanceTableCell[][],
    reasons: string[],
  ): void {
    /* v8 ignore next -- toCommand rejects empty grids before shape validation */
    if (grid.length === 0) {
      reasons.push('table_grid_empty');
      return;
    }
    const width = grid[0].length;
    if (width === 0 || grid.some((row) => row.length !== width)) {
      reasons.push('table_grid_not_rectangular');
    }
  }

  private validateCaptionText(text: string, reasons: string[]): void {
    if (text.trim().length === 0) {
      reasons.push('caption_empty');
    }
    if (text.length > 240) {
      reasons.push('caption_too_long');
    }
  }

  private validateSplitRegions(
    regions: ReviewAssistanceImageRegion[],
    reasons: string[],
  ): void {
    /* v8 ignore next -- toCommand rejects splitPicture payloads with fewer than two regions */
    if (regions.length < 2) {
      reasons.push('split_picture_requires_multiple_regions');
    }
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        if (this.iou(regions[i].bbox, regions[j].bbox) > 0.5) {
          reasons.push('split_picture_regions_overlap');
          return;
        }
      }
    }
  }

  private missingTextMatches(
    context: PageReviewContext,
    text: string,
  ): boolean {
    const normalizedText = this.normalizeText(text);
    return context.missingTextCandidates.some(
      (candidate) => this.normalizeText(candidate.text) === normalizedText,
    );
  }

  private isFootnoteCandidate(
    context: PageReviewContext,
    textRef: string,
  ): boolean {
    return context.footnotes.some((footnote) => footnote.ref === textRef);
  }

  private hasReadingOrderMismatch(context: PageReviewContext): boolean {
    if (context.layout.readingOrderRefs.length === 0) return false;
    if (
      context.layout.readingOrderRefs.length !==
      context.layout.visualOrderRefs.length
    ) {
      return true;
    }
    return context.layout.readingOrderRefs.some(
      (ref, index) => context.layout.visualOrderRefs[index] !== ref,
    );
  }

  private moveNodeImprovesReadingOrder(
    context: PageReviewContext,
    command: Extract<ReviewAssistanceCommand, { op: 'moveNode' }>,
  ): boolean {
    if (!this.hasReadingOrderMismatch(context)) return false;
    const movedRefs = this.moveOrderRefs(
      context.layout.readingOrderRefs,
      command,
    );
    if (!movedRefs) return false;
    return (
      this.orderMismatchScore(movedRefs, context.layout.visualOrderRefs) <
      this.orderMismatchScore(
        context.layout.readingOrderRefs,
        context.layout.visualOrderRefs,
      )
    );
  }

  private moveOrderRefs(
    refs: string[],
    command: Extract<ReviewAssistanceCommand, { op: 'moveNode' }>,
  ): string[] | undefined {
    const sourceIndex = refs.indexOf(command.sourceRef);
    const targetIndex = refs.indexOf(command.targetRef);
    if (sourceIndex < 0 || targetIndex < 0) return undefined;

    const movedRefs = refs.filter((ref) => ref !== command.sourceRef);
    const movedTargetIndex = movedRefs.indexOf(command.targetRef);
    const insertAt =
      command.position === 'before' ? movedTargetIndex : movedTargetIndex + 1;
    movedRefs.splice(insertAt, 0, command.sourceRef);
    return movedRefs;
  }

  private orderMismatchScore(actual: string[], expected: string[]): number {
    let score = 0;
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index++) {
      if (actual[index] !== expected[index]) score++;
    }
    return score;
  }

  private getRiskPenalty(
    context: PageReviewContext,
    command: ReviewAssistanceCommand,
  ): number {
    switch (command.op) {
      case 'removeText':
        return this.isPictureInternalTextRemoval(context, command) ? 0 : 0.12;
      case 'hidePicture':
        return 0.12;
      case 'replaceTable':
      case 'mergeTexts':
      case 'splitText':
      case 'splitPicture':
      case 'linkContinuedTable':
      case 'updateBbox':
        return 0.08;
      case 'moveNode':
        return 0.05;
      default:
        return 0;
    }
  }

  private getSuspectReasons(context: PageReviewContext, ref: string): string[] {
    const textBlock = context.textBlocks.find((block) => block.ref === ref);
    if (textBlock) return textBlock.suspectReasons;
    const table = context.tables.find((entry) => entry.ref === ref);
    if (table) return table.suspectReasons;
    const picture = context.pictures.find((entry) => entry.ref === ref);
    if (picture) return picture.suspectReasons;
    return [];
  }

  private isHanjaCorrectionCommand(
    context: PageReviewContext,
    command: ReviewAssistanceCommand | undefined,
  ): boolean {
    if (command?.op !== 'replaceText') return false;
    return (
      this.getSuspectReasons(context, command.textRef).includes(
        'hanja_ocr_candidate',
      ) || this.hasDomainPattern(context, command.textRef, 'hanja_term')
    );
  }

  private isPictureInternalTextRemoval(
    context: PageReviewContext,
    command: ReviewAssistanceCommand | undefined,
  ): boolean {
    if (command?.op !== 'removeText') return false;
    return this.getSuspectReasons(context, command.textRef).includes(
      'picture_internal_text',
    );
  }

  private hasDomainPattern(
    context: PageReviewContext,
    targetRef: string,
    pattern: PageReviewContext['domainPatterns'][number]['pattern'],
  ): boolean {
    return context.domainPatterns.some(
      (entry) => entry.targetRef === targetRef && entry.pattern === pattern,
    );
  }

  private iou(a: DoclingBBox, b: DoclingBBox): number {
    const left = Math.max(Math.min(a.l, a.r), Math.min(b.l, b.r));
    const right = Math.min(Math.max(a.l, a.r), Math.max(b.l, b.r));
    const top = Math.max(Math.min(a.t, a.b), Math.min(b.t, b.b));
    const bottom = Math.min(Math.max(a.t, a.b), Math.max(b.t, b.b));
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const areaA = Math.abs(a.r - a.l) * Math.abs(a.b - a.t);
    const areaB = Math.abs(b.r - b.l) * Math.abs(b.b - b.t);
    const union = areaA + areaB - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private normalizeText(text: string): string {
    return text.replace(/\s+/g, '');
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value)
      ? value
      : undefined;
  }

  private stringArrayValue(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private bboxValue(value: unknown): DoclingBBox | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (
      typeof record.l !== 'number' ||
      typeof record.t !== 'number' ||
      typeof record.r !== 'number' ||
      typeof record.b !== 'number'
    ) {
      return undefined;
    }
    return {
      l: record.l,
      t: record.t,
      r: record.r,
      b: record.b,
      coord_origin:
        typeof record.coord_origin === 'string'
          ? record.coord_origin
          : 'TOPLEFT',
    };
  }

  private tableGridValue(value: unknown): ReviewAssistanceTableCell[][] {
    /* v8 ignore next -- structured schema should provide arrays; kept for untrusted LLM payload defense */
    if (!Array.isArray(value)) return [];
    return value.map((row) =>
      Array.isArray(row)
        ? row.map((cell) => ({
            text:
              typeof cell === 'object' &&
              cell !== null &&
              typeof (cell as { text?: unknown }).text === 'string'
                ? (cell as { text: string }).text
                : '',
          }))
        : [],
    );
  }

  private imageRegionsValue(value: unknown): ReviewAssistanceImageRegion[] {
    /* v8 ignore next -- structured schema should provide arrays; kept for untrusted LLM payload defense */
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      /* v8 ignore next -- structured schema should provide objects; kept for untrusted LLM payload defense */
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const bbox = this.bboxValue(record.bbox);
      /* v8 ignore next -- structured schema should provide bboxes; kept for untrusted LLM payload defense */
      if (!bbox) return [];
      return [
        {
          id: this.stringValue(record.id),
          bbox,
          imageUri: this.stringValue(record.imageUri),
          caption: this.stringValue(record.caption),
        },
      ];
    });
  }

  private textPartsValue(
    value: unknown,
  ): Array<{ text: string; label?: string }> {
    /* v8 ignore next -- structured schema should provide arrays; kept for untrusted LLM payload defense */
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      /* v8 ignore next -- structured schema should provide objects; kept for untrusted LLM payload defense */
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const text = this.stringValue(record.text);
      /* v8 ignore next -- structured schema should provide text; kept for untrusted LLM payload defense */
      if (text === undefined) return [];
      return [{ text, label: this.stringValue(record.label) }];
    });
  }

  private buildDecisionId(
    pageNo: number,
    rawCommand: ReviewAssistanceRawCommand,
    command?: ReviewAssistanceCommand,
  ): string {
    const hash = createHash('sha1')
      .update(
        this.stableStringify({
          pageNo,
          op: rawCommand.op,
          targetRef: rawCommand.targetRef,
          payload: rawCommand.payload,
          command,
        }),
      )
      .digest('hex')
      .slice(0, 12);
    return `ra-${pageNo}-${hash}`;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, entry]) =>
            `${JSON.stringify(key)}:${this.stableStringify(entry)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}

interface RefSet {
  texts: Set<string>;
  tables: Set<string>;
  adjacentTables: Set<string>;
  pictures: Set<string>;
}
