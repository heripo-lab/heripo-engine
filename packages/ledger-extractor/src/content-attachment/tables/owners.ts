import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../content-attachment';

/** Bound each row segment by its original literal identifier-cell evidence. */
export function originalIdentifierCellOwners(
  plan: ContentAttachmentPlan,
  table: AttachmentUnit['tables'][number],
): Array<Array<string | null>> {
  return table.data.grid.map((row, rowIndex) => {
    let owner: string | null = null;
    return row.map((cell, columnIndex) => {
      if (cell.isHeader) return null;
      const key = `${table.key}/grid/${rowIndex}/${columnIndex}`;
      const matches = plan.registry.filter((candidate) =>
        candidate.mentions.some(
          (mention) =>
            !!mention.sourceIdentifier &&
            mention.sourceIdentifier === cell.text &&
            mention.evidence.some(
              (e) =>
                e.resourceKey === key &&
                e.quote === cell.text &&
                e.charStart === 0 &&
                e.charEnd === cell.text.length,
            ),
        ),
      );
      if (matches.length) owner = matches.length === 1 ? matches[0].ref : null;
      return owner;
    });
  });
}
