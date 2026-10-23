import type * as Recipients from '../recipients/prompt';
import type { ContentAttachmentThinCompilation } from './compile-types';

import { describe, expect, test, vi } from 'vitest';

import { contentAttachmentRecipientSystemPrompt } from '../recipients/prompt';
import {
  CONTENT_ATTACHMENT_THIN_ARRAY_VERSION,
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
      expect(array.version).toBe(CONTENT_ATTACHMENT_THIN_ARRAY_VERSION);
      expect(array.systemPrompt).toBe(
        contentAttachmentThinSystemPrompt({ linked: true, format: 'array' }),
      );
      expect(array.systemPrompt).toContain('PAGE BOUNDARY:');
    }
  });

  test('defaults to the array format with one schema for every unit', () => {
    const c = compilation();

    const request = createContentAttachmentThinRequest(c);
    const schema = createContentAttachmentThinArraySchema();
    const items = (
      schema.properties.d.items as { anyOf: Array<{ required: string[] }> }
    ).anyOf;

    expect(request.version).toBe(CONTENT_ATTACHMENT_THIN_ARRAY_VERSION);
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
