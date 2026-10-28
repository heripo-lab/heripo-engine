import type {
  CandidateDiscoveryCorrection,
  CandidateDiscoveryNumberedBlock,
  CandidateDiscoveryReconsideration,
  CandidateDiscoveryResponse,
  CandidateDiscoveryUnit,
  CandidateEvidence,
} from './discovery-types';

import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  RECONSIDERED_EXCLUSIONS_RULE,
  SIDE_BY_SIDE_TABLES_RULE,
  UNANSWERED_NUMBERED_BLOCKS_RULE,
  UNANSWERED_NUMBERED_BLOCKS_RULE_V15,
  createCandidateDiscoveryRequest,
  getCandidateSources,
  isSectionHeading,
  sectionHeadingTitle,
} from './discovery-request';
import {
  columnBlocks,
  createFollowUpUnit,
  unansweredItemTableBlocks,
  unansweredItemTableRows,
} from './discovery-rows';

/** A figure, plate or photograph reference copied into an identifier. */
const FIGURE_REFERENCE = /도면|도판|사진|그림|Fig\./u;
/** An independent body names its object within this many leading non-space characters of an evidence block. */
export const CANDIDATE_DISCOVERY_NAME_LEAD_CHARS = 15;

const compact = (text: string) => text.replace(/\s+/gu, '');

/**
 * Version-dependent checks: strict table identifiers from v6, table roles and name cells from v9, name leads and
 * corrections from v10, heading reconsideration and row blocks from v11, follow-up rules in the follow-up input from
 * v12, numbered body blocks from v13, missing catalog numbers of body artifacts from v14, numbered area, trench and grid labels among numbered blocks from v15.
 */
export interface CandidateCheckLevel {
  strictTableIdentifier: boolean;
  v9: boolean;
  v10: boolean;
  v11: boolean;
  v12: boolean;
  v13: boolean;
  v14: boolean;
  v15: boolean;
}

export function candidateCheckLevel(
  promptVersion: string,
): CandidateCheckLevel {
  const v15 = promptVersion === CANDIDATE_DISCOVERY_PROMPT_VERSION;
  const v14 = v15 || promptVersion === 'candidate-discovery.v14';
  const v13 = v14 || promptVersion === 'candidate-discovery.v13';
  const v12 = v13 || promptVersion === 'candidate-discovery.v12';
  const v11 = v12 || promptVersion === 'candidate-discovery.v11';
  const v10 = v11 || promptVersion === 'candidate-discovery.v10';
  const v9 = v10 || promptVersion === 'candidate-discovery.v9';
  return {
    strictTableIdentifier:
      v9 ||
      [
        'candidate-discovery.v6',
        'candidate-discovery.v7',
        'candidate-discovery.v8',
      ].includes(promptVersion),
    v9,
    v10,
    v11,
    v12,
    v13,
    v14,
    v15,
  };
}

/**
 * Header cell texts of a table unit; headerRows are the first grid rows and may hold data, so only marked cells
 * count.
 */
function headerTexts(
  unit: CandidateDiscoveryUnit & {
    table: NonNullable<CandidateDiscoveryUnit['table']>;
  },
) {
  return new Set(
    [
      ...unit.table.headerRows
        .flat()
        .flatMap((cell) =>
          typeof cell !== 'string' && cell.isHeader ? [cell.text] : [],
        ),
      ...unit.resources.flatMap((r) =>
        r.kind === 'tableCell' && r.data.isHeader ? [r.data.text] : [],
      ),
    ].map((t) => t.trim()),
  );
}

/**
 * Resolve a proposal's evidence to exact input locations and check it. Returns the resolved evidence and the first
 * failed check, or an empty reason when the proposal is valid. Never changes the proposal.
 */
export function checkCandidate(
  unit: CandidateDiscoveryUnit,
  proposal: CandidateDiscoveryResponse['candidates'][number],
  tableRole: CandidateDiscoveryResponse['tableRole'],
  level: CandidateCheckLevel,
): { evidence: CandidateEvidence[]; invalid: string } {
  const sources = getCandidateSources(unit);
  const evidence: CandidateEvidence[] = [];
  for (const pointer of proposal.evidence) {
    const resource = sources.find(
      (source) => source.sourceId === pointer.sourceId,
    )?.resource;
    const start = resource?.data.text.indexOf(pointer.quote) ?? -1;
    if (!resource || start < 0) break;
    evidence.push({
      sourceId: pointer.sourceId,
      resourceKey: resource.key,
      resourceId: resource.resourceId,
      sourceRefs: resource.sourceRefs,
      pdfPageNo: resource.pdfPageNo,
      logicalPageRange: resource.logicalPageRange,
      quote: pointer.quote,
      charStart: start,
      charEnd: start + pointer.quote.length,
    });
  }
  // a table item named from the caption, chapter titles or context may still select its number cell
  const tableNameTexts = [
    ...unit.context.map((r) => r.text),
    ...unit.chapterPath.map((c) => c.originTitle),
    unit.table?.caption ?? '',
  ];
  const sourceText = [
    ...unit.resources.map((r) => r.data.text),
    ...tableNameTexts,
  ];
  const identifierCell = sources.find(
    (source) => source.sourceId === proposal.identifierSourceId,
  );
  const nameCell =
    proposal.nameSourceId == null
      ? null
      : sources.find((source) => source.sourceId === proposal.nameSourceId)
          ?.resource;
  const firstCell = sources.find(
    (source) => source.sourceId === proposal.evidence[0].sourceId,
  )?.resource;
  const strictTableIdentifier =
    level.strictTableIdentifier &&
    unit.table !== null &&
    proposal.eligibilityBasis === 'table_item';
  const leadNamed = () => {
    const keys = [proposal.sourceName, proposal.sourceIdentifier]
      .filter((k): k is string => !!k)
      .map(compact);
    return evidence.some((e) => {
      const text = compact(
        sources.find((s) => s.sourceId === e.sourceId)!.resource.data.text,
      );
      return keys.some((k) => {
        const at = text.indexOf(k);
        return at >= 0 && at < CANDIDATE_DISCOVERY_NAME_LEAD_CHARS;
      });
    });
  };
  // a catalog entry such as "13. 삼족기" opens its block with the object number right before the name
  const catalogNumber = (key: string, name: string) => {
    const match = /^\s*(\d+)\.\s*([\s\S]*)$/u.exec(
      sources.find((s) => s.resource.key === key)!.resource.data.text,
    );
    return match && compact(match[2]).startsWith(compact(name))
      ? match[1]
      : null;
  };
  let invalid = '';
  if (evidence.length !== proposal.evidence.length)
    invalid = 'Evidence does not match an exact input quote in this unit';
  else if (!sourceText.some((t) => t.includes(proposal.sourceName)))
    invalid = 'Source name is not verbatim in the supplied input';
  else if (
    proposal.sourceIdentifier !== null &&
    !evidence.some((e) => e.quote.includes(proposal.sourceIdentifier!))
  )
    invalid = 'Source identifier is not present in the quoted evidence';
  else if (
    strictTableIdentifier &&
    (proposal.sourceIdentifier !== null ||
      (firstCell?.kind === 'tableCell' &&
        /^\d+(?:호)?$/u.test(firstCell.data.text))) &&
    (!identifierCell ||
      identifierCell.resource.kind !== 'tableCell' ||
      identifierCell.resource.data.isHeader ||
      proposal.sourceIdentifier !== identifierCell.resource.data.text ||
      proposal.evidence[0].sourceId !== proposal.identifierSourceId ||
      proposal.evidence[0].quote !== identifierCell.resource.data.text)
  )
    invalid =
      'Table identifier must equal the selected original number cell and first evidence';
  else if (
    ['feature', 'artifact'].includes(proposal.recordKind) &&
    proposal.eligibilityBasis === 'explicit_context_unit'
  )
    invalid =
      'Feature/artifact candidates require independent body or table evidence';
  else if (proposal.eligibilityBasis === 'table_item' && unit.table === null)
    invalid = 'Table candidate has no original table input';
  else if (
    proposal.eligibilityBasis === 'independent_body' &&
    unit.table !== null
  )
    invalid = 'Body candidate has no body input';
  else if (
    level.v9 &&
    proposal.eligibilityBasis === 'table_item' &&
    tableRole === 'non_item_table'
  )
    invalid = 'Table item proposed in a unit answered as a non-item table';
  else if (
    level.v9 &&
    proposal.eligibilityBasis === 'table_item' &&
    // a table item in a body unit failed above, so the unit has a table here
    headerTexts(unit as Parameters<typeof headerTexts>[0]).has(
      proposal.sourceName.trim(),
    )
  )
    invalid = 'Table item name is a column header';
  else if (
    level.v9 &&
    proposal.eligibilityBasis === 'table_item' &&
    nameCell !== null &&
    (nameCell?.kind !== 'tableCell' ||
      nameCell.data.isHeader ||
      (!nameCell.data.text.includes(proposal.sourceName) &&
        !tableNameTexts.some((t) => t.includes(proposal.sourceName))))
  )
    invalid =
      'Table item name must come from its selected body cell, the caption, the chapter titles or the context';
  else if (
    level.v9 &&
    proposal.sourceIdentifier !== null &&
    FIGURE_REFERENCE.test(proposal.sourceIdentifier)
  )
    invalid = 'Source identifier includes a figure or plate reference';
  else if (
    level.v10 &&
    ['feature', 'artifact'].includes(proposal.recordKind) &&
    proposal.eligibilityBasis === 'independent_body' &&
    !leadNamed()
  )
    invalid =
      'Independent body candidate is not named at the start of any evidence block';
  else if (
    level.v14 &&
    proposal.recordKind === 'artifact' &&
    proposal.eligibilityBasis === 'independent_body' &&
    proposal.sourceIdentifier === null &&
    catalogNumber(evidence[0].resourceKey, proposal.sourceName) !== null
  )
    invalid = `Body artifact block opens with catalog number ${catalogNumber(evidence[0].resourceKey, proposal.sourceName)} before its name; copy that number unchanged as sourceIdentifier`;
  return { evidence, invalid };
}

/** Identity of a candidate's anchor within one input; two valid candidates with one anchor are duplicates. */
export function anchorKey(
  recordKind: string,
  anchor: Pick<CandidateEvidence, 'resourceKey' | 'charStart' | 'charEnd'>,
) {
  return JSON.stringify([
    recordKind,
    anchor.resourceKey,
    anchor.charStart,
    anchor.charEnd,
  ]);
}

/** Model-facing fix for each correctable issue; the examples come from no evaluated report. */
const FIXES: Array<[RegExp, string]> = [
  [
    /figure or plate reference/u,
    'Return only the object number or code as sourceIdentifier, without circled numerals or figure, plate or photograph references. For example, a heading "③ 3호 주거지(도면 5)" gives sourceName "주거지" and sourceIdentifier "3호", both copied unchanged.',
  ],
  [
    /column header|selected body cell/u,
    'Use the object name from the caption, chapter title, context or a body cell, never a column header, and set nameSourceId to that body cell or null.',
  ],
  [
    /not named at the start/u,
    'An independent body names its object at its start: cite the heading or opening words that name the object, or exclude an object that the passage only mentions in passing.',
  ],
  [
    /Duplicate anchor/u,
    'Several candidates share one quote. Quote only the words that name each object; an object that a passage only lists in passing is not a candidate.',
  ],
];
const DEFAULT_FIX =
  'Follow every rule: quote each selected source exactly and copy names and identifiers unchanged.';

/**
 * Candidates of a v10 response that fail a check, or repeat the anchor of an earlier valid candidate of the same
 * response, with the issue and a model-facing fix. Earlier prompt versions have no corrections.
 */
export function candidateCorrections(
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
  promptVersion: string,
): CandidateDiscoveryCorrection[] {
  const level = candidateCheckLevel(promptVersion);
  if (!level.v10) return [];
  const anchors = new Set<string>();
  const corrections: CandidateDiscoveryCorrection[] = [];
  for (const [candidateIndex, proposal] of response.candidates.entries()) {
    const { evidence, invalid } = checkCandidate(
      unit,
      proposal,
      response.tableRole,
      level,
    );
    let issue = invalid;
    if (!issue) {
      const key = anchorKey(proposal.recordKind, evidence[0]);
      if (anchors.has(key)) issue = 'Duplicate anchor in this response';
      anchors.add(key);
    }
    if (issue)
      corrections.push({
        candidateIndex,
        issue,
        fix: FIXES.find(([pattern]) => pattern.test(issue))?.[1] ?? DEFAULT_FIX,
      });
  }
  return corrections;
}

/** Model-facing fix for an excluded heading; the example comes from no evaluated report. */
const RECONSIDER_FIX =
  'A heading that names an object, followed by its description, is that object\'s independent body. Propose the object with the heading and a descriptive block of its section as evidence, copying the name and number unchanged (sourceIdentifier is only the object number or code: a heading "③ 3호 주거지(도면 5)" gives sourceName "주거지" and sourceIdentifier "3호"); keep the exclusion only when the heading names a type, category or equipment rather than one object, or the section describes a past or external investigation.';
const RECONSIDER_ISSUE =
  'Excluded heading names a numbered object over descriptive blocks';

/**
 * Exclusions of a v11 response to reconsider: a section heading followed by a descriptive block whose title, without
 * its leading mark and parenthesised references, carries a number attached to a word (such as "1트렌치" or "1호
 * 건물지"). A heading of a type ("(1) 기와") or of a numbered list item alone ("21. 호 구연편") does not qualify, nor
 * does an exclusion as a past or external investigation.
 */
export function headingReconsiderations(
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
  promptVersion: string,
): CandidateDiscoveryReconsideration[] {
  if (!candidateCheckLevel(promptVersion).v11 || unit.table) return [];
  const sources = getCandidateSources(unit);
  return response.exclusions.flatMap((exclusion, exclusionIndex) => {
    const at = sources.findIndex((s) => s.sourceId === exclusion.sourceId);
    const text = sources[at]?.resource.data.text ?? '';
    const next = sources[at + 1]?.resource.data.text;
    return exclusion.category !== 'previous_or_external' &&
      isSectionHeading(text) &&
      next !== undefined &&
      !isSectionHeading(next) &&
      /\d+\s*[가-힣A-Za-z]/u.test(
        sectionHeadingTitle(text).replace(/\([^)]*\)/gu, ''),
      )
      ? [{ exclusionIndex, issue: RECONSIDER_ISSUE, fix: RECONSIDER_FIX }]
      : [];
  });
}

/**
 * The form of an identifier with every digit run generalised, such as 마도\d+-\d+ for "마도23-5" or \d+호 for "3호";
 * null for an identifier without both a digit and a letter, since a bare number ("12", "23-1") would match any
 * numbered block.
 */
const AREA_LABEL =
  '[0-9A-Za-z]*\\d[0-9A-Za-z-]*(?:구역|지구|트렌치|그리드|피트)';

function identifierShape(identifier: string | null) {
  if (!identifier || !/\d/u.test(identifier)) return null;
  const text = compact(identifier);
  if (!/\p{L}/u.test(text.replace(/\d/gu, ''))) return null;
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\d+/gu, '\\d+');
}

/**
 * Body blocks of a v13 response that open with a number of the same form as an identifier the response proposed,
 * after any leading marks, while no candidate or exclusion cites the block and no candidate uses that number. A model
 * can stop part way through a run of numbered accounts without saying so; these blocks ask it about the rest.
 */
export function unansweredNumberedBlocks(
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
  promptVersion: string,
): CandidateDiscoveryNumberedBlock[] {
  const level = candidateCheckLevel(promptVersion);
  if (!level.v13 || unit.table) return [];
  const shapes = [
    ...new Set(
      response.candidates.flatMap(
        (c) => identifierShape(c.sourceIdentifier) ?? [],
      ),
    ),
    // a numbered area, trench or grid label such as 23-1구역 or 3트렌치; a field label before it (출수위치 발굴 6구역)
    // is a findspot line, not an area's own account
    ...(level.v15 ? [AREA_LABEL] : []),
  ];
  if (!shapes.length) return [];
  const leading = new RegExp(`^(?:${shapes.join('|')})`, 'u');
  const numbers = new Set(
    response.candidates.map((c) => compact(c.sourceIdentifier ?? '')),
  );
  const cited = new Set([
    ...response.candidates.flatMap((c) => c.evidence.map((e) => e.sourceId)),
    ...response.exclusions.map((e) => e.sourceId),
  ]);
  return getCandidateSources(unit).flatMap(({ sourceId, resource }) => {
    if (cited.has(sourceId)) return [];
    const number = compact(resource.data.text)
      .replace(/^[^\p{L}0-9]+/u, '')
      .match(leading)?.[0];
    return number && !numbers.has(number) ? [{ sourceId, number }] : [];
  });
}

/**
 * The single follow-up a response needs, or null: unanswered item-table rows (v9 on) or, for a side-by-side table
 * from v11, row blocks; from v10, corrections of invalid candidates; from v11, excluded headings to reconsider. Rows
 * alone narrow the unit to those rows (or blocks); otherwise the whole unit goes with the corrections, unanswered rows
 * and headings listed in the input. From v12 the rules for headings and blocks travel as followUpRules in that input;
 * from v13 numbered body blocks that no answer cites are asked the same way.
 */
export function planCandidateDiscoveryFollowUp(
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
  promptVersion: string,
) {
  const level = candidateCheckLevel(promptVersion);
  if (!level.v9) return null;
  const version = level.v15
    ? CANDIDATE_DISCOVERY_PROMPT_VERSION
    : level.v14
      ? 'candidate-discovery.v14'
      : level.v13
        ? 'candidate-discovery.v13'
        : level.v12
          ? 'candidate-discovery.v12'
          : level.v11
            ? 'candidate-discovery.v11'
            : level.v10
              ? 'candidate-discovery.v10'
              : 'candidate-discovery.v9';
  // a side-by-side table answers by row blocks from v11, so its rows are asked through those blocks only
  const blocks = level.v11 ? columnBlocks(unit) : null;
  const rowBlocks = blocks ? unansweredItemTableBlocks(unit, response) : [];
  const rowIndexes = blocks
    ? [...new Set(rowBlocks.map((b) => b.rowIndex))]
    : unansweredItemTableRows(unit, response);
  const corrections = candidateCorrections(unit, response, promptVersion);
  const reconsiderations = headingReconsiderations(
    unit,
    response,
    promptVersion,
  );
  const numberedBlocks = unansweredNumberedBlocks(
    unit,
    response,
    promptVersion,
  );
  if (
    !rowIndexes.length &&
    !corrections.length &&
    !reconsiderations.length &&
    !numberedBlocks.length
  )
    return null;
  // from v12 the rules for reconsidered headings and row blocks come with the follow-up that needs them
  const rules = level.v12
    ? [
        ...(reconsiderations.length ? [RECONSIDERED_EXCLUSIONS_RULE] : []),
        ...(rowBlocks.length ? [SIDE_BY_SIDE_TABLES_RULE] : []),
        ...(numberedBlocks.length
          ? [
              level.v15
                ? UNANSWERED_NUMBERED_BLOCKS_RULE_V15
                : UNANSWERED_NUMBERED_BLOCKS_RULE,
            ]
          : []),
      ]
    : [];
  const withRules = (request: Record<string, unknown>) =>
    rules.length ? { ...request, followUpRules: rules } : request;
  // the follow-up of a side-by-side table tells the model its column blocks
  const withBlocks = (request: Record<string, unknown>) =>
    rowBlocks.length
      ? {
          ...request,
          table: { ...(request.table as object), columnBlocks: blocks },
        }
      : request;
  if (
    !corrections.length &&
    !reconsiderations.length &&
    !numberedBlocks.length
  ) {
    const target = createFollowUpUnit(unit, rowIndexes, rowBlocks);
    const { userPrompt } = createCandidateDiscoveryRequest(target, version);
    return {
      rowIndexes,
      rowBlocks,
      corrections,
      reconsiderations,
      numberedBlocks,
      unit: target,
      userPrompt: rowBlocks.length
        ? JSON.stringify(withRules(withBlocks(JSON.parse(userPrompt))))
        : userPrompt,
    };
  }
  return {
    rowIndexes,
    rowBlocks,
    corrections,
    reconsiderations,
    numberedBlocks,
    unit,
    userPrompt: JSON.stringify(
      withRules({
        ...withBlocks(
          JSON.parse(createCandidateDiscoveryRequest(unit, version).userPrompt),
        ),
        corrections: corrections.map((c) => ({
          candidate: response.candidates[c.candidateIndex],
          issue: c.issue,
          fix: c.fix,
        })),
        unansweredRows: rowIndexes,
        ...(rowBlocks.length > 0 && { unansweredRowBlocks: rowBlocks }),
        ...(reconsiderations.length > 0 && {
          reconsiderExclusions: reconsiderations.map((r) => ({
            exclusion: response.exclusions[r.exclusionIndex],
            issue: r.issue,
            fix: r.fix,
          })),
        }),
        ...(numberedBlocks.length > 0 && {
          unansweredNumberedBlocks: numberedBlocks,
        }),
      }),
    ),
  };
}
