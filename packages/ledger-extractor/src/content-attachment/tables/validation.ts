import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type {
  AttachmentUnit,
  ContentAttachmentPlan,
  ContentAttachmentSelectionResponse,
} from '../content-attachment';

import { originalIdentifierCellOwners } from './owners';

// Match only explicit column labels; object headings are not generic headers.
const genericLabels = new Set([
  '호수',
  '번호',
  '유구번호',
  '유물번호',
  '명칭',
  '이름',
  '규모',
  '평면형태',
  '형태',
  '칸수',
  '내부시설',
  '비고',
  '크기',
  '치수',
  '재질',
  '수량',
  'number',
  'no.',
  'name',
  'dimensions',
  'size',
  'shape',
  'material',
  'quantity',
  'remarks',
  'notes',
]);

/** Report bounded table inconsistencies without modifying source or model decisions. */
export function validateContentAttachmentTables(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  excerpts: Array<{ ref: string; evidence: CandidateEvidence[] }>,
  response: ContentAttachmentSelectionResponse,
  identifierAnchorsOnly = false,
): string[] {
  const issues: string[] = [];
  const assigned = new Map(
    response.assignments.map((a) => [a.excerptRef, a.candidateRefs]),
  );
  const ignored = new Set(response.ignored.map((a) => a.excerptRef));
  for (const table of unit.tables) {
    const owners = identifierAnchorsOnly
      ? originalIdentifierCellOwners(plan, table)
      : table.data.grid.map((row, rowIndex) => {
          const matches = plan.registry.filter((candidate) =>
            candidate.mentions.some(
              (mention) =>
                !!mention.sourceIdentifier &&
                row.some((cell) => cell.text === mention.sourceIdentifier) &&
                (mention.evidence.some((e) =>
                  e.resourceKey.startsWith(`${table.key}/grid/${rowIndex}/`),
                ) ||
                  (!!mention.sourceName &&
                    !!table.data.caption?.fullText.includes(
                      mention.sourceName,
                    ))),
            ),
          );
          const owner = matches.length === 1 ? matches[0].ref : null;
          return row.map(() => owner);
        });
    table.data.grid.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const key = `${table.key}/grid/${rowIndex}/${columnIndex}`;
        const excerpt = excerpts.find((e) =>
          e.evidence.some((f) => f.resourceKey === key),
        );
        if (!excerpt) return;
        const owner = owners[rowIndex][columnIndex];
        if (owner) {
          if (!assigned.get(excerpt.ref)?.includes(owner))
            issues.push(
              `Identified table-row cell must include ${owner}: ${excerpt.ref}`,
            );
          return;
        }
        const label = cell.text
          .trim()
          .replace(/\s*[（(][^()（）]*[)）]\s*$/u, '')
          .toLowerCase();
        if (
          genericLabels.has(label) &&
          (cell.isHeader ||
            (rowIndex === 0 &&
              owners.some((row) => row.some((ref) => ref !== null)))) &&
          !ignored.has(excerpt.ref)
        )
          issues.push(`Generic table header must be ignored: ${excerpt.ref}`);
      });
    });
  }
  return issues;
}
