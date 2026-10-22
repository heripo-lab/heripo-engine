import { describe, expect, test } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { createContentAttachmentDecisionInput } from './decisions';
import { createContentAttachmentSelectionInput } from './excerpts';
import { audit, empty, fixture } from './excerpts.test-fixture';
import { createContentAttachmentRequest } from './request';
import { createContentAttachmentTableAnchorInput } from './tables/anchors';

describe('immutable content excerpt selection', () => {
  test('preserves qualified set evidence on selected members and replays v25 without changing its input or repairing responses', () => {
    const plan = fixture([
      'Pits A and B were investigated. Most are circular or square.',
    ]);
    plan.registry = plan.registry.slice(0, 2);
    for (const [i, record] of plan.registry.entries()) {
      record.recordKind = 'feature';
      record.mentions[0].sourceName = 'Pit';
      record.mentions[0].sourceIdentifier = ['A', 'B'][i];
    }
    const raw = audit(plan, {
      assignments: ['E1', 'E2'].map((excerptRef) => ({
        excerptRef,
        candidateRefs: ['R1', 'R2'],
        reason: 'Qualified description of the established set',
      })),
      unresolved: [],
      ignored: [],
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(
      result.contents.map((c) => c.excerpts.map((e) => e.fragments)),
    ).toEqual([
      [['Pits A and B were investigated.'], ['Most are circular or square.']],
      [['Pits A and B were investigated.'], ['Most are circular or square.']],
    ]);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(
        plan,
        plan.units[0],
        'content-attachment.v25',
      ),
      codeMap: createContentAttachmentTableAnchorInput(plan, plan.units[0])
        .codeMap,
    };
    expect(historical.userPrompt).toBe(
      JSON.stringify(
        createContentAttachmentTableAnchorInput(plan, plan.units[0]).payload,
      ),
    );
    expect(raw.systemPrompt.startsWith(historical.systemPrompt)).toBe(true);
    expect(historical.systemPrompt).not.toContain(
      'QUALIFIED FOLLOW-UP DESCRIPTIONS',
    );
    expect(raw.systemPrompt).toContain(
      'PRESERVE QUANTIFIERS IN ORIGINAL EVIDENCE',
    );
    expect(assembleContentAttachment(plan, [historical])).toEqual(result);
    expect(
      assembleContentAttachment(plan, [
        { ...raw, systemPrompt: historical.systemPrompt },
      ]).issues[0].reason,
    ).toContain('Audit does not match');
    const previousQualified = {
      ...raw,
      ...createContentAttachmentRequest(
        plan,
        plan.units[0],
        'content-attachment.v26',
      ),
      codeMap: createContentAttachmentTableAnchorInput(plan, plan.units[0])
        .codeMap,
    };
    expect(previousQualified.userPrompt).toBe(
      JSON.stringify(
        createContentAttachmentTableAnchorInput(plan, plan.units[0]).payload,
      ),
    );
    expect(raw.systemPrompt.startsWith(previousQualified.systemPrompt)).toBe(
      true,
    );
    expect(previousQualified.systemPrompt).not.toContain(
      'IDENTIFIER ANCHORS ESTABLISH IDENTITY',
    );
    expect(assembleContentAttachment(plan, [previousQualified])).toEqual(
      result,
    );
    const previousRows = {
      ...raw,
      ...createContentAttachmentRequest(
        plan,
        plan.units[0],
        'content-attachment.v27',
      ),
      codeMap: createContentAttachmentTableAnchorInput(plan, plan.units[0])
        .codeMap,
    };
    expect(previousRows.userPrompt).toBe(
      JSON.stringify(
        createContentAttachmentTableAnchorInput(plan, plan.units[0]).payload,
      ),
    );
    expect(raw.systemPrompt.startsWith(previousRows.systemPrompt)).toBe(true);
    expect(previousRows.systemPrompt).not.toContain(
      'INFERRED COLLECTIVES REQUIRE',
    );
    expect(assembleContentAttachment(plan, [previousRows])).toEqual(result);
    const previousCollective = {
      ...raw,
      ...createContentAttachmentRequest(
        plan,
        plan.units[0],
        'content-attachment.v28',
      ),
      codeMap: createContentAttachmentTableAnchorInput(plan, plan.units[0])
        .codeMap,
    };
    expect(previousCollective.userPrompt).toBe(
      JSON.stringify(
        createContentAttachmentTableAnchorInput(plan, plan.units[0]).payload,
      ),
    );
    expect(raw.systemPrompt.startsWith(previousCollective.systemPrompt)).toBe(
      true,
    );
    expect(previousCollective.systemPrompt).not.toContain(
      'LOCATION-REFERENCE-ONLY OBJECTS',
    );
    expect(assembleContentAttachment(plan, [previousCollective])).toEqual(
      result,
    );
    const previousLocation = {
      ...raw,
      ...createContentAttachmentRequest(
        plan,
        plan.units[0],
        'content-attachment.v29',
      ),
      codeMap: createContentAttachmentTableAnchorInput(plan, plan.units[0])
        .codeMap,
    };
    expect(previousLocation.userPrompt).toBe(
      JSON.stringify(
        createContentAttachmentTableAnchorInput(plan, plan.units[0]).payload,
      ),
    );
    expect(raw.systemPrompt.startsWith(previousLocation.systemPrompt)).toBe(
      true,
    );
    expect(assembleContentAttachment(plan, [previousLocation])).toEqual(result);
    expect([plan, raw]).toEqual(before);
  });

  test('preserves selected survey and feature targets without supplying omitted members', () => {
    const plan = fixture([
      'Survey inventory',
      'The survey found pits A and B.',
    ]);
    plan.registry = plan.registry.slice(0, 3);
    plan.registry.forEach((record, i) => {
      record.recordKind = i === 0 ? 'area' : 'feature';
      record.mentions[0].sourceName = ['Survey area', 'Pit A', 'Pit B'][i];
    });
    const raw = audit(plan, {
      assignments: [
        {
          excerptRef: 'E2',
          candidateRefs: ['R1', 'R2', 'R3'],
          reason: 'Area and verified inventory members',
        },
      ],
      unresolved: [],
      ignored: [{ excerptRef: 'E1', reason: 'Generic title' }],
    });
    const before = structuredClone(raw);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents.map((c) => c.registryRef)).toEqual([
      'R1',
      'R2',
      'R3',
    ]);
    expect(raw).toEqual(before);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(
        plan,
        plan.units[0],
        'content-attachment.v29',
      ),
      codeMap: createContentAttachmentTableAnchorInput(plan, plan.units[0])
        .codeMap,
    };
    expect(assembleContentAttachment(plan, [historical])).toEqual(result);
    const areaOnly = structuredClone(raw);
    areaOnly.response.assignments[0].candidateRefs = ['R1'];
    expect(
      assembleContentAttachment(plan, [areaOnly]).contents.map(
        (c) => c.registryRef,
      ),
    ).toEqual(['R1']);
  });

  test('reports ignored literal artifact headings in their chapter without repairing responses or rejecting other text and ambiguous identities', () => {
    const plan = fixture(
      [
        '7. Vessel (Fig. 4)',
        '7. Vessel',
        'Features',
        '7. Vessel body description.',
        '7. Vessel (Fig. 4). More.',
        '7. Vessellet',
        '7. Vessel (broken',
        '8. Plate (Photo 5)',
        '7. Vessel (Fig. 4)',
      ],
      true,
    );
    for (const [i, entry] of plan.registry.entries()) {
      entry.recordKind = i === 4 ? 'feature' : 'artifact';
      entry.mentions[0].sourceName = i === 3 ? 'Plate' : 'Vessel';
      entry.mentions[0].sourceIdentifier =
        i === 2 ? null : i === 3 ? '8.' : '7.';
    }
    plan.registry[1].mentions[0].chapterPath = [
      { id: 'other', originTitle: 'Other' },
    ];
    plan.registry[3].mentions[0].chapterPath = [];
    plan.registry.push({ ...plan.registry[0], ref: 'R6', groupId: 'other' });
    const unit = plan.units[0];
    const input = createContentAttachmentSelectionInput(plan, unit);
    const raw = audit(plan, {
      ...empty(),
      ignored: input.codeMap.excerpts.map((e) => ({
        excerptRef: e.ref,
        reason: 'Generic heading',
      })),
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    const headings = input.codeMap.excerpts.filter((e) =>
      ['txt-0', 'txt-1', 'txt-8'].includes(e.evidence[0].resourceId!),
    );
    expect(headings).toHaveLength(3);
    expect(result.issues.map((i) => i.reason)).toEqual(
      headings.map(
        (e) =>
          `Registered artifact heading cannot be ignored: ${e.ref} (R1, R6)`,
      ),
    );
    expect(result.completedUnitIds).toEqual([]);
    expect(result.contents).toEqual([]);
    expect(result.ignoredPassages).toHaveLength(input.codeMap.excerpts.length);
    expect([plan, raw]).toEqual(before);
    for (const version of [
      'content-attachment.v11',
      'content-attachment.v12',
      'content-attachment.v13',
      'content-attachment.v14',
      'content-attachment.v15',
      'content-attachment.v16',
      'content-attachment.v17',
      'content-attachment.v18',
      'content-attachment.v19',
      'content-attachment.v20',
      'content-attachment.v21',
      'content-attachment.v22',
      'content-attachment.v23',
      'content-attachment.v24',
    ] as const) {
      const historical = {
        ...raw,
        ...createContentAttachmentRequest(plan, unit, version),
        codeMap:
          version === 'content-attachment.v13' ||
          version === 'content-attachment.v14' ||
          version === 'content-attachment.v15' ||
          version === 'content-attachment.v16' ||
          version === 'content-attachment.v17' ||
          version === 'content-attachment.v18' ||
          version === 'content-attachment.v19' ||
          version === 'content-attachment.v20' ||
          version === 'content-attachment.v21' ||
          version === 'content-attachment.v22' ||
          version === 'content-attachment.v23' ||
          version === 'content-attachment.v24'
            ? createContentAttachmentDecisionInput(plan, unit).codeMap
            : createContentAttachmentSelectionInput(plan, unit).codeMap,
      };
      expect(assembleContentAttachment(plan, [historical]).issues).toEqual(
        version === 'content-attachment.v11' ? [] : result.issues,
      );
    }
    const ambiguous = audit(plan, {
      ...empty(),
      unresolved: headings.map((e) => ({
        excerptRef: e.ref,
        candidateRefs: ['R1', 'R6'],
        reason: 'Identical registered identities',
      })),
      ignored: raw.response.ignored.filter(
        (e) => !headings.some((h) => h.ref === e.excerptRef),
      ),
    });
    const unresolved = assembleContentAttachment(plan, [ambiguous]);
    expect(unresolved.issues).toEqual([]);
    expect(unresolved.completedUnitIds).toEqual([unit.unitId]);
    expect(unresolved.unresolved).toHaveLength(3);
    expect(unresolved.contents).toEqual([]);
  });
});
