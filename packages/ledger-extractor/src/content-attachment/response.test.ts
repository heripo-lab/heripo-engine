import type { ContentAttachmentRequiredResponse } from './response';

import { Output } from 'ai';
import { describe, expect, test } from 'vitest';

import {
  createContentAttachmentResponseSchema,
  flattenContentAttachmentResponse,
} from './response';

describe('required per-excerpt response', () => {
  test('requires every E, rejects unrecognized keys and malformed decisions, and preserves shared and partly unresolved selections', () => {
    const schema = createContentAttachmentResponseSchema(
      ['E1', 'E2', 'E3', 'E4'],
      ['R1', 'R2', 'R3'],
    );
    const raw: ContentAttachmentRequiredResponse = {
      decisions: {
        E1: {
          status: 'assigned',
          candidateRefs: ['R1', 'R2'],
          reason: 'Shared',
          unresolved: null,
        },
        E2: {
          status: 'assigned',
          candidateRefs: ['R1'],
          reason: 'Confirmed',
          unresolved: { candidateRefs: ['R2', 'R3'], reason: 'Layer identity' },
        },
        E3: {
          status: 'unresolved',
          candidateRefs: [],
          reason: 'Missing identity',
        },
        E4: { status: 'ignored', reason: 'Generic header' },
      },
    };
    expect(schema.safeParse(raw).success).toBe(true);
    const before = structuredClone(raw);
    const projected = flattenContentAttachmentResponse(raw);
    expect(projected).toEqual({
      assignments: [
        { excerptRef: 'E1', candidateRefs: ['R1', 'R2'], reason: 'Shared' },
        { excerptRef: 'E2', candidateRefs: ['R1'], reason: 'Confirmed' },
      ],
      unresolved: [
        {
          excerptRef: 'E2',
          candidateRefs: ['R2', 'R3'],
          reason: 'Layer identity',
        },
        { excerptRef: 'E3', candidateRefs: [], reason: 'Missing identity' },
      ],
      ignored: [{ excerptRef: 'E4', reason: 'Generic header' }],
    });
    projected.assignments[0].candidateRefs.push('R3');
    projected.unresolved[0].candidateRefs.length = 0;
    projected.unresolved[1].candidateRefs.push('R1');
    expect(raw).toEqual(before);
    for (const ref of Object.keys(raw.decisions)) {
      const missing = structuredClone(raw);
      delete missing.decisions[ref];
      expect(schema.safeParse(missing).success).toBe(false);
    }
    for (const invalid of [
      { ...raw, extra: true },
      { decisions: { ...raw.decisions, E5: raw.decisions.E4 } },
      ...[
        null,
        {},
        {
          status: 'assigned',
          candidateRefs: [],
          reason: 'Empty',
          unresolved: null,
        },
        {
          status: 'assigned',
          candidateRefs: ['foreign'],
          reason: 'Unknown',
          unresolved: null,
        },
        {
          status: 'assigned',
          candidateRefs: ['R1'],
          reason: 'No partial field',
        },
        { status: 'ignored', reason: 'Invalid', candidateRefs: ['R1'] },
        { status: 'ignored', reason: '' },
      ].map((decision) => ({ decisions: { ...raw.decisions, E1: decision } })),
    ])
      expect(schema.safeParse(invalid).success).toBe(false);
  });

  test('emits required E keys in the actual SDK schema while referencing one shared registry definition', async () => {
    const ids = Array.from({ length: 273 }, (_, i) => `E${i + 1}`);
    const candidates = Array.from({ length: 434 }, (_, i) => `R${i + 1}`);
    const schema = createContentAttachmentResponseSchema(ids, candidates);
    const format = await Output.object({ schema }).responseFormat;
    const json = JSON.parse(JSON.stringify(format)).schema;
    expect(json.required).toEqual(['decisions']);
    expect(json.properties.decisions.required).toEqual(ids);
    expect(Object.keys(json.properties.decisions.properties)).toEqual(ids);
    expect(json.properties.decisions.additionalProperties).toBe(false);
    expect(json.properties.decisions.properties.E25).toEqual({
      $ref: '#/definitions/ContentAttachmentDecision',
    });
    expect(json.definitions.ContentAttachmentCandidate.enum).toEqual(
      candidates,
    );
    expect(json.definitions.ContentAttachmentDecision.anyOf).toHaveLength(3);
    expect(JSON.stringify(json).length).toBeLessThan(30000);
    // Separate schemas must retain their own enum even when definitions use stable names.
    const other = createContentAttachmentResponseSchema(['E1'], ['R9']);
    const otherFormat = await Output.object({ schema: other }).responseFormat;
    expect(JSON.stringify(otherFormat)).not.toContain('R434');
    expect(
      JSON.stringify(await Output.object({ schema }).responseFormat),
    ).toContain('R434');
    const missingTable = {
      decisions: Object.fromEntries(
        ids
          .slice(0, 24)
          .map((ref) => [ref, { status: 'ignored', reason: 'Fixture' }]),
      ),
    };
    const parsed = schema.safeParse(missingTable);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((i) => i.path)).toEqual(
        ids.slice(24).map((ref) => ['decisions', ref]),
      );
  });
});
