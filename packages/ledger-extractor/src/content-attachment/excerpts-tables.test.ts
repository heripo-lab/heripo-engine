import type { ContentAttachmentPlan } from './types';

import { describe, expect, test } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { createContentAttachmentDecisionInput } from './decisions';
import { empty, fixture, legacyAudit } from './excerpts.test-fixture';
import { createContentAttachmentRequest } from './request';
import { createContentAttachmentTableAnchorInput } from './tables/anchors';

describe('immutable content excerpt selection', () => {
  test('requires identified table owners and ignores generic headers without rewriting current or historical responses', () => {
    const plan = fixture(['Text.'], true);
    const unit = plan.units[0];
    const table = unit.tables[0].data;
    table.caption = { fullText: 'Well inventory' };
    table.grid[0][0].text = '호수';
    table.grid[0][1].text = '규모(단위 : cm)';
    table.grid[0].forEach((cell) => {
      cell.isHeader = false;
    });
    plan.registry[0].mentions[0].sourceIdentifier = ' 7 ';
    const valid = legacyAudit(plan, {
      ...empty(),
      assignments: ['E1', 'E4', 'E5'].map((excerptRef) => ({
        excerptRef,
        candidateRefs: ['R1'],
        reason: 'Identified row or body',
      })),
      ignored: ['E2', 'E3'].map((excerptRef) => ({
        excerptRef,
        reason: 'Column label',
      })),
    });
    expect(assembleContentAttachment(plan, [valid]).issues).toEqual([]);
    const raw = legacyAudit(plan, {
      ...empty(),
      assignments: [
        { excerptRef: 'E2', candidateRefs: ['R2'], reason: 'Column label' },
      ],
      ignored: ['E1', 'E3', 'E4', 'E5'].map((excerptRef) => ({
        excerptRef,
        reason: 'Row item',
      })),
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues.map((e) => e.reason)).toEqual([
      'Generic table header must be ignored: E2',
      'Identified table-row cell must include R1: E4',
      'Identified table-row cell must include R1: E5',
    ]);
    for (const version of [
      'content-attachment.v18',
      'content-attachment.v19',
      'content-attachment.v20',
      'content-attachment.v21',
      'content-attachment.v22',
      'content-attachment.v23',
      'content-attachment.v24',
      'content-attachment.v25',
      'content-attachment.v26',
      'content-attachment.v27',
      'content-attachment.v28',
    ] as const) {
      const previousTableAudit = {
        ...raw,
        ...createContentAttachmentRequest(plan, unit, version),
        codeMap:
          version === 'content-attachment.v25' ||
          version === 'content-attachment.v26' ||
          version === 'content-attachment.v27' ||
          version === 'content-attachment.v28'
            ? createContentAttachmentTableAnchorInput(plan, unit).codeMap
            : createContentAttachmentDecisionInput(plan, unit).codeMap,
      };
      expect(assembleContentAttachment(plan, [previousTableAudit])).toEqual(
        result,
      );
    }
    expect(result.completedUnitIds).toEqual([]);
    expect(result.contents.map((c) => c.registryRef)).toEqual(['R2']);
    expect(result.ignoredPassages).toHaveLength(4);
    expect([plan, raw]).toEqual(before);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v17'),
      codeMap: createContentAttachmentDecisionInput(plan, unit).codeMap,
    };
    expect(assembleContentAttachment(plan, [historical]).issues).toEqual([]);
    const ambiguousHeader = structuredClone(valid);
    ambiguousHeader.response.ignored.pop();
    ambiguousHeader.response.unresolved.push({
      excerptRef: 'E3',
      candidateRefs: ['R2'],
      reason: 'Header',
    });
    expect(
      assembleContentAttachment(plan, [ambiguousHeader]).issues.map(
        (e) => e.reason,
      ),
    ).toEqual(['Generic table header must be ignored: E3']);
    const wrongOwner = structuredClone(valid);
    wrongOwner.response.assignments[2].candidateRefs = ['R2'];
    expect(
      assembleContentAttachment(plan, [wrongOwner]).issues.map((e) => e.reason),
    ).toEqual(['Identified table-row cell must include R1: E5']);
    const partial = structuredClone(plan);
    partial.units[0].sources = partial.units[0].sources.filter(
      (source) => source.resource.kind === 'text',
    );
    expect(
      assembleContentAttachment(partial, [
        legacyAudit(partial, {
          ...empty(),
          ignored: [{ excerptRef: 'E1', reason: 'Body' }],
        }),
      ]).issues,
    ).toEqual([]);
  });

  test('bounds table checks by exact identifiers, literal caption names or original row anchors and never guesses ambiguous owners', () => {
    const run = (
      change: (p: ContentAttachmentPlan) => void,
      assigned = 'E5',
    ) => {
      const plan = fixture(['Text.'], true);
      const table = plan.units[0].tables[0].data;
      table.grid[0][0].text = 'Number';
      table.grid[0][1].text = 'Unrecognized column';
      plan.registry[0].mentions[0].sourceIdentifier = ' 7 ';
      change(plan);
      const input = createContentAttachmentDecisionInput(plan, plan.units[0]);
      const raw = legacyAudit(plan, {
        ...empty(),
        assignments: [
          {
            excerptRef: assigned,
            candidateRefs: ['R2'],
            reason: 'Original decision',
          },
        ],
        ignored: input.codeMap.excerpts
          .filter((e) => e.ref !== assigned)
          .map((e) => ({ excerptRef: e.ref, reason: 'Original exclusion' })),
      });
      return assembleContentAttachment(plan, [raw]).issues.map((e) => e.reason);
    };
    expect(run(() => {})).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Other objects' };
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        p.registry[0].mentions[0].sourceName = '';
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
        p.registry[0].mentions[0].sourceIdentifier = '7';
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
        p.registry[1].mentions[0].sourceName = 'Well';
        p.registry[1].mentions[0].sourceIdentifier = ' 7 ';
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        const selected = createContentAttachmentDecisionInput(p, p.units[0]);
        p.registry[0].mentions[0].evidence = selected.codeMap.excerpts.find(
          (e) => e.ref === 'E4',
        )!.evidence;
      }),
    ).toEqual([
      'Identified table-row cell must include R1: E4',
      'Identified table-row cell must include R1: E5',
    ]);
    expect(
      run((p) => {
        const selected = createContentAttachmentDecisionInput(p, p.units[0]);
        p.registry[0].mentions[0].evidence = structuredClone(
          selected.codeMap.excerpts.find((e) => e.ref === 'E4')!.evidence,
        );
        p.registry[0].mentions[0].evidence[0].resourceKey =
          '/tables/0/grid/10/0';
      }),
    ).toEqual([]);
    expect(run(() => {}, 'E2')).toEqual([
      'Generic table header must be ignored: E2',
    ]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.grid[0][0].isHeader = false;
      }, 'E2'),
    ).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
        p.units[0].tables[0].data.grid[1][2].text = 'Name';
      }),
    ).toEqual([
      'Identified table-row cell must include R1: E4',
      'Identified table-row cell must include R1: E5',
    ]);
  });
});
