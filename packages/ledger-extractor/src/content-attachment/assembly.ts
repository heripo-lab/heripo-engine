import type { CandidateEvidence } from '../candidates/discovery-types';
import type {
  ContentAttachmentAudit,
  ContentAttachmentPlan,
  ContentAttachmentResponse,
  ContentAttachmentResult,
  ContentAttachmentSelectionAudit,
} from './types';

import { checkContentAttachmentAudit } from './audit-check';
import { validateContentAttachmentIdentifierRanges } from './identifier-ranges';
import { CONTENT_ATTACHMENT_PROMPT_VERSION } from './prompts';
import { isContentAttachmentPromptBetween } from './prompts';
import { validateContentAttachmentTables } from './tables/validation';

/** Replay bounded decisions; invalid assignments remain issues and never alter source strings. */
export function assembleContentAttachment(
  plan: ContentAttachmentPlan,
  audits: Array<ContentAttachmentAudit | ContentAttachmentSelectionAudit>,
): ContentAttachmentResult {
  const result: ContentAttachmentResult = {
    version: 'ledger-content-attachments.v1',
    reviewStatus: 'not_reviewed',
    completedUnitIds: [],
    totalUnits: plan.units.length,
    contents: [],
    unresolved: [],
    ignoredSources: [],
    ignoredPassages: [],
    issues: [],
  };
  for (const audit of audits) {
    const checked = checkContentAttachmentAudit(plan, result, audit);
    if (!checked) continue;
    const {
      unit,
      issue,
      selection,
      selectionInput,
      selectors,
      fullCoverage,
      parsed,
      selected,
    } = checked;
    const before = result.issues.length;
    const inspected = new Set<string>();
    const used = new Set<string>();
    const handledExcerpts = new Set<string>();
    const seenSelections = new Set<string>();
    const select = (
      ref: string,
      category: string,
    ): CandidateEvidence[] | null => {
      const excerpt = selectionInput!.codeMap.excerpts.find(
        (e) => e.ref === ref,
      );
      if (!excerpt || seenSelections.has(`${category}:${ref}`)) {
        issue('Unknown or repeated excerpt reference');
        return null;
      }
      seenSelections.add(`${category}:${ref}`);
      return excerpt.evidence;
    };
    const covered = new Map<string, Array<[number, number]>>();
    const cover = (evidence: CandidateEvidence[]) => {
      for (const e of evidence) {
        const ranges = covered.get(e.sourceId) ?? [];
        ranges.push([e.charStart, e.charEnd]);
        covered.set(e.sourceId, ranges);
        inspected.add(e.sourceId);
        used.add(e.sourceId);
      }
    };
    const locate = (
      fragments: ContentAttachmentResponse['assignments'][number]['fragments'],
    ): CandidateEvidence[] | null => {
      const evidence: CandidateEvidence[] = [];
      let previous = -1;
      let previousEnd = 0;
      let kind: string | undefined;
      let table: string | undefined;
      for (const f of fragments) {
        const i = unit.sources.findIndex(
          (s) => s.sourceId === selectors.get(f.sourceId),
        );
        const r = unit.sources[i]?.resource;
        const start = r?.data.text.indexOf(f.quote) ?? -1;
        if (
          !r ||
          start < 0 ||
          r.data.text.indexOf(f.quote, start + 1) >= 0 ||
          i < previous ||
          (i === previous && start < previousEnd) ||
          (kind && kind !== r.kind) ||
          (r.kind === 'tableCell' && table && table !== r.tableId)
        )
          return null;
        previous = i;
        previousEnd = start + f.quote.length;
        kind = r.kind;
        if (r.kind === 'tableCell') table = r.tableId;
        evidence.push({
          sourceId: unit.sources[i].sourceId,
          resourceKey: r.key,
          resourceId: r.resourceId,
          sourceRefs: r.sourceRefs,
          pdfPageNo: r.pdfPageNo,
          logicalPageRange: r.logicalPageRange,
          quote: f.quote,
          charStart: start,
          charEnd: start + f.quote.length,
        });
      }
      return evidence;
    };
    const oldData = parsed?.success ? parsed.data : null;
    const newData = selected?.success ? selected.data : null;
    for (const [category, items] of [
      [
        'assignments',
        newData
          ? newData.assignments.map((item) => ({
              ...item,
              evidence: select(item.excerptRef, 'assignments'),
            }))
          : oldData!.assignments.map((item) => ({
              ...item,
              excerptRef: '',
              evidence: locate(item.fragments),
            })),
      ],
      [
        'unresolved',
        newData
          ? newData.unresolved.map((item) => ({
              ...item,
              evidence: select(item.excerptRef, 'unresolved'),
            }))
          : oldData!.unresolved.map((item) => ({
              ...item,
              excerptRef: '',
              evidence: locate(item.fragments),
            })),
      ],
    ] as const) {
      for (const item of items) {
        if (
          item.candidateRefs.some(
            (ref) => !plan.registry.some((r) => r.ref === ref),
          ) ||
          new Set(item.candidateRefs).size !== item.candidateRefs.length
        ) {
          issue('Unknown or repeated candidate reference');
          continue;
        }
        const evidence = item.evidence;
        if (!evidence) {
          issue(
            'Excerpt does not match exact ordered original block or cell fragments',
          );
          continue;
        }
        cover(evidence);
        if (selection) handledExcerpts.add(item.excerptRef);
        if (category === 'unresolved') {
          result.unresolved.push({
            unitId: unit.unitId,
            candidateRefs: item.candidateRefs,
            evidence,
            reason: item.reason,
          });
          continue;
        }
        const kind =
          unit.sources.find((s) => s.sourceId === evidence[0].sourceId)!
            .resource.kind === 'text'
            ? 'body'
            : 'table_item';
        for (const ref of item.candidateRefs) {
          let content = result.contents.find((c) => c.registryRef === ref);
          if (!content) {
            content = {
              registryRef: ref,
              groupId: plan.registry.find((r) => r.ref === ref)!.groupId,
              excerpts: [],
            };
            result.contents.push(content);
          }
          const fragments = evidence.map((f) => f.quote);
          let excerpt = content.excerpts.find(
            (e) =>
              e.kind === kind &&
              JSON.stringify(e.fragments) === JSON.stringify(fragments),
          );
          if (!excerpt) {
            excerpt = { kind, fragments, occurrences: [], reasons: [] };
            content.excerpts.push(excerpt);
          }
          if (
            !excerpt.occurrences.some(
              (o) => JSON.stringify(o.evidence) === JSON.stringify(evidence),
            )
          )
            excerpt.occurrences.push({ evidence });
          if (!excerpt.reasons.includes(item.reason))
            excerpt.reasons.push(item.reason);
        }
      }
    }
    if (fullCoverage) {
      const exclusions = newData
        ? newData.ignored.map((item) => ({
            ...item,
            evidence: select(item.excerptRef, 'ignored'),
          }))
        : oldData!.ignoredPassages!.map((item) => ({
            ...item,
            excerptRef: '',
            evidence: locate(item.fragments),
          }));
      for (const ignored of exclusions) {
        const evidence = ignored.evidence;
        if (!evidence) {
          issue(
            'Ignored passage does not match exact ordered original fragments',
          );
          continue;
        }
        if (
          evidence.some((e) =>
            covered
              .get(e.sourceId)
              ?.some(([start, end]) => start < e.charEnd && e.charStart < end),
          )
        ) {
          issue('Ignored passage overlaps an already accounted passage');
          continue;
        }
        cover(evidence);
        if (selection) handledExcerpts.add(ignored.excerptRef);
        result.ignoredPassages.push({
          unitId: unit.unitId,
          evidence,
          reason: ignored.reason,
        });
        if (isContentAttachmentPromptBetween(audit.promptVersion, 12, 74)) {
          const source = unit.sources.find(
            (s) => s.sourceId === evidence[0].sourceId,
          )!.resource;
          const heading = evidence[0].quote;
          if (source.kind === 'text' && source.data.text.trim() === heading) {
            const matches = plan.registry.filter(
              (r) =>
                r.recordKind === 'artifact' &&
                r.mentions.some((m) => {
                  if (
                    !m.sourceIdentifier ||
                    !source.chapterIds.includes(m.chapterPath.at(-1)?.id ?? '')
                  )
                    return false;
                  const prefix = `${m.sourceIdentifier} ${m.sourceName}`;
                  return (
                    heading === prefix ||
                    (heading.startsWith(prefix) &&
                      /^ \([^()\r\n]*\)$/u.test(heading.slice(prefix.length)))
                  );
                }),
            );
            if (matches.length)
              issue(
                `Registered artifact heading cannot be ignored: ${ignored.excerptRef} (${matches.map((r) => r.ref).join(', ')})`,
              );
          }
        }
      }
    }
    for (const ignored of oldData?.ignoredSources ?? []) {
      const sourceId = selectors.get(ignored.sourceId);
      if (!sourceId || used.has(sourceId)) {
        issue('Ignored source is unknown or also used by a passage');
        continue;
      }
      inspected.add(sourceId);
      covered.set(sourceId, [
        [
          0,
          unit.sources.find((s) => s.sourceId === sourceId)!.resource.data.text
            .length,
        ],
      ]);
      result.ignoredSources.push({ unitId: unit.unitId, ...ignored, sourceId });
    }
    if (selectionInput) {
      for (const excerpt of selectionInput.codeMap.excerpts)
        if (!handledExcerpts.has(excerpt.ref))
          issue(`Unaccounted excerpt: ${excerpt.ref}`);
      for (const source of unit.sources)
        if (!/\S/u.test(source.resource.data.text)) {
          inspected.add(source.sourceId);
          covered.set(source.sourceId, [[0, source.resource.data.text.length]]);
        }
    }
    for (const source of unit.sources) {
      if (!inspected.has(source.sourceId))
        issue(`Unaccounted source: ${source.sourceId}`);
      else if (fullCoverage) {
        const text = source.resource.data.text;
        let cursor = 0;
        const gap = (end: number) => {
          const quote = text.slice(cursor, end);
          if (/\S/u.test(quote))
            issue(
              `Unaccounted text: ${source.sourceId} [${cursor}, ${end}) ${JSON.stringify(quote)}`,
            );
        };
        for (const [start, end] of covered
          .get(source.sourceId)!
          .sort((a, b) => a[0] - b[0])) {
          gap(start);
          cursor = Math.max(cursor, end);
        }
        gap(text.length);
      }
    }
    if (isContentAttachmentPromptBetween(audit.promptVersion, 18, 74)) {
      for (const reason of validateContentAttachmentTables(
        plan,
        unit,
        selectionInput!.codeMap.excerpts,
        newData!,
        isContentAttachmentPromptBetween(audit.promptVersion, 35, 74),
      ))
        issue(reason);
    }
    if (
      isContentAttachmentPromptBetween(audit.promptVersion, 45, 73) ||
      audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION
    ) {
      for (const reason of validateContentAttachmentIdentifierRanges(
        plan,
        selectionInput!.codeMap.excerpts,
        newData!,
        isContentAttachmentPromptBetween(audit.promptVersion, 53, 73) ||
          audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION,
      ))
        issue(reason);
    }
    if (result.issues.length === before)
      result.completedUnitIds.push(unit.unitId);
  }
  return result;
}
