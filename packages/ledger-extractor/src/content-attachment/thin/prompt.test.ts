import type * as Recipients from '../recipients/prompt';
import type { ContentAttachmentThinCompilation } from './compile-types';
import type { ContentAttachmentThinRequestVersion } from './prompt';

import { describe, expect, test, vi } from 'vitest';

import { contentAttachmentRecipientSystemPrompt } from '../recipients/prompt';
import {
  CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION,
  CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION,
  CONTENT_ATTACHMENT_THIN_ARRAY_VERSION,
  CONTENT_ATTACHMENT_THIN_CATALOG_VERSION,
  CONTENT_ATTACHMENT_THIN_HEADINGS_VERSION,
  CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION,
  CONTENT_ATTACHMENT_THIN_LAYER_VERSION,
  CONTENT_ATTACHMENT_THIN_LINKED_VERSION,
  CONTENT_ATTACHMENT_THIN_VERSION,
  contentAttachmentThinRestoredRules,
  contentAttachmentThinSystemPrompt,
  createContentAttachmentThinArraySchema,
  createContentAttachmentThinRequest,
  createContentAttachmentThinSchema,
} from './prompt';

vi.mock('../recipients/prompt', async (importOriginal) => {
  const original = await importOriginal<typeof Recipients>();
  return {
    ...original,
    contentAttachmentRecipientSystemPrompt: vi.fn(
      original.contentAttachmentRecipientSystemPrompt,
    ),
  };
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `W${i + 1}`);
function compilation(): ContentAttachmentThinCompilation {
  return {
    version: 'content-attachment-thin-compile.v1',
    input: {
      candidateColumns: ['ref'],
      contexts: {},
      candidates: [],
      uncertainties: [],
      handleColumns: ['ref', 'chapterPath', 'kind', 'memberCount'],
      handles: [],
      chapters: [],
      bodyBlocks: [],
      bodySequences: [],
      tableLocations: [],
      tables: [],
      readOnlyContext: [],
    },
    codeMap: {
      unitId: 'page-1',
      segments: ['E1:S1', 'E2:S1'],
      candidateRefs: ['R1', 'R3'],
      windows: [
        { ref: 'Q1', sourceRef: 'E1', originalWords: words(16) },
        { ref: 'Q2', sourceRef: 'E1', originalWords: words(3) },
        { ref: 'Q3', sourceRef: 'E2', originalWords: words(16) },
      ],
      codeAssigned: [],
      segSpans: [],
      rowBindings: [],
      handles: [
        { ref: 'H1', members: ['R1'] },
        { ref: 'H2', members: ['R3'] },
      ],
    },
  };
}

describe('contentAttachmentThinRestoredRules', () => {
  test('keeps rule sentences verbatim and drops field-only contracts', () => {
    const rules = contentAttachmentThinRestoredRules();

    expect(contentAttachmentRecipientSystemPrompt).toHaveBeenCalledWith(
      'segment-recipients.v26',
    );
    expect(rules.split('\n\n')).toHaveLength(11);
    expect(rules).toContain(
      'Keep whole project areas distinct from partial survey areas.',
    );
    expect(rules).toContain(
      'Do not identify a relationship counterpart across investigation stages without original linking evidence.',
    );
    expect(rules).not.toContain('areaAssessments');
    expect(rules).not.toContain('That list accepts only candidates');
    expect(rules).not.toContain('INDEPENDENT AREA ASSESSMENTS:');
  });

  test('refuses a recipient prompt whose paragraphs changed', () => {
    vi.mocked(contentAttachmentRecipientSystemPrompt).mockReturnValueOnce(
      'One paragraph.',
    );

    expect(() => contentAttachmentThinRestoredRules()).toThrow(
      'Recipient prompt paragraphs changed',
    );
  });
});

describe('contentAttachmentThinSystemPrompt', () => {
  test('joins the base prompt, format bridge, relation rule and restored rules', () => {
    const prompt = contentAttachmentThinSystemPrompt();

    expect(prompt.startsWith('You attach source segments')).toBe(true);
    expect(prompt).toContain('\n\nMAPPING TO THIS OUTPUT:');
    expect(prompt).toContain('\n\nRELATION COUNTERPARTS:');
    expect(prompt.endsWith(contentAttachmentThinRestoredRules())).toBe(true);
    expect(prompt).not.toContain('PAGE BOUNDARY:');
  });

  test('appends the page-boundary rule only for linked compilations', () => {
    const linked = contentAttachmentThinSystemPrompt({ linked: true });

    expect(linked.startsWith(contentAttachmentThinSystemPrompt())).toBe(true);
    expect(linked).toContain('\n\nPAGE BOUNDARY: Read-only blocks');
  });
});

describe('createContentAttachmentThinSchema', () => {
  test('requires every judged segment and limits ranges to existing windows', () => {
    const schema = createContentAttachmentThinSchema(compilation());

    expect(schema.properties.d.required).toEqual(['E1:S1', 'E2:S1']);
    expect(schema.$defs.cand.enum).toEqual(['R1', 'R3']);
    expect(schema.$defs.hnd.enum).toEqual(['H1', 'H2']);
    expect(schema.$defs.range.pattern).toBe(
      '^(?:Q(?:1|3):L(?:[1-9]|1[0-6])-L(?:[1-9]|1[0-6])|Q(?:2):L(?:[1-3])-L(?:[1-3]))$',
    );
    const range = new RegExp(schema.$defs.range.pattern);
    expect(['Q1:L1-L16', 'Q2:L3-L3'].every((r) => range.test(r))).toBe(true);
    expect(
      ['Q1:L17-L17', 'Q2:L4-L4', 'Q4:L1-L1'].some((r) => range.test(r)),
    ).toBe(false);
    expect(schema.$defs.decision.anyOf.map((o) => o.required)).toEqual([
      ['k', 'r', 'h', 'x', 'ia', 'sa', 'e'],
      ['k'],
    ]);
  });
});

describe('createContentAttachmentThinRequest', () => {
  test('sends the compact input as the user prompt in the object format', () => {
    const c = compilation();

    const request = createContentAttachmentThinRequest(c, { format: 'object' });

    expect(request.version).toBe(CONTENT_ATTACHMENT_THIN_VERSION);
    expect(request.systemPrompt).toBe(contentAttachmentThinSystemPrompt());
    expect(request.userPrompt).toBe(JSON.stringify(c.input));
    expect(request.providerOutputSchema).toEqual(
      createContentAttachmentThinSchema(c),
    );
  });

  test('uses the linked prompt version and rule for linked compilations', () => {
    for (const version of [
      'content-attachment-thin-compile.v4',
      'content-attachment-thin-compile.v5',
    ] as const) {
      const request = createContentAttachmentThinRequest(
        { ...compilation(), version },
        { format: 'object' },
      );
      const array = createContentAttachmentThinRequest({
        ...compilation(),
        version,
      });

      expect(request.version).toBe(CONTENT_ATTACHMENT_THIN_LINKED_VERSION);
      expect(request.systemPrompt).toBe(
        contentAttachmentThinSystemPrompt({ linked: true }),
      );
      expect(array.version).toBe(CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION);
      expect(array.systemPrompt).toBe(
        contentAttachmentThinSystemPrompt({
          linked: true,
          format: 'array',
          headings: true,
          aggregate: true,
        }),
      );
      expect(array.systemPrompt).toContain('PAGE BOUNDARY:');
    }
  });

  test('adds the catalog-entry rule after the heading rule in v12, and the collective-summary rule after both in v13 and v14', () => {
    const c = compilation();
    const build = (version: ContentAttachmentThinRequestVersion) =>
      createContentAttachmentThinRequest(c, { version });

    const v11 = build(CONTENT_ATTACHMENT_THIN_HEADINGS_VERSION);
    const v12 = build(CONTENT_ATTACHMENT_THIN_CATALOG_VERSION);
    const v13 = build(CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION);
    const v14 = build(CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION);

    expect(v12.version).toBe(CONTENT_ATTACHMENT_THIN_CATALOG_VERSION);
    expect(v12.systemPrompt.startsWith(v11.systemPrompt)).toBe(true);
    expect(v12.systemPrompt).toContain('\n\nCATALOG ENTRIES:');
    expect(v11.systemPrompt).not.toContain('CATALOG ENTRIES:');
    expect(v12.providerOutputSchema).toEqual(v11.providerOutputSchema);
    expect(v13.systemPrompt.startsWith(v11.systemPrompt)).toBe(true);
    expect(v13.systemPrompt).toContain('\n\nCOUNTS AND COLLECTIVE SUMMARIES:');
    expect(v13.systemPrompt).not.toContain('CATALOG ENTRIES:');
    expect(v14.systemPrompt.startsWith(v12.systemPrompt)).toBe(true);
    expect(v14.systemPrompt).toContain('COUNTS AND COLLECTIVE SUMMARIES:');
    expect(v12.systemPrompt).not.toContain('COUNTS AND COLLECTIVE');
    expect(v14.providerOutputSchema).toEqual(v11.providerOutputSchema);
  });

  test('adds the layer-context rule after the collective-summary rule in v15 and v16', () => {
    const c = compilation();
    const build = (version: ContentAttachmentThinRequestVersion) =>
      createContentAttachmentThinRequest(c, { version });

    const v13 = build(CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION);
    const v14 = build(CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION);
    const v15 = build(CONTENT_ATTACHMENT_THIN_LAYER_VERSION);
    const v16 = build(CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION);

    expect(v15.systemPrompt.startsWith(v13.systemPrompt)).toBe(true);
    expect(v15.systemPrompt).toContain('\n\nLAYER CONTEXTS:');
    expect(v15.systemPrompt).not.toContain('CATALOG ENTRIES:');
    expect(v16.systemPrompt.startsWith(v14.systemPrompt)).toBe(true);
    expect(v16.systemPrompt).toContain('LAYER CONTEXTS:');
    expect(v14.systemPrompt).not.toContain('LAYER CONTEXTS:');
    expect(v16.version).toBe(CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION);
    expect(v16.providerOutputSchema).toEqual(v13.providerOutputSchema);
  });

  test('defaults to v13: the array format with one schema for every unit and the heading and collective-summary rules', () => {
    const c = compilation();

    const request = createContentAttachmentThinRequest(c);
    const v10 = createContentAttachmentThinRequest(c, {
      version: CONTENT_ATTACHMENT_THIN_ARRAY_VERSION,
    });
    const v8 = createContentAttachmentThinRequest(c, {
      version: CONTENT_ATTACHMENT_THIN_VERSION,
    });
    const schema = createContentAttachmentThinArraySchema();
    const items = (
      schema.properties.d.items as { anyOf: Array<{ required: string[] }> }
    ).anyOf;

    expect(request.version).toBe(CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION);
    expect(request.systemPrompt).toContain(
      'HEADINGS AND DISCUSSION STATEMENTS',
    );
    expect(request.systemPrompt).toContain('COUNTS AND COLLECTIVE SUMMARIES');
    expect(request.systemPrompt).not.toContain('LAYER CONTEXTS:');
    expect(v10.version).toBe(CONTENT_ATTACHMENT_THIN_ARRAY_VERSION);
    expect(v10.systemPrompt).not.toContain('HEADINGS AND DISCUSSION');
    expect(request.systemPrompt.startsWith(v10.systemPrompt)).toBe(true);
    expect(v10.providerOutputSchema).toEqual(schema);
    expect(v8).toEqual(
      createContentAttachmentThinRequest(c, { format: 'object' }),
    );
    expect(request.providerOutputSchema).toEqual(schema);
    expect(request.userPrompt).toBe(JSON.stringify(c.input));
    expect(request.systemPrompt).toContain(
      'Return d as an array with exactly one item per listed segment',
    );
    expect(request.systemPrompt).toContain('and are not items of d.');
    expect(request.systemPrompt).not.toContain('segment key in d');
    expect(request.systemPrompt).not.toContain('PAGE BOUNDARY:');
    expect(items.map((o) => o.required)).toEqual([
      ['s', 'k', 'r', 'h', 'x', 'ia', 'sa', 'e'],
      ['s', 'k'],
    ]);
    expect(JSON.stringify(schema)).not.toContain('enum":["R');
  });
});
