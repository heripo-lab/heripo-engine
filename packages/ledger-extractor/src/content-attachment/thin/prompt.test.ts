import type * as Recipients from '../recipients/recipients';
import type { ContentAttachmentThinCompilation } from './compile';

import { describe, expect, test, vi } from 'vitest';

import { contentAttachmentRecipientSystemPrompt } from '../recipients/recipients';
import {
  CONTENT_ATTACHMENT_THIN_VERSION,
  contentAttachmentThinRestoredRules,
  contentAttachmentThinSystemPrompt,
  createContentAttachmentThinRequest,
  createContentAttachmentThinSchema,
} from './prompt';

vi.mock('../recipients/recipients', async (importOriginal) => {
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
  test('sends the compact input as the user prompt', () => {
    const c = compilation();

    const request = createContentAttachmentThinRequest(c);

    expect(request.version).toBe(CONTENT_ATTACHMENT_THIN_VERSION);
    expect(request.systemPrompt).toBe(contentAttachmentThinSystemPrompt());
    expect(request.userPrompt).toBe(JSON.stringify(c.input));
    expect(request.providerOutputSchema).toEqual(
      createContentAttachmentThinSchema(c),
    );
  });
});
