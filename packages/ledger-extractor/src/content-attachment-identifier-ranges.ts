import type { CandidateEvidence } from './candidate-discovery';
import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionResponse,
} from './content-attachment';

const trenchLabels = ['tr', 'trench', '트렌치'];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Check explicit named integer ranges without changing text or selecting targets. */
export function validateContentAttachmentIdentifierRanges(
  plan: ContentAttachmentPlan,
  excerpts: Array<{ ref: string; evidence: CandidateEvidence[] }>,
  response: ContentAttachmentSelectionResponse,
): string[] {
  const entries = plan.registry.flatMap((candidate) =>
    candidate.mentions.flatMap((mention) => {
      const match = /^(?:제\s*)?(\d+)\s*(?:호|번)?$/u.exec(
        mention.sourceIdentifier ?? '',
      );
      if (!match || !Number.isSafeInteger(Number(match[1]))) return [];
      const labels = [mention.sourceName.toLowerCase().trim()];
      if (candidate.recordKind === 'trench') labels.push(...trenchLabels);
      return labels.filter(Boolean).map((label) => ({
        label,
        ref: candidate.ref,
        number: Number(match[1]),
        scope: JSON.stringify([
          candidate.recordKind,
          mention.chapterPath.map((chapter) => chapter.id),
        ]),
      }));
    }),
  );
  if (!entries.length) return [];
  const labels = [...new Set(entries.map((entry) => entry.label))]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  const number = '(?:제\\s*)?(\\d+)\\s*(?:호|번)?';
  const range = new RegExp(
    `(?<![\\p{L}\\p{N}_.])(${labels})\\s*${number}\\s*[~～–—-]\\s*(${labels})?\\s*${number}(?![\\p{Script=Latin}\\d.])`,
    'giu',
  );
  const issues = new Set<string>();
  for (const excerpt of excerpts) {
    const assigned = response.assignments.find(
      (item) => item.excerptRef === excerpt.ref,
    );
    // A confirmed member establishes the current set; exclusions/identity-only
    // uncertainties must not be converted into assignments by a text matcher.
    if (!assigned) continue;
    for (const fragment of excerpt.evidence) {
      for (const match of fragment.quote.matchAll(range)) {
        const label = match[1].toLowerCase(),
          endLabel = match[3]?.toLowerCase(),
          start = Number(match[2]),
          end = Number(match[4]);
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          (endLabel &&
            endLabel !== label &&
            !(trenchLabels.includes(label) && trenchLabels.includes(endLabel)))
        )
          continue;
        const matches = entries.filter(
          (entry) =>
            entry.label === label &&
            entry.number >= start &&
            entry.number <= end,
        );
        const scopes = new Set(
          matches
            .filter((entry) => assigned.candidateRefs.includes(entry.ref))
            .map((entry) => entry.scope),
        );
        if (scopes.size !== 1) continue;
        const scoped = matches.filter((entry) => scopes.has(entry.scope));
        const numbers = new Set(scoped.map((entry) => entry.number));
        for (const number of numbers) {
          const refs = new Set(
            scoped
              .filter((entry) => entry.number === number)
              .map((entry) => entry.ref),
          );
          if (refs.size !== 1) continue;
          const [ref] = refs;
          if (!assigned.candidateRefs.includes(ref))
            issues.add(
              `Explicit identifier range must include ${ref}: ${excerpt.ref} (${match[0].trim()})`,
            );
        }
      }
    }
  }
  return [...issues];
}
