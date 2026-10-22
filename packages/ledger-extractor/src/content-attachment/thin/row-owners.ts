import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../content-attachment';

import { originalIdentifierCellOwners } from '../tables/owners';

export type ContentAttachmentThinRowBinding =
  | {
      table: string;
      row: number;
      column: number;
      numberText: string;
      owner: string;
      name: string;
      caption: string | null;
    }
  | {
      table: string;
      row: number;
      column: number;
      numberText: string;
      ambiguous: string[];
    };
export interface ContentAttachmentThinRowOwners {
  /** Owner per table cell key; null when no owner is established. */
  owners: Map<string, string | null>;
  rowBindings: ContentAttachmentThinRowBinding[];
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');

/**
 * Establish table row owners in code.
 * Registration rows keep the original identifier-cell owner. A row without such an owner binds to a
 * candidate when one of its cells equals the candidate's original number, the candidate's original
 * name appears in the table caption or a header cell of that same column, and exactly one candidate
 * satisfies both. Row headers elsewhere (for example a table of contents) do not count. The owner
 * applies from that cell to the right, like the registration rule.
 */
export function createContentAttachmentThinRowOwners(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
): ContentAttachmentThinRowOwners {
  const owners = new Map<string, string | null>();
  const rowBindings: ContentAttachmentThinRowBinding[] = [];
  for (const t of unit.tables) {
    originalIdentifierCellOwners(plan, t).forEach((row, r) =>
      row.forEach((owner, c) => owners.set(`${t.key}/grid/${r}/${c}`, owner)),
    );
    const caption = norm(t.data.caption?.fullText);
    const columnHeaders = (ci: number) =>
      norm(
        t.data.grid
          .map((row) => (row[ci]?.isHeader ? row[ci].text : ''))
          .join(' '),
      );
    t.data.grid.forEach((row, ri) => {
      const keys = row.map((_, ci) => `${t.key}/grid/${ri}/${ci}`);
      if (keys.some((k) => owners.get(k))) return;
      for (let ci = 0; ci < row.length; ci++) {
        const cell = row[ci];
        if (cell.isHeader || !cell.text) continue;
        const typeText = `${caption} ${columnHeaders(ci)}`;
        const matches = plan.registry.filter((c) =>
          c.mentions.some(
            (m) =>
              m.sourceIdentifier &&
              norm(m.sourceIdentifier) === norm(cell.text) &&
              norm(m.sourceName).length >= 2 &&
              typeText.includes(norm(m.sourceName)),
          ),
        );
        if (!matches.length) continue;
        const location = {
          table: t.key,
          row: ri,
          column: ci,
          numberText: cell.text,
        };
        if (matches.length === 1) {
          for (let cj = ci; cj < row.length; cj++)
            if (!row[cj].isHeader) owners.set(keys[cj], matches[0].ref);
          rowBindings.push({
            ...location,
            owner: matches[0].ref,
            name: matches[0].mentions[0].sourceName,
            caption: t.data.caption?.fullText || null,
          });
        } else
          rowBindings.push({
            ...location,
            ambiguous: matches.map((c) => c.ref),
          });
        break;
      }
    });
  }
  return { owners, rowBindings };
}

/** Candidates registered from this very cell, other than its row owner. */
export function cellRegisteredCandidates(
  plan: ContentAttachmentPlan,
  cellKey: string,
  owner: string,
): string[] {
  return plan.registry
    .filter(
      (c) =>
        c.ref !== owner &&
        c.mentions.some((m) =>
          m.evidence.some((e) => e.resourceKey === cellKey),
        ),
    )
    .map((c) => c.ref);
}
