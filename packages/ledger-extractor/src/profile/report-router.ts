import type {
  DocumentResource,
  DocumentResourceIndex,
} from '../resources/document-resource-index';
import type { ReportTraitId, ReportTraitValue } from './report-profile';
import type { ReportSignals } from './report-signals';

import { z } from 'zod';

import { REPORT_TRAIT_IDS } from './report-profile';

/** The first router request, kept so saved pilot responses can still be inspected. */
export const REPORT_ROUTER_PILOT_VERSION = 'report-router.v1' as const;
/** v1 inputs and rules with a format-only schema: sources and chapters are checked by code, not by enums. */
export const REPORT_ROUTER_VERSION = 'report-router.v2' as const;
export type ReportRouterVersion =
  typeof REPORT_ROUTER_PILOT_VERSION | typeof REPORT_ROUTER_VERSION;
export const REPORT_PROFILE_PROPOSAL_VERSION =
  'report-profile-proposal.v1' as const;

/** What each listed trait means; the list stays open and new traits are added here with a definition. */
export const REPORT_TRAIT_DEFINITIONS: Record<ReportTraitId, string> = {
  multi_chapter_scope:
    'Objects of THIS investigation (areas, trenches, features, artifacts, layers) are described in more than one chapter that is not nested in another, e.g. scope/method chapter plus results chapter, or results chapter plus an appendix registry.',
  trench_survey:
    'Individually laid-out test trenches or test pits (each with its own position and size, e.g. "trench 3, 1 m x 4 m") are the main recording units of the investigation. Fixed grid squares or numbered survey areas do not count here; judge them as grid_survey.',
  grid_survey:
    'Fixed grid squares or numbered survey areas of a regular layout (e.g. 10 m x 10 m squares numbered 23-1 to 23-6, often subdivided into lines or sub-squares) are the main recording units of the investigation.',
  few_remains:
    'The investigation reports few or no features and artifacts; most units are described as having no remains.',
  reinvestigated_known_features:
    'This investigation exposes, records or re-examines features or areas that were already known from earlier work, as opposed to merely citing earlier work.',
  local_stratigraphy:
    'Stratigraphy is recorded separately for each trench or point with generic layer names, rather than as report-wide numbered layer units.',
  catalog_artifacts:
    'Artifacts are described as catalogue entries: an identifier line followed by separate name, translation, findspot, measurement and description blocks.',
  uncaptioned_figures:
    'Artifact or feature photographs and drawings mostly have no captions.',
  log_tables:
    'Many tables are survey, diving or work logs (dates, persons, times, depths, work done) rather than object registries.',
  appendix_registry:
    "A registry table that lists this investigation's objects row by row sits outside the results chapters (appendix, abstract, end matter).",
  fragmented_blocks:
    'Body sentences are often split across text blocks, so one sentence continues in the next block.',
  ocr_identifier_noise:
    'Object identifiers show OCR variants (a different prefix or character for the same numbering scheme).',
};

const SYSTEM_PROMPT = `You classify one archaeological excavation report before ledger extraction. Code has measured deterministic signals; you judge report traits and the chapters that hold THIS investigation's objects. Your answer sets the extraction rules unless a person overrides it, and traits you leave unclear are shown to a person to decide.

RULES
- Judge each listed trait as "yes", "no" or "unclear". Use "unclear" when the supplied excerpts and signals do not settle it; never guess to fill a value.
- Signals are counts from generic patterns and can contain false positives (for example a numbered table may list surrounding sites, and earlier-investigation mentions may be background history). Read the excerpts before relying on a count.
- Every "yes" or "no" needs support: at least one evidence item (a selectable sourceId and an exact substring of that excerpt) or, when only measured counts can show it (for example images without captions), the names of the signals it rests on. Do not paraphrase, repair or combine excerpts in quotes. Table header excerpts are quotable like text.
- scopeChapterIds: choose the smallest set of distinct, non-nested chapters that contain the description of THIS investigation's objects (areas, trenches, features, artifacts, layers, and registry tables of them). Exclude background, surrounding sites, history of earlier campaigns, equipment and logs unless they define objects of this investigation. A chapter includes its child chapters.
- Use only sourceId values listed in excerpts and chapterId values listed in toc.
- If the report shows a characteristic that matters for extraction but is not in the trait list, add it to newTraits with a short name, a definition and evidence. Do not force it into an existing trait.
- Write reasons in Korean. Keep source text in its original language.`;

/** Excerpts are capped at this many characters. */
const EXCERPT_CHARS = 500;
const SIGNAL_NAMES = [
  'size',
  'investigationLikeChapters',
  'appendixLikeChapters',
  'trenchHeadings',
  'gridUnits',
  'noRemainsSentences',
  'priorInvestigationMentions',
  'midSentenceBlockRate',
  'uncaptionedImagesByChapter',
  'identifierPatterns',
  'catalogFieldBlocks',
  'logTables',
  'registryTables',
  'stratigraphy',
] as const;

type TextResource = Extract<DocumentResource, { kind: 'text' }>;
type TableResource = Extract<DocumentResource, { kind: 'table' }>;

export interface ReportRouterExcerpt {
  sourceId: string;
  role: string;
  text: string;
}
/** The compact router input sent as the user prompt. */
export interface ReportRouterInput {
  version: ReportRouterVersion;
  traits: Array<{ id: string; definition: string }>;
  tocColumns: string[];
  toc: Array<[string, string, number, number, number, number, number]>;
  signals: Record<string, unknown>;
  excerpts: ReportRouterExcerpt[];
}
export interface ReportRouterRequest {
  version: ReportRouterVersion;
  systemPrompt: string;
  userPrompt: string;
  providerOutputSchema: ReturnType<typeof createReportRouterSchema>;
}

const sourceIdOf = (r: TextResource) =>
  r.resourceId ? `id:${r.resourceId}` : `path:${r.key}`;

/**
 * Router v2 output schema. Trait IDs, values, confidences and signal names are small fixed lists; source and
 * chapter references are plain strings that code checks against the request.
 */
export function createReportRouterSchema() {
  const evidence = {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceId', 'quote'],
      properties: {
        sourceId: { type: 'string', pattern: '^(id|path|table):.+$' },
        quote: { type: 'string' },
      },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'traits',
      'scopeChapterIds',
      'scopeReasons',
      'newTraits',
      'unknowns',
    ],
    properties: {
      traits: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'value',
            'confidence',
            'reason',
            'evidence',
            'signals',
          ],
          properties: {
            id: { type: 'string', enum: [...REPORT_TRAIT_IDS] },
            value: { type: 'string', enum: ['yes', 'no', 'unclear'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
            evidence,
            signals: {
              type: 'array',
              items: { type: 'string', enum: [...SIGNAL_NAMES] },
            },
          },
        },
      },
      scopeChapterIds: { type: 'array', items: { type: 'string' } },
      scopeReasons: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['chapterId', 'reason'],
          properties: {
            chapterId: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
      newTraits: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'definition', 'evidence'],
          properties: {
            name: { type: 'string' },
            definition: { type: 'string' },
            evidence,
          },
        },
      },
      unknowns: { type: 'array', items: { type: 'string' } },
    },
  };
}

/**
 * Router request for one report: trait definitions, the table of contents, compact signals and quotable
 * excerpts chosen by code (signal samples, the first two catalogue-style entries with their following
 * blocks, earlier-investigation mentions inside investigation chapters, the two most widespread layer names,
 * opening blocks of investigation and appendix chapters, and headers of registry and log tables).
 * Deterministic and offline.
 */
export function createReportRouterRequest(
  index: DocumentResourceIndex,
  signals: ReportSignals,
): ReportRouterRequest {
  const texts = index.resources.filter(
    (r): r is TextResource => r.kind === 'text',
  );
  const byId = new Map(texts.map((r) => [sourceIdOf(r), r]));
  const excerpts = new Map<string, ReportRouterExcerpt>();
  const add = (sourceId: string, text: string, role: string) => {
    if (!excerpts.has(sourceId))
      excerpts.set(sourceId, {
        sourceId,
        role,
        text: text.slice(0, EXCERPT_CHARS),
      });
  };
  const s = signals.signals;
  // signal samples become quotable excerpts with their original text
  const sampled: Record<string, Array<{ sourceId: string }>> = {
    trench: s.trenchHeadings.samples,
    grid: s.gridUnits.samples,
    noRemains: s.noRemainsSentences.samples,
    prior: s.priorInvestigationMentions.samples,
    midSentence: s.midSentenceBlockRate.samples,
    catalog: s.catalogFieldBlocks.samples,
    ...Object.fromEntries(
      s.identifierPatterns.map((p, i) => [
        `identifier${i}`,
        [...p.samples, ...p.variants.flatMap((v) => v.samples)],
      ]),
    ),
  };
  for (const [role, list] of Object.entries(sampled))
    for (const x of list) {
      const r = byId.get(x.sourceId);
      if (r) add(x.sourceId, r.data.text, role);
    }
  // whole catalogue-style entries: the first two identifier lines with the blocks that follow them in the
  // same chapter, so the entry structure (name, translation, findspot, measurements, description) is visible
  for (const p of s.identifierPatterns.slice(0, 1))
    for (const sample of p.samples.slice(0, 2)) {
      const at = texts.findIndex((r) => sourceIdOf(r) === sample.sourceId);
      const chapter = texts[at].chapterIds.at(-1);
      for (const r of texts
        .slice(at, at + 6)
        .filter((r) => r.chapterIds.at(-1) === chapter))
        add(sourceIdOf(r), r.data.text, 'catalogEntry');
    }
  // earlier-investigation mentions inside investigation-like chapters, where re-investigation can be judged
  const investigationIds = new Set(
    s.investigationLikeChapters.map((c) => c.chapterId),
  );
  const prior =
    /((19|20)\d{2})\s?년[^.。]{0,60}(지표조사|시굴조사|발굴조사|정밀조사|조사)/;
  for (const r of texts
    .filter(
      (x) =>
        investigationIds.has(x.chapterIds.at(-1)!) && prior.test(x.data.text),
    )
    .slice(0, 3))
    add(sourceIdOf(r), r.data.text, 'priorInScope');
  // the two most widespread layer names, each from two different blocks
  for (const name of [
    ...s.stratigraphy.numberedLayerUnits,
    ...s.stratigraphy.namedLayers,
  ]
    .sort((a, b) => b.sections - a.sections)
    .slice(0, 2)
    .map((l) => l.name))
    for (const r of texts
      .filter((x) => x.data.text.replace(/\s/g, '').includes(name))
      .slice(0, 2))
      add(sourceIdOf(r), r.data.text, `layer:${name}`);
  // opening blocks of every investigation-like or appendix-like chapter
  for (const c of [...s.investigationLikeChapters, ...s.appendixLikeChapters])
    for (const r of texts
      .filter((x) => x.chapterIds.at(-1) === c.chapterId)
      .slice(0, 3))
      add(sourceIdOf(r), r.data.text, `opening:${c.chapterId}`);
  // headers and first rows of registry and log tables
  const head = (t: TableResource) =>
    (t.data.grid[0] ?? []).map((c) => c.text).join(' | ');
  for (const t of index.resources.filter(
    (r): r is TableResource => r.kind === 'table',
  )) {
    const flagged =
      s.registryTables.some((x) => x.tableId === t.resourceId) ||
      (/(일자|날짜|일차|일시)/.test(head(t)) &&
        /(작업|내용|잠수|인원|날씨|수심|시간)/.test(head(t)));
    if (flagged)
      add(
        `table:${t.resourceId}`,
        `[${t.chapterIds.at(-1)} p${t.pdfPageNo}${t.data.caption?.fullText ? ` · ${t.data.caption.fullText}` : ''}] ${head(t)} || ${(t.data.grid[1] ?? []).map((c) => c.text).join(' | ')}`,
        'tableHeader',
      );
  }
  const input: ReportRouterInput = {
    version: REPORT_ROUTER_VERSION,
    traits: REPORT_TRAIT_IDS.map((id) => ({
      id,
      definition: REPORT_TRAIT_DEFINITIONS[id],
    })),
    tocColumns: [
      'chapterId',
      'title',
      'depth',
      'textChars',
      'tables',
      'images',
      'captionedImages',
    ],
    toc: signals.toc.map((c) => [
      c.chapterId,
      c.title,
      c.depth,
      c.textChars,
      c.tables,
      c.images,
      c.captionedImages,
    ]),
    signals: {
      size: signals.size,
      investigationLikeChapters: s.investigationLikeChapters.map(
        (c) => c.chapterId,
      ),
      appendixLikeChapters: s.appendixLikeChapters.map((c) => c.chapterId),
      trenchHeadings: s.trenchHeadings.count,
      gridUnits: {
        gridSizeMentions: s.gridUnits.gridSizeMentions,
        unitMentions: s.gridUnits.unitMentions,
      },
      noRemainsSentences: s.noRemainsSentences.count,
      priorInvestigationMentions: {
        count: s.priorInvestigationMentions.count,
        chapters: s.priorInvestigationMentions.chapters,
      },
      midSentenceBlockRate: s.midSentenceBlockRate.rate,
      uncaptionedImagesByChapter: s.uncaptionedImagesByChapter.map((c) => [
        c.chapterId,
        c.images,
        c.uncaptionedRate,
      ]),
      identifierPatterns: s.identifierPatterns.map((p) => ({
        prefix: p.prefix,
        count: p.count,
        variants: p.variants.map((v) => [v.prefix, v.count]),
      })),
      catalogFieldBlocks: {
        measurement: s.catalogFieldBlocks.measurementBlocks,
        latinOnly: s.catalogFieldBlocks.latinOnlyBlocks,
      },
      logTables: { count: s.logTables.count, rows: s.logTables.rows },
      registryTables: s.registryTables.map((t) => ({
        tableId: t.tableId,
        chapterId: t.chapterId,
        page: t.pdfPageNo,
        rows: t.rows,
        captioned: t.captioned,
        firstColumnUnique: t.firstColumnUniqueRate,
      })),
      stratigraphy: {
        numbered: s.stratigraphy.numberedLayerUnits.map((l) => [
          l.name,
          l.sections,
        ]),
        named: s.stratigraphy.namedLayers.map((l) => [l.name, l.sections]),
      },
    },
    excerpts: [...excerpts.values()],
  };
  return {
    version: REPORT_ROUTER_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify(input),
    providerOutputSchema: createReportRouterSchema(),
  };
}

const evidenceSchema = z.array(
  z.object({ sourceId: z.string(), quote: z.string() }),
);
const responseSchema = z.object({
  traits: z.array(
    z.object({
      id: z.string(),
      value: z.enum(['yes', 'no', 'unclear']),
      confidence: z.enum(['high', 'medium', 'low']),
      reason: z.string(),
      evidence: evidenceSchema,
      signals: z.array(z.string()),
    }),
  ),
  scopeChapterIds: z.array(z.string()),
  scopeReasons: z.array(
    z.object({ chapterId: z.string(), reason: z.string() }),
  ),
  newTraits: z.array(
    z.object({
      name: z.string(),
      definition: z.string(),
      evidence: evidenceSchema,
    }),
  ),
  unknowns: z.array(z.string()),
});

/** One judged trait with the problems code found in it; a trait with problems should not be trusted as given. */
export interface ReportTraitProposal {
  id: ReportTraitId;
  value: ReportTraitValue;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidence: Array<{ sourceId: string; quote: string }>;
  signals: string[];
  issues: string[];
}
/** The router's judgment as checked by code. Nothing is repaired; problems are listed. */
export interface ReportProfileProposal {
  version: typeof REPORT_PROFILE_PROPOSAL_VERSION;
  routerVersion: ReportRouterVersion;
  traits: ReportTraitProposal[];
  scopeChapterIds: string[];
  scopeReasons: Array<{ chapterId: string; reason: string }>;
  newTraits: Array<{
    name: string;
    definition: string;
    evidence: Array<{ sourceId: string; quote: string }>;
    issues: string[];
  }>;
  unknowns: string[];
  /** Problems outside single traits: missing or repeated traits and scope problems. */
  issues: string[];
}

/**
 * Inspect a router response against its own request: exact quotes from listed excerpts, listed traits,
 * supported yes/no values, listed and non-nested scope chapters, and contradictions with code signals.
 * Saved v1 pilot requests inspect the same way. The response is never repaired. A response that does not
 * have the expected shape yields no proposal.
 */
export function inspectReportRouterResponse(
  request: Pick<ReportRouterRequest, 'version' | 'userPrompt'>,
  rawResponse: unknown,
): { issues: string[]; proposal: ReportProfileProposal | null } {
  const parsed = responseSchema.safeParse(rawResponse);
  if (!parsed.success)
    return {
      issues: ['Response does not match the router schema'],
      proposal: null,
    };
  const response = parsed.data;
  const input = JSON.parse(request.userPrompt) as ReportRouterInput;
  const excerpts = new Map(input.excerpts.map((e) => [e.sourceId, e.text]));
  const signals = input.signals as {
    trenchHeadings: number;
    logTables: { count: number };
    registryTables: unknown[];
    identifierPatterns: Array<{ variants: unknown[] }>;
    catalogFieldBlocks: { measurement: number; latinOnly: number };
  };
  const quoteIssues = (evidence: Array<{ sourceId: string; quote: string }>) =>
    evidence.flatMap((e) =>
      !excerpts.has(e.sourceId)
        ? [`unknown source ${e.sourceId}`]
        : !e.quote || !excerpts.get(e.sourceId)!.includes(e.quote)
          ? [`quote not exact in ${e.sourceId}`]
          : [],
    );
  // a yes that the measured signals cannot support at all
  const contradicts: Partial<Record<ReportTraitId, boolean>> = {
    trench_survey: signals.trenchHeadings === 0,
    log_tables: signals.logTables.count === 0,
    appendix_registry: signals.registryTables.length === 0,
    ocr_identifier_noise: !signals.identifierPatterns.some(
      (p) => p.variants.length,
    ),
    catalog_artifacts:
      !signals.identifierPatterns.length &&
      signals.catalogFieldBlocks.measurement === 0 &&
      signals.catalogFieldBlocks.latinOnly === 0,
  };
  const issues: string[] = [];
  const traits: ReportTraitProposal[] = [];
  for (const t of response.traits) {
    if (!(REPORT_TRAIT_IDS as readonly string[]).includes(t.id)) {
      issues.push(`unknown trait ${t.id}`);
      continue;
    }
    const id = t.id as ReportTraitId;
    const own = quoteIssues(t.evidence);
    if (t.value !== 'unclear' && !t.evidence.length && !t.signals.length)
      own.push(`${t.value} without support`);
    for (const name of t.signals)
      if (!(SIGNAL_NAMES as readonly string[]).includes(name))
        own.push(`unknown signal ${name}`);
    if (t.value === 'yes' && contradicts[id])
      own.push('yes contradicts the measured signals');
    traits.push({ ...t, id, issues: own });
  }
  for (const id of REPORT_TRAIT_IDS) {
    const n = traits.filter((t) => t.id === id).length;
    if (!n) issues.push(`missing trait ${id}`);
    if (n > 1) issues.push(`repeated trait ${id}`);
  }
  const order = input.toc.map((c) => c[0]);
  const depth = new Map(input.toc.map((c) => [c[0], c[2]]));
  const scope = response.scopeChapterIds;
  if (!scope.length) issues.push('scope has no chapter');
  for (const id of scope)
    if (!depth.has(id)) issues.push(`unknown scope chapter ${id}`);
  if (new Set(scope).size !== scope.length)
    issues.push('scope chapters are repeated');
  // a later chapter is nested in an earlier one when every chapter between them is deeper than the earlier one
  const inside = (child: string, parent: string) => {
    const i = order.indexOf(parent);
    const j = order.indexOf(child);
    return (
      j > i &&
      order.slice(i + 1, j + 1).every((c) => depth.get(c)! > depth.get(parent)!)
    );
  };
  for (const a of scope)
    if (
      depth.has(a) &&
      scope.some((b) => b !== a && depth.has(b) && inside(a, b))
    )
      issues.push(`scope chapter ${a} is nested`);
  for (const r of response.scopeReasons)
    if (!scope.includes(r.chapterId))
      issues.push(`scope reason for chapter ${r.chapterId} outside the scope`);
  const newTraits = response.newTraits.map((n) => ({
    ...n,
    issues: quoteIssues(n.evidence),
  }));
  return {
    issues: [
      ...issues,
      ...traits.flatMap((t) => t.issues.map((x) => `${t.id}: ${x}`)),
      ...newTraits.flatMap((n) =>
        n.issues.map((x) => `new trait ${n.name}: ${x}`),
      ),
    ],
    proposal: {
      version: REPORT_PROFILE_PROPOSAL_VERSION,
      routerVersion: request.version,
      traits,
      scopeChapterIds: scope,
      scopeReasons: response.scopeReasons,
      newTraits,
      unknowns: response.unknowns,
      issues,
    },
  };
}
