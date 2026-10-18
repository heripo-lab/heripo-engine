import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';

type Grounded = ReturnType<typeof createContentAttachmentGroundedInput>;
type Input = {
  bodyCandidateContexts: Grounded['bodyCandidateContexts'];
  payload: Pick<Grounded['payload'], 'candidates'> & {
    current: Pick<Grounded['payload']['current'], 'excerpts' | 'bodyBlocks'>;
  };
};

export interface ReviewReferentMatch {
  excerptRef: string;
  contextExcerptRefs: string[];
  candidateRef: string;
  contextRef: string;
  sourceName: string;
  matchedIdentifier?: string;
}

function mentionsName(text: string, sourceName: string) {
  const name = sourceName
    .normalize('NFC')
    .replace(/^\s*[\dIVXivx]+[.)]\s*/u, '');
  const letterCount = name.match(/\p{L}/gu)?.length ?? 0;
  if (letterCount === 0 || (letterCount < 2 && !/\d/u.test(name))) return false;
  const letters = [...name.replace(/\s/gu, '')];
  const pattern = letters
    .map((letter) => letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  const normalized = text.normalize('NFC');
  for (const match of normalized.matchAll(new RegExp(pattern, 'giu'))) {
    const before = normalized.slice(0, match.index).at(-1) ?? '';
    const after =
      normalized.slice(match.index + match[0].length, undefined)[0] ?? '';
    if (
      (/\d/u.test(letters[0]) && /\d/u.test(before)) ||
      (/\d/u.test(letters.at(-1)!) && /\d/u.test(after))
    )
      continue;
    if (
      (/\p{Script=Latin}/u.test(letters[0]) && /[\p{L}\p{N}]/u.test(before)) ||
      (/\p{Script=Latin}/u.test(letters.at(-1)!) && /[\p{L}\p{N}]/u.test(after))
    )
      continue;
    return true;
  }
  return false;
}

/** Retrieve review alternatives from literal registered names, never from expected labels. */
export function retrieveContentAttachmentReviewReferents(input: Input) {
  const excerpts = input.payload.current.excerpts;
  const eligible = new Set(
    input.bodyCandidateContexts.map(([ref, context]) =>
      JSON.stringify([ref, context]),
    ),
  );
  const matches: ReviewReferentMatch[] = [];
  for (const excerpt of excerpts) {
    const block = input.payload.current.bodyBlocks.find((b) =>
      b[1].includes(excerpt[0]),
    );
    const refs = block?.[1] ?? [excerpt[0]];
    const text = excerpts
      .filter((e) => refs.includes(e[0]))
      .map((e) => e[4])
      .join(' ');
    for (const row of input.payload.candidates) {
      const [candidateRef, , contextRef, sourceName] = row as string[];
      if (!eligible.has(JSON.stringify([candidateRef, contextRef]))) continue;
      const sourceIdentifier = row[4] as string | null;
      const nameMatch = mentionsName(text, sourceName);
      const identifierMatch =
        !nameMatch &&
        sourceIdentifier !== null &&
        (sourceIdentifier.match(/\p{L}/gu)?.length ?? 0) >= 2 &&
        mentionsName(text, sourceIdentifier);
      if (!nameMatch && !identifierMatch) continue;
      if (
        matches.some(
          (m) =>
            m.excerptRef === excerpt[0] &&
            m.candidateRef === candidateRef &&
            m.contextRef === contextRef,
        )
      )
        continue;
      matches.push({
        excerptRef: excerpt[0],
        contextExcerptRefs: [...refs],
        candidateRef,
        contextRef,
        sourceName,
        ...(identifierMatch ? { matchedIdentifier: sourceIdentifier! } : {}),
      });
    }
  }
  return matches;
}
