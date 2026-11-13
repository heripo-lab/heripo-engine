import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
  LedgerObjectCandidate,
} from './discovery-types';

import { candidateId } from './discovery-assembly';
import { getCandidateSources } from './discovery-request';
import { columnBlocks } from './discovery-rows';
import { sameObjectNumber } from './object-numbers';

/** The reason a code-proposed whole carries; the ledger flags such records for review. */
export const REGISTER_WHOLE_REASON =
  '코드 제안: 부록 등록표에는 이 번호의 부분(끝에 문자가 붙은 번호)만 있고, 조사 장 본문이 이 번호를 적음';

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/gu, '');
/** A part number: the whole's digits, optionally prefixed, and one trailing capital letter (`304A`). */
const PART = /^([\p{L}\d]*\d)[A-Z]$/u;

/**
 * Candidates for objects a register lists only by their parts, proposed by code after discovery (`register_parts`).
 * A register number (`registerRows`, `304` written `M304`) qualifies when every register row with that number opens
 * with a lettered part (`304A`, `304B`), discovery proposed at least one such part and no candidate of that kind
 * carries the whole number in any form, and a body block of the scope writes the number as the register says (`M304`
 * in a type list or touching Han text, `99XXM304` with its site code, not inside an item number such as `M304:15`). The candidate quotes the first such writing in plan
 * order, takes the kind and the most frequent name of its parts, and its identifier is the quoted text. Nothing is
 * proposed before discovery is complete. Deterministic and offline.
 */
export async function proposeRegisterWholeCandidates(
  plan: CandidateDiscoveryPlan,
  result: CandidateDiscoveryResult,
): Promise<LedgerObjectCandidate[]> {
  if (result.completedUnitIds.length !== plan.units.length) return [];
  const rows = new Map<string, { writtenAs: string; lettered: boolean[] }>();
  for (const unit of plan.units) {
    const table = unit.table;
    if (!table?.registerRows) continue;
    for (const row of table.registerRows) {
      const cells = unit.resources.filter(
        (r) => r.kind === 'tableCell' && r.rowIndex === row.rowIndex,
      );
      const text = (column: number) =>
        norm(
          cells.find((c) => c.kind === 'tableCell' && c.columnIndex === column)
            ?.data.text,
        );
      // a register row names its column block only when the table has blocks
      const opening =
        row.block === undefined
          ? text(0) || text(1)
          : text(row.block * columnBlocks(unit)!.columnsPerBlock);
      const entry = rows.get(row.number) ?? {
        writtenAs: row.writtenAs,
        lettered: [],
      };
      entry.lettered.push(PART.exec(opening)?.[1] === row.number);
      rows.set(row.number, entry);
    }
  }
  const proposals: LedgerObjectCandidate[] = [];
  for (const [number, { writtenAs, lettered }] of rows) {
    if (!lettered.every(Boolean)) continue;
    const parts = result.candidates.filter((c) => {
      const whole = PART.exec(norm(c.sourceIdentifier))?.[1];
      return !!whole && sameObjectNumber(whole, number);
    });
    const kinds = new Set(parts.map((c) => c.recordKind));
    if (kinds.size !== 1) continue;
    const [kind] = kinds;
    if (
      result.candidates.some(
        (c) =>
          c.recordKind === kind &&
          !!c.sourceIdentifier &&
          sameObjectNumber(norm(c.sourceIdentifier), number),
      )
    )
      continue;
    const prefix = writtenAs.slice(0, writtenAs.length - number.length);
    // the written number alone: Han or Hangul text may touch it (`发现M304，`), and a site code's digits right before
    // its letters may lead it (`99XXM304`, written `XXM304`; not a separate number such as the year in `2026 M304`),
    // but it is not inside another Latin number, an item number (`M304:15`) or a part (`M304A`)
    const pattern = new RegExp(
      `(?<![A-Za-z\\d])(?:\\d+)?${prefix.split('').join('\\s*')}\\s*${number}(?![A-Za-z\\d:：·.+*#])`,
      'u',
    );
    const found = plan.units
      .filter((u) => !u.table)
      .flatMap((unit) =>
        getCandidateSources(unit).flatMap(({ sourceId, resource }) => {
          const match = pattern.exec(resource.data.text);
          return match ? [{ unit, sourceId, resource, match }] : [];
        }),
      )[0];
    if (!found) continue;
    const { unit, sourceId, resource, match } = found;
    const names = new Map<string, number>();
    for (const c of parts)
      names.set(c.sourceName, (names.get(c.sourceName) ?? 0) + 1);
    const sourceName = [...names].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    proposals.push({
      candidateId: await candidateId(
        JSON.stringify([
          plan.inputSha256,
          'register_parts',
          kind,
          resource.key,
          match.index,
        ]),
      ),
      status: 'proposed',
      recordKind: kind,
      sourceName,
      sourceIdentifier: match[0],
      eligibilityBasis: 'register_parts',
      reason: REGISTER_WHOLE_REASON,
      chapterId: unit.chapterId,
      unitIds: [unit.unitId],
      evidence: [
        {
          sourceId,
          resourceKey: resource.key,
          resourceId: resource.resourceId,
          sourceRefs: resource.sourceRefs,
          pdfPageNo: resource.pdfPageNo,
          logicalPageRange: resource.logicalPageRange,
          quote: match[0],
          charStart: match.index,
          charEnd: match.index + match[0].length,
        },
      ],
    });
  }
  return proposals;
}

/** The discovery result with its register wholes appended once; a result that already holds them is returned as is. */
export async function withRegisterWholeCandidates(
  plan: CandidateDiscoveryPlan,
  result: CandidateDiscoveryResult,
): Promise<CandidateDiscoveryResult> {
  const known = new Set(result.candidates.map((c) => c.candidateId));
  const added = (await proposeRegisterWholeCandidates(plan, result)).filter(
    (c) => !known.has(c.candidateId),
  );
  return added.length
    ? { ...result, candidates: [...result.candidates, ...added] }
    : result;
}
