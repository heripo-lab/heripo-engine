import type * as Ai from 'ai';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { CONTENT_ATTACHMENT_EVIDENCE_WINDOW_POLICY } from './evidence-window-policy';
import {
  createContentAttachmentEvidenceWindowRequest,
  projectContentAttachmentEvidenceWindowChain as project,
  resolveContentAttachmentEvidenceWindowRange as resolve,
} from './evidence-windows';
import { evidenceWindowFixture } from './evidence-windows.test-fixture';
import { createContentAttachmentSourceContextRequest } from './source-context';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>();
  return {
    ...actual,
    Output: { ...actual.Output, object: vi.fn(actual.Output.object) },
  };
});

test('preserves original views, prompts, all candidates and legacy versions without network access', async () => {
  const fetch = vi.fn(() => {
    throw new Error('No network');
  });
  vi.stubGlobal('fetch', fetch);
  const f = await evidenceWindowFixture(true, true);
  const original = JSON.stringify({
    document: f.document,
    plan: f.plan,
    segmentation: f.segmentation,
  });
  for (const version of [
    'segment-recipients.v25',
    'segment-recipients.v26',
  ] as const) {
    const old = createContentAttachmentSourceContextRequest(
      f.plan,
      f.unit,
      f.segmentation,
      f.options,
      version,
    );
    const oldJSON = JSON.stringify({
      userPrompt: old.userPrompt,
      systemPrompt: old.systemPrompt,
      wordEvidence: old.wordEvidence,
    });
    const newRequest = await createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
      f.options,
      version,
    );
    expect(newRequest.version).toBe('content-evidence-windows.v1');
    expect(newRequest.executionMode).toBe('offline-only');
    expect(newRequest.systemPrompt).toBe(old.systemPrompt);
    const payload = JSON.parse(newRequest.userPrompt),
      expected = JSON.parse(old.userPrompt);
    for (const s of [...payload.current, ...payload.sourceContext.sources]) {
      s.words = s.wordWindows.flatMap((q: any) =>
        q.words.map(([, ref, text]: string[]) => [ref, text]),
      );
      delete s.wordWindows;
    }
    delete payload.evidenceWindowContract;
    expect(payload).toEqual(expected);
    expect(newRequest.sourceRequest.wordEvidence).toEqual(old.wordEvidence);
    expect(
      JSON.stringify({
        userPrompt: old.userPrompt,
        systemPrompt: old.systemPrompt,
        wordEvidence: old.wordEvidence,
      }),
    ).toBe(oldJSON);
    expect(newRequest).toEqual(
      await createContentAttachmentEvidenceWindowRequest(
        f.document,
        f.plan,
        f.unit,
        f.segmentation,
        f.options,
        version,
      ),
    );
  }
  expect(
    JSON.stringify({
      document: f.document,
      plan: f.plan,
      segmentation: f.segmentation,
    }),
  ).toBe(original);
  f.request.sourceRequest.wordEvidence.sources[0].words[0].charEnd--;
  expect(
    JSON.stringify({
      document: f.document,
      plan: f.plan,
      segmentation: f.segmentation,
    }),
  ).toBe(original);
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('accepts exactly the original local endpoints, including multi-digit Q and L references', async () => {
  const f = await evidenceWindowFixture(true);
  const schema = f.request.providerOutputSchema as any;
  const regex = new RegExp(schema.definitions.WindowWordRange.pattern);
  expect(
    schema.definitions.WorkTargetGroup.properties.targetIdentification
      .properties.currentWordRanges.items,
  ).toEqual({ $ref: '#/definitions/WindowWordRange' });
  let checks = 0;
  for (const w of f.request.windows)
    for (let a = 0; a <= w.originalWords.length + 1; a++)
      for (let b = 0; b <= w.originalWords.length + 1; b++) {
        expect(regex.test(`${w.ref}:L${a}-L${b}`)).toBe(
          a >= 1 && a <= b && b <= w.originalWords.length,
        );
        checks++;
      }
  expect(checks).toBe(981);
  for (const ref of ['Q9999:L1-L1', 'Q01:L1-L1', 'Q1:L01-L1', 'Q1:L1-L0'])
    expect(regex.test(ref)).toBe(false);
});

test('resolves current roles by segment membership, with legacy direct evidence in a context field', async () => {
  const f = await evidenceWindowFixture(false, true);
  const direct =
    f.response.decisions[f.segmentRef].areaAssessments.R1.currentWordRanges[0];
  expect(resolve(f.request, direct, f.segmentRef, true)).toMatchObject({
    basis: 'direct',
    text: '현황',
    field: 'text',
  });
  expect(resolve(f.request, direct, f.segmentRef)).toMatchObject({
    basis: 'direct',
  });
  const outside = f.encode(
    f.request.sourceRequest.segmentSnapshot[1].evidence[0].range,
  )[0];
  expect(() => resolve(f.request, outside, f.segmentRef, true)).toThrow(
    'OUTSIDE_CURRENT_SEGMENT',
  );
  const eContext = f.request.windows.find(
    (w) =>
      w.sourceRef.startsWith('E') &&
      w.sourceRef !== f.request.sourceRequest.segmentSnapshot[0].excerptRef,
  )!;
  expect(
    resolve(f.request, eContext.ref + ':L1-L1', f.segmentRef),
  ).toMatchObject({ basis: 'context' });
  expect(() =>
    resolve(f.request, eContext.ref + ':L1-L1', f.segmentRef, true),
  ).toThrow('CURRENT_SOURCE_MISMATCH');
  expect(() => resolve(f.request, direct, 'foreign')).toThrow(
    'UNKNOWN_SEGMENT',
  );
  for (const r of ['Q0:L1-L1', 'Q01:L1-L1', 'Q1:L0-L1'])
    expect(() => resolve(f.request, r, f.segmentRef)).toThrow(
      'MALFORMED_WINDOW_RANGE',
    );
  expect(() => resolve(f.request, 'Q9999:L1-L1', f.segmentRef)).toThrow(
    'UNKNOWN_WINDOW',
  );
  for (const r of ['Q1:L2-L1', 'Q1:L1-L99', 'Q1:L99-L99'])
    expect(() => resolve(f.request, r, f.segmentRef)).toThrow(
      'WINDOW_BOUNDARY_INVALID',
    );
});

test('projects only ordered adjacent original words and retains exact whitespace and source boundaries', async () => {
  const f = await evidenceWindowFixture(true);
  const source = f.request.sourceRequest.wordEvidence.sources.find(
    (s) => s.resourceKey === '/chapters/0/textBlocks/4',
  )!;
  const ranges = f.encode(source.ref + ':W16-W35');
  const result = project(f.request, ranges, f.segmentRef);
  expect(result.text).toBe(source.text.slice(source.words[15].charStart));
  expect(result.text).toContain('\t(미완😀');
  expect(result.text).toContain('  ');
  expect(result.selections.map((s) => s.windowRange)).toEqual(ranges);
  expect(() => project(f.request, [], f.segmentRef)).toThrow(
    'EMPTY_WINDOW_CHAIN',
  );
  expect(() =>
    project(f.request, [ranges[0], ranges[2]], f.segmentRef),
  ).toThrow('NONCONTIGUOUS_ORIGINAL_WORDS');
  expect(() => project(f.request, [...ranges].reverse(), f.segmentRef)).toThrow(
    'NONMONOTONIC_CHAIN',
  );
  const caption = f.request.windows.find(
    (w) =>
      f.request.sourceRequest.contextBindings.sources.find(
        (b) => b.ref === w.sourceRef,
      )?.field === 'fullText',
  )!;
  expect(
    resolve(f.request, caption.ref + ':L1-L4', f.segmentRef),
  ).toMatchObject({ field: 'fullText', text: '표 9 조사 일지' });
  expect(() =>
    resolve(f.request, caption.ref + ':L1-L6', f.segmentRef),
  ).toThrow('WINDOW_BOUNDARY_INVALID');
  expect(() =>
    project(f.request, [ranges[0], caption.ref + ':L1-L1'], f.segmentRef),
  ).toThrow('DIFFERENT_ORIGINAL_SOURCE');
  const current =
    f.response.decisions[f.segmentRef].areaAssessments.R1.currentWordRanges;
  expect(project(f.request, current, f.segmentRef, true).text).toBe(
    '현황 측량',
  );
});

test('supports the default offline options without changing the frozen legacy generator', async () => {
  const f = await evidenceWindowFixture();
  const r = await createContentAttachmentEvidenceWindowRequest(
    f.document,
    f.plan,
    f.unit,
    f.segmentation,
  );
  expect(r.contextOptions).toEqual({});
  expect(r.baseVersion).toBe('segment-recipients.v26');
  await expect(
    createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
      {},
      'foreign' as never,
    ),
  ).rejects.toThrow('Invalid evidence-window base version');
});

test('rejects a changed provider schema contract or non-object output without a provider call', async () => {
  const f = await evidenceWindowFixture();
  const spy = vi.mocked(Output.object).mockReturnValueOnce({
    responseFormat: Promise.resolve({ type: 'text' }),
  } as never);
  await expect(
    createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
    ),
  ).rejects.toThrow('Expected object output');
  spy.mockReturnValueOnce({
    responseFormat: Promise.resolve({
      type: 'json',
      schema: { definitions: {} },
    }),
  } as never);
  await expect(
    createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
    ),
  ).rejects.toThrow('Window schema contract differs');
  expect(spy).toHaveBeenCalled();
});

test.each(['segment-recipients.v25', 'segment-recipients.v26'] as const)(
  'adds only opt-in Q/L instructions while preserving the %s base request and schema',
  async (baseVersion) => {
    const f = await evidenceWindowFixture(true, true);
    const before = JSON.stringify({
      document: f.document,
      plan: f.plan,
      segmentation: f.segmentation,
    });
    const old = await createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
      f.options,
      baseVersion,
    );
    const explicitOld = await createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
      f.options,
      baseVersion,
      'content-evidence-windows.v1',
    );
    expect(explicitOld).toEqual(old);
    const current = await createContentAttachmentEvidenceWindowRequest(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
      f.options,
      baseVersion,
      'content-evidence-windows.v2',
    );
    expect(current.version).toBe('content-evidence-windows.v2');
    expect(current.executionMode).toBe('offline-only');
    expect(current.systemPrompt).toBe(
      old.systemPrompt + '\n\n' + CONTENT_ATTACHMENT_EVIDENCE_WINDOW_POLICY,
    );
    expect(current.userPrompt).toBe(old.userPrompt);
    expect(current.providerOutputSchema).toEqual(old.providerOutputSchema);
    const {
      version: _oldVersion,
      systemPrompt: _oldPrompt,
      snapshotSha256: oldHash,
      ...oldOther
    } = old;
    const {
      version: _version,
      systemPrompt: _prompt,
      snapshotSha256: hash,
      ...other
    } = current;
    expect(other).toEqual(oldOther);
    expect(hash).not.toBe(oldHash);
    expect(
      JSON.stringify({
        document: f.document,
        plan: f.plan,
        segmentation: f.segmentation,
      }),
    ).toBe(before);
    await expect(
      createContentAttachmentEvidenceWindowRequest(
        f.document,
        f.plan,
        f.unit,
        f.segmentation,
        f.options,
        baseVersion,
        'foreign' as never,
      ),
    ).rejects.toThrow('Invalid evidence-window version');
  },
);
