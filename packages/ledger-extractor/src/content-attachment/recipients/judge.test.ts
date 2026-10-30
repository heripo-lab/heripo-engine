import type * as Shared from '@heripo/shared';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import { judgeContentAttachmentRecipients } from './judge';
import { singleAreaFixture } from './recipients.test-fixture';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('makes only the recipient call and preserves its original response, attempts and usage', async () => {
  const current = singleAreaFixture();
  const usage = { inputTokens: 12, outputTokens: 6, totalTokens: 18 } as never;
  vi.mocked(LLMCaller.call).mockResolvedValue({
    output: current.audit.rawResponse,
    usage,
    usedFallback: false,
  });
  const onAttempt = vi.fn(),
    model = {} as never,
    abortSignal = new AbortController().signal;
  const result = await judgeContentAttachmentRecipients(
    current.input,
    current.segmentation,
    {
      model,
      maxRetries: 0,
      onAttempt,
      abortSignal,
    },
  );
  expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
  expect(LLMCaller.call).toHaveBeenCalledTimes(1);
  expect(LLMCaller.call).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: 'segment-recipients',
      maxRetries: 0,
      abortSignal,
    }),
  );
  expect(result.rawResponse).toBe(current.audit.rawResponse);
  expect(result.usage).toBe(usage);
  expect(result.callAttempts).toEqual([]);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      result,
    ).issues,
  ).toEqual([]);
});
