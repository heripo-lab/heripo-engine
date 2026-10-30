# @heripo/ledger-extractor

> Archaeology ledger extraction library for archaeological report data

[![npm version](https://img.shields.io/npm/v/@heripo/ledger-extractor.svg)](https://www.npmjs.com/package/@heripo/ledger-extractor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

`@heripo/ledger-extractor` is the ledger extraction stage of the heripo data pipeline. It takes a `ProcessedDocument` (produced by `@heripo/document-processor`) and builds an `archaeology-ledger.v1` ledger: one record per investigated object (site, area, trench, layer, feature, artifact, shipwreck), the original sentences and table cells that describe it with their exact source locations, parents, figure and photo references, attributes, links between records, review items and a validation report. Source text is cut out unchanged; nothing is rewritten, converted or normalized, and what code and models cannot decide is left as a review item for a person.

Model calls happen in separate steps that each return their prompts, raw responses and usage for caller-managed checkpoints: report routing, candidate discovery, duplicate review, thin content attachment, place alias proposals and parent judgment. `buildArchaeologyLedger()` then assembles the ledger from those saved results deterministically and without model calls, so the same inputs always give the same ledger. The original `LedgerExtractor.extract()` count preview and the S0 resource index remain available and make no LLM calls.

> **Experimental format**: `buildArchaeologyLedger()` assembles an `archaeology-ledger.v1` ledger from a processed document using caller-selected models, but this format is experimental. Its fields, review items and prompts can change within 0.2.x releases without a migration path, so keep the source processed documents and rebuild ledgers after upgrading. The preview and S0 APIs make no LLM calls; standardization and database storage remain follow-up work.

> **Limited validation**: the ledger stages were developed and measured on three reports only: 『태안 마도 해역 수중발굴조사』 (Taean Mado underwater excavation), 『부여 화지산 백제과원 및 둘레길 조성사업부지내 유적』 (Buyeo Hwajisan) and 『거제 사등성 하수관로 매설구간 내 유적 발굴조사』 (Geoje Sadeungseong). Expect gaps on other report types and layouts; the rules and prompts will be improved step by step as more reports accumulate.

## Table of Contents

- [Key Features](#key-features)
- [Installation](#installation)
- [Usage](#usage)
- [Input Contract](#input-contract)
- [Spend guard](#spend-guard)
- [S0: Whole-document resource index](#s0-whole-document-resource-index)
- [Report profile](#report-profile)
- [Investigation object candidates](#investigation-object-candidates)
- [Thin per-unit content attachment](#thin-per-unit-content-attachment)
- [Archaeology ledger](#archaeology-ledger)
- [Parent hierarchy signals and code-decided parents](#parent-hierarchy-signals-and-code-decided-parents)
- [Figure and photo references](#figure-and-photo-references)
- [Table attributes](#table-attributes)
- [Record links](#record-links)
- [Ledger validation](#ledger-validation)
- [Building the ledger in one call](#building-the-ledger-in-one-call)
- [Extraction preview](#extraction-preview)
- [Prompt history](#prompt-history)
- [License](#license)

## Key Features

- **Report profile**: deterministic report signals and one router call (`prepareReportProfile`), or an injected person-confirmed `ReportProfile`; `completeReportScope` completes a proposed scope with the investigation chapters for unattended runs
- **Candidate discovery**: source-ID-constrained proposals of eight record kinds from the chosen chapters, checked by code, with one targeted follow-up call and selective retries
- **Duplicate review**: code-decided merges plus a model review of only the ambiguous blocks (`deduplicateCandidateBlocks`); uncertain identities stay separate for review
- **Thin per-unit content attachment**: one compact call per unit, sent twice by default; a target is confirmed only when every run returns it, and everything else goes to review
- **Parents and place aliases**: parents decided by code from find-spot phrases and membership columns, a three-run model judgment for the rest, and person- or model-proposed place alias tables (`place-aliases.v1`)
- **Media, attributes and links**: figure and photo references, table and text attributes kept as written, and record links from relation sentences and relation columns, all without model calls
- **Validation**: `validateArchaeologyLedger` checks structure, hierarchy, sources and fidelity against the processed document
- **One-call build**: `buildArchaeologyLedger` runs every offline step in order from saved model results
- **Spend guard**: `createSpendGuard` (re-exported from `@heripo/shared`) caps calls and tokens across every model call of a run
- **Replayable audits**: saved audits of earlier prompt versions still replay with the prompts they recorded
- **Preview and S0**: the `LedgerExtractor.extract()` count preview and the whole-document resource index, without LLM calls

## Installation

```bash
pnpm add @heripo/ledger-extractor
```

## Usage

The model steps run in order and their results are saved by the caller; the ledger is then built offline. `baseModel` below is any AI SDK `LanguageModel` that supports structured output.

```typescript
import {
  assembleCandidateDeduplication,
  assembleCandidateDiscovery,
  assembleContentAttachmentThin,
  attachContentThinUnit,
  buildArchaeologyLedger,
  buildDocumentResourceIndex,
  collectReportSignals,
  completeReportScope,
  createRelationParentRequests,
  createSpendGuard,
  deduplicateCandidateBlocks,
  discoverCandidateUnit,
  judgeRelationParentBatch,
  parseProcessedDocument,
  prepareCandidateDiscovery,
  prepareContentAttachment,
  prepareReportProfile,
  reportProfileSha256,
  resolveContentAttachmentThinPolicy,
} from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const raw = readFileSync('processed-document.json');
const document = parseProcessedDocument(JSON.parse(raw.toString('utf8')));
const inputSha256 = createHash('sha256').update(raw).digest('hex');
const index = buildDocumentResourceIndex(document);

// One budget for every model call of the run
const guard = createSpendGuard({ maxCalls: 2000, maxTotalTokens: 30_000_000 });
const model = guard.wrap(baseModel);

// 1. Report profile: one router call (or pass a person-confirmed `profile`)
const { profile } = await prepareReportProfile(document, index, {
  inputSha256,
  model,
});
if (!profile) throw new Error('The router proposed no profile');

// 2. Complete the router's proposed scope with the investigation chapters
const discoveryScope = completeReportScope(
  index,
  collectReportSignals(document, index, { inputSha256 }),
  profile.scopeChapterIds,
);

// 3. Candidate discovery and duplicate review
const discoveryPlan = prepareCandidateDiscovery(index, {
  scopeChapterId: discoveryScope.scopeChapterIds,
  inputSha256,
  maxTextChars: 8000,
  tableRowsPerUnit: 12,
});
const audits = [];
for (const unit of discoveryPlan.units)
  audits.push(await discoverCandidateUnit(unit, { model, maxRetries: 0 }));
const discovery = await assembleCandidateDiscovery(discoveryPlan, audits);
const groups = assembleCandidateDeduplication(
  discoveryPlan,
  discovery,
  await deduplicateCandidateBlocks(discoveryPlan, discovery, {
    model,
    maxRetries: 0,
  }),
);

// 4. Attachment plan (no calls) and thin attachment of every unit
const { policy, decisions } = resolveContentAttachmentThinPolicy(profile);
const plan = await prepareContentAttachment(
  index,
  discoveryPlan,
  discovery,
  groups,
  {
    inputSha256,
    candidateSnapshotId: 'discovery-run-1',
    pdfPageNumbers: Object.keys(document.pageRangeMap).map(Number),
    maxUnitChars: 8000,
    thinPolicy: policy,
    thinPolicyDecisions: decisions,
    profile: {
      profileSha256: await reportProfileSha256(profile),
      source: profile.source,
    },
  },
);
const results = [];
for (const unit of plan.units)
  results.push(await attachContentThinUnit(plan, unit, { model }));
const attachments = assembleContentAttachmentThin(plan, results);

// 5. Build once to get the parent questions code leaves open, judge them,
//    then build the final ledger (the build itself makes no model calls)
const now = new Date().toISOString();
const meta = {
  ledgerId: 'ledger-1',
  extractorVersion: '0.2.0',
  extractedAt: now,
  createdAt: now,
};
const first = await buildArchaeologyLedger({
  document,
  plan,
  attachments,
  meta,
  discoveryScope,
});
const parentJudgments = [];
for (const request of createRelationParentRequests(
  plan,
  first.result,
  first.stages.parents,
))
  parentJudgments.push(
    ...(await judgeRelationParentBatch(request, { model })).judgments,
  );
const { result: ledger, validation } = await buildArchaeologyLedger({
  document,
  plan,
  attachments,
  meta,
  discoveryScope,
  parentJudgments,
  droppedProposals: discovery.issues,
});

console.log(ledger.records.length, validation.status, guard.used());
```

Save every audit, call and result as it arrives: each step can be reassembled from its saved results without another model call. A person can replace a model step with a decision at several points: an injected report profile or scope, reviewed discovery units (`prepareCandidateDiscoveryRetry`), thin rule overrides (`resolveContentAttachmentThinPolicy`) and a place alias table (`placeAliases`). Each step is described in the sections below, in pipeline order.

## Input Contract

`pageRangeMap` keys and `pdfPageNo` are positive integers. Logical `startPageNo`, `endPageNo`, and `Chapter.pageNo` accept negative integers, zero, and positive integers relative to body page 1; fractional values are rejected.

- The input is a single `ProcessedDocument` JSON (see `packages/model/src/types/processed-document.ts`). ZIP archives, manifests, and image file bundles are not accepted.
- `ProcessedImage.path` is expected to be a **full public CDN URL** (as generated by the `heripo-web` export script), not a local file path or a B2 object key. The extractor consumes these URLs verbatim — it never fetches, signs, or rewrites them.
- The input document is never mutated.

## Spend guard

`createSpendGuard(caps?)` returns one budget for every model call of a run. It is re-exported from `@heripo/shared` together with `SpendLimitError`, `spendInputTokenBound`, `SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS` (32,000) and `SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS` (1,000).

- `guard.wrap(model, { defaultMaxOutputTokens? })` returns a model whose every provider attempt, schema retries and concurrent callers included, reserves its worst case before it is sent and is settled with the usage the provider reports. The worst case is `spendInputTokenBound` of the serialized prompt, schema and tools plus the attempt's output limit.
- A reservation that would cross `maxCalls` or `maxTotalTokens` throws `SpendLimitError` without calling the provider. Under caps, an attempt without an output limit is given `defaultMaxOutputTokens`, and a prompt with a file given by URL or provider reference is refused, since its size is unknown. A failed attempt keeps its whole reservation, and after an attempt uses more than it reserved every later reservation is refused.
- `reserve(label, amount)` holds a worst case for calls sent another way, such as a provider batch API, until it is settled. `used()`, `left()` and `refused()` report settled usage, what the caps leave and the latest refusal. Steps that turn a failed call into a result can check `refused()` afterwards, so a run that reached a cap stops instead of continuing with what it could not ask.
- Without caps the guard only counts: its limits are never reached and wrapped attempts keep their own output limits.

## S0: Whole-document resource index

`buildDocumentResourceIndex(document)` indexes every chapter, text block, image, table, actual grid cell and footnote without LLM calls or I/O. `queryDocumentResources(index, query)` combines optional kind, direct chapter, exact resource ID, exact source reference, PDF page, signed logical page and literal substring filters with AND.

```typescript
import {
  buildDocumentResourceIndex,
  queryDocumentResources,
} from '@heripo/ledger-extractor';

const index = buildDocumentResourceIndex(document);
const matches = queryDocumentResources(index, { text: '우물' });
const page = queryDocumentResources(index, { pdfPageNo: 122 });
const source = queryDocumentResources(index, { sourceRef: '#/texts/5616' });
```

The index preserves source strings and direct chapter assignments, including unassigned media and multiple assignments. Caption references resolve to their image or table. Cell references use the parent table reference and zero-based indexes into the actual grid; merged shadows are not expanded. Missing IDs/references/page mappings remain missing. Chapter PDF pages are not inferred from their logical start pages. Resources retain storage traversal order, not a reconstructed PDF reading order. The JSON pointer `key` locates an occurrence in this exact input snapshot; it is not a cross-version ledger ID. Keep the input file hash alongside exported indexes.

S0 provides source lookup only. It does not classify investigation scope or register archaeological objects. `LedgerExtractor.extract()` retains its existing bounded preview response.

## Report profile

Reports differ (land excavations, trench-only surveys, underwater catalogues), so later steps read a person-confirmed `ReportProfile` (`report-profile.v1`) instead of one rule set for every report. A profile records the original input hash, trait judgments (`yes`, `no` or `unclear`) for `REPORT_TRAIT_IDS`, the distinct, non-nested chapters that hold this investigation's objects, its source (`router` or `manual`) and the confirmation time. The trait list stays open: a characteristic of a new kind of report is recorded as an `x-` prefixed trait until a branch uses it.

`collectReportSignals(document, index, { inputSha256 })` returns `report-signals.v1`, the deterministic, model-free signals a report router reads before judging traits: a table of contents (depth, text length, tables, images, captions, appendix-like and investigation-like titles) and counts from generic patterns — trench headings, grid sizes and numbered survey areas, no-remains sentences, earlier-investigation mentions, the share of prose blocks ending mid-sentence, chapters with uncaptioned images, leading identifier prefixes and their variants, catalogue measurement and Latin-only blocks, log tables, registry tables (first-column uniqueness, appendix placement) and numbered versus repeated generic layer names. Each count keeps up to three source samples (chapter, PDF page and an `id:` / `path:` source id). Signals carry no thresholds; trait decisions stay with the router and the person who confirms the profile.

`createReportRouterRequest(index, signals)` builds the router request `report-router.v2` (`REPORT_ROUTER_VERSION`) without calling a model: English rules, the listed traits with their definitions (`REPORT_TRAIT_DEFINITIONS`), the table of contents, compact signals and quotable excerpts chosen by code (signal samples, the first two catalogue-style entries with their following blocks, earlier-investigation mentions inside investigation chapters, the two most widespread layer names, opening blocks of investigation and appendix chapters, and headers of registry and log tables). The model judges every trait as `yes`, `no` or `unclear` with confidence, a Korean reason and exact quotes or signal names, chooses the smallest non-nested scope chapters, and may propose new traits. The input matches the v1 pilot request; v2 only changes the schema (`createReportRouterSchema()`): trait IDs, values, confidences and signal names stay small fixed lists, while source and chapter references are plain strings that code checks, since strict structured-output providers reject large enums. `inspectReportRouterResponse(request, rawResponse)` checks a response against its own request without repairing it and returns `report-profile-proposal.v1`: each trait with its own problems (an unknown source, a quote that is not an exact substring of its excerpt, a `yes`/`no` without evidence or signals, an unknown signal, or a `yes` the measured signals cannot support — trench, log-table, registry, identifier-variant or catalogue signals all absent), scope problems (no chapter, unknown, repeated or nested chapters, a reason for a chapter outside the scope), missing, repeated or unknown traits and new-trait quote problems. A response that does not have the router shape yields no proposal. Saved v1 pilot requests inspect the same way.

`routeReport(index, signals, { model, maxRetries = 0, abortSignal, onAttempt })` sends that request once and returns the call with its exact request, the signals, the parsed output as returned, usage, attempts and the inspection; a failure is returned rather than thrown. `createReportProfileFromProposal(proposal, { inputSha256, confirmedAt, routerRunId?, scopeChapterIds? })` turns a proposal into a `source: 'router'` profile: only a trait judged once, without problems and with high confidence keeps its value; any other trait becomes `unclear`, so the thin policy marks the branches it drives as needing a decision. In the Haiku 5.5 measurement on three reports every high-confidence judgment matched the person's profile while the wrong ones were medium. The proposed scope stays a proposal (`scopeStatus: 'proposed'`) that candidate discovery should not start from, because the router's scope errors were systematic; an injected scope replaces it and counts as decided. The notes record which traits were set unclear and why, and where the scope came from. `CONTENT_ATTACHMENT_THIN_POLICY_TRAITS` lists the traits that currently drive a thin attachment branch (`local_stratigraphy`, `catalog_artifacts`). `prepareReportProfile(document, index, { inputSha256, profile?, scopeChapterIds?, model?, ... })` settles the profile the way `DocumentProcessor` settles page ranges and TOC entries: an injected profile skips the router, otherwise one router call proposes it; an injected scope replaces the profile's scope either way. It returns the profile (or `null` when the call fails or its output has the wrong shape), its source (`injected` or `router`), the call, and the router inspection and profile validation problems; nothing is repaired, and a model is required without an injected profile.

`completeReportScope(index, signals, proposedChapterIds)` completes a proposed scope for unattended runs, deterministically and without model calls. It adds every chapter the signals mark as investigation-like (survey scope, method, contents, trial or excavation titles) and keeps only the outermost chapters in document order. It returns `report-scope-completion.v1` with the scope, the proposal as given, the chapters it added and the proposed chapters now inside a wider one. A router can leave out a chapter that defines this investigation's areas because its parent title also names equipment; the Taean report's router dropped `III. 조사장비 및 내용 > 2. 조사내용` and lost 23-1~6 and 23-A-1~10 구역. Background and discussion chapters are not added. Pass the result as `discoveryScope` to `buildArchaeologyLedger` to record it in the ledger header (`ledger.discoveryScope`).

`validateReportProfile(index, inputSha256, profile)` returns every problem it finds (wrong input, unknown traits or values, missing, repeated or nested scope chapters, an unknown scope status, unknown source, invalid time) without changing the profile; an empty list means the profile can be used. Its `scopeChapterIds` can be passed directly to `prepareCandidateDiscovery`; pass `scopeSource: { kind: 'profile', profileSha256 }` as well to record in the plan that the scope came from that profile. `reportProfileSha256(profile)` hashes a profile with sorted keys, so the same judgments give the same hash. `contentAttachmentThinPolicyFromProfile(profile)` maps traits to thin attachment rules: `layers: 'local'` unless stratigraphy is confirmed not local (`local_stratigraphy: 'no'`) or there is no profile, which keeps `layers: 'all'`. A profile also sets `areas: 'unanimous'`, and `catalog: 'fields'` when its `catalog_artifacts` trait is `'yes'`; without a profile areas always go to review. A profile also sets `trivial: 'code'`: compilation leaves segments that describe no candidate on their face out of the model's segment list and records them in `codeMap.codeNone`, so they are never attached and cost no output. `isContentAttachmentThinTrivialText(text)` decides this: only numbers, separators and unitless measurements (page numbers, table counts), a date such as "6월 7일", either of them with a trailing weekday or duration as survey log tables write them ("2023년8월19일(토)", "14:30~15:30(60분)"), or a figure, photo, plate or table label with a number that does not end like a sentence and is at most `CONTENT_ATTACHMENT_THIN_TRIVIAL_LABEL_MAX_LENGTH` (120) characters. Their words stay in the windows as reading context. Applied to the saved Haiku 5.5 runs of three reports, the rule covered 1,260 of 6,534 segments; the three-run reference attached none of them and sent 32 to review. `resolveContentAttachmentThinPolicy(profile, { traitOverrides, policyOverrides })` returns `{ policy, decisions }` for callers that decide branches outside the automatic profile, the way `DocumentProcessor` accepts reviewed `pageRangeMap` and `tocEntries`. Priority runs from a branch decided directly (`policyOverrides`: `layers` `all|local`, `continuity` `linked|none`, `areas` `unanimous|review`, `catalog` `fields|none`, `trivial` `code|model`), to a trait decided by the caller (`traitOverrides`, listed trait IDs with `yes|no|unclear`), to the profile's trait, to the default; unknown IDs or values throw. Each decision records its branch, value and source (`policy_override`, `trait_override`, `trait`, `profile` or `default`) with the trait and its value where one applies. `needsDecision` marks a branch that a profile left to the default because its trait is unclear or missing, so an outside reviewer can decide it. `contentAttachmentThinPolicyFromProfile(profile)` is the same resolution without overrides. Pass the policy as `thinPolicy`, the decisions as `thinPolicyDecisions` (and the profile's hash and source as `profile`) to `prepareContentAttachment`; the plan keeps them, and compilation, inspection, routing and assembly read the policy from the plan. Under `layers: 'local'`, routing narrows a layer name that several layers share to the layers with evidence in the unit and then to the one whose evidence is nearest at or before the segment; names used by one layer are unaffected. Under the same policy, compilation (`content-attachment-thin-compile.v3`, `CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION`) offers a layer whose evidence lies in exactly one unit in that unit, and in the units next to it only when they share the layer's evidence chapter (the chapter itself or an ancestor); layers with evidence in several units, or in none, stay offered everywhere. Routing suggests only layers offered for the unit, and a single-unit layer from a neighbouring unit only to a segment in its chapter. A confirmed profile also sets `continuity: 'linked'`: the read-only blocks that directly precede a unit's first body block stay in its reading order even when the source document starts a new chapter at the page break, and each lists as `evidenceOf` the offered candidates whose registration evidence it is. Linked compilation is `content-attachment-thin-compile.v4` (`CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION`, all layers) or `.v5` (`CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION`, local layers), and its requests use prompt `content-attachment-thin.v9` (`CONTENT_ATTACHMENT_THIN_LINKED_VERSION`), which adds one page-boundary rule; plans without the field compile byte-identically to before. Without a policy, compilation stays `content-attachment-thin-compile.v1` and byte-identical to before.

## Investigation object candidates

Candidate discovery proposes candidates from an explicitly selected chapter subtree. It keeps the existing preview and S0 APIs separate:

```typescript
import {
  assembleCandidateDiscovery,
  discoverCandidateUnit,
  prepareCandidateDiscovery,
} from '@heripo/ledger-extractor';

const plan = prepareCandidateDiscovery(index, {
  scopeChapterId: 'investigation-chapter-id',
  inputSha256: 'sha256-of-original-input-file',
  maxTextChars: 8000,
  tableRowsPerUnit: 12,
});
const audits = [];
for (const unit of plan.units) {
  audits.push(await discoverCandidateUnit(unit, { model, maxRetries: 0 }));
}
const result = await assembleCandidateDiscovery(plan, audits);
```

Code fixes the subtree, body-block batches, actual table-cell batches and adjacent read-only context. A long indivisible text block can exceed `maxTextChars`. When a text unit would end with a run of short blocks (under `CANDIDATE_DISCOVERY_SHORT_BLOCK_CHARS`, 120 characters) followed by a long block of the same chapter, the run moves to the start of the next unit, so an object's heading, number and field lines stay with its description. Runs longer than `CANDIDATE_DISCOVERY_MAX_MOVED_BLOCKS` (10) and units made only of short blocks keep their boundary. Saved plans and runs replay with the units they recorded. Each call uses `LLMCaller`, structured response validation and caller-supplied retry/cancellation settings. Full prompts, prompt version, responses and token usage are returned for caller-managed checkpoints and replay. Starting with prompt v3, each verbatim source text is paired with a selectable `sourceId`; the model response schema constrains evidence and exclusions to those IDs. Unique input IDs are used directly with an `id:` prefix; missing or duplicate IDs use an exact input path with a `path:` prefix. Read-only adjacent context has no selectable ID. Code resolves only the chosen ID to its original resource and checks the quote there; it never relocates a quote to another block or rewrites the raw response. If an object identifier occurs in a separate heading, the model must select that heading and its exact identifier-bearing quote as additional evidence. Calls are sequential in the demo; no autonomous searching or report-wide enrichment occurs here.

`discoverCandidateUnit` marks the shared system prompt for the provider's prompt cache and keeps the default reasoning effort: at Anthropic effort `low`, Haiku 5.5 found 104 candidates in 17 sampled units where two default runs found 135 and 140, and only 51–62% of its candidates matched a default run against 69% between the default runs. Callers that send calls themselves, such as through a batch API, use `createCandidateDiscoveryUnitCall(unit)` (system prompt, user prompt and schema of the first call), `createCandidateDiscoveryFollowUpCall(unit, firstResponse)` (the follow-up the response asks for, or `null`) and `recordCandidateDiscoveryUnit(unit, first, second?)`, which builds the same audit and throws when a needed follow-up is missing or an unneeded one is given.

The eight candidate kinds are site, area, trench, layer, feature, artifact, shipwreck and unknown. Features and artifacts require an independent body account or a distinct substantive table item. This requirement does not apply to layers: explicitly identified stratigraphic units named as artifact findspots or depositional contexts are proposed as layers even without a separate heading, paragraph or table row. Omitting a collective artifact mention does not omit its explicit layer. Prompt instructions are written in English; source text and configured output languages retain their original language. Prior investigations, passing mentions and media-only accounts are excluded by the model instructions. Code verifies exact evidence quotes, source names, identifiers, resource boundaries and basic eligibility types; it cannot prove the model's archaeological interpretation or completeness. All results remain `proposed`. Invalid proposals and duplicate anchors become visible issues, while the original model response remains in the audit. Exact duplicate anchors are not counted twice; equal names or numbers at different anchors are not silently merged. Candidate IDs derive from the input hash, kind and first quoted source span, so they are snapshot-local proposals rather than final cross-version record IDs.

When the objects of one excavation are described in more than one chapter (for example survey areas in a methods chapter and artifacts in a finds chapter), pass an array of chapter IDs as `scopeChapterId`. The chapters must be distinct and not nested. Code plans them in document order and moves leading continuation text only between siblings within the same chapter subtree. The plan and the assembled result keep the first chapter as `scopeChapterId`, list every chapter in `scopeChapterIds`, and join the titles in `scopeTitle`. The whole multi-chapter pool is then reviewed by one duplicate-review call, and retries must keep the same chapters. A single chapter ID, or an array with one ID, produces exactly the previous single-scope plan. `isSameCandidateDiscoveryScope(a, b)` tells whether two plans or results cover the same chapters.

Reassemble saved audits with `assembleCandidateDiscovery()` without another model call. This stage does not set parents, extract attributes, assign media or register final ledger records.

### Whole-pool duplicate review

After every discovery unit completes, `deduplicateCandidates(plan, discovery, options)` submits the entire validated candidate pool in one structured LLM call, including chapter paths, original body blocks, relevant table rows/headers and adjacent context. `createCandidateDeduplicationRequest` exposes the exact request before execution. `assembleCandidateDeduplication` checks its saved audit against the full input and requires a complete, disjoint partition. Unknown, missing, repeated or mixed-kind assignments invalidate the entire partition; code never repairs model assignments. Deduplication prompt v7 (current, `CANDIDATE_DEDUPLICATION_PROMPT_VERSION`) keeps every group within one record kind, so a site and an area of the same name cannot share a group, and asks only for merges: `mergesByKind` lists groups of two or more refs of one kind, and a candidate outside every merge stays its own record. Assembly adds those records as single-member groups with the code reason `CANDIDATE_DEDUPLICATION_UNMERGED_REASON`, orders all groups by their first member's pool position, and still rejects repeated or unknown refs, mixed kinds, lists under kinds absent from the pool and uncertain matches within one group. A forgotten candidate therefore stays unmerged instead of invalidating the partition. Saved audits of earlier prompt versions replay with their own response shape and still require a complete partition (see the [prompt history](https://github.com/heripo-lab/heripo-engine/blob/main/packages/ledger-extractor/docs/prompt-history.md#duplicate-review-prompt-history)). Uncertain identities remain separate with explicit review notes. Since deduplication prompt v3, the prompt also permits an unnumbered layer occurrence to merge with a report-defined layer when the supplied overall definition, local position, material and stratigraphic role jointly establish identity. Reasons must explain that evidence chain. Generic ground/soil names alone remain insufficient, and distinct subdivisions stay separate. Only the processed-document snapshot is evidence; omitted PDF wording is never reconstructed. Original candidate identifiers and evidence remain unchanged.

`deduplicateCandidateBlocks(plan, discovery, { model, maxRetries, abortSignal, completed, onBlock })` is the split review used by the demo. `planCandidateDeduplication(plan, discovery)` first decides by code, deterministically and offline: a pair of one kind with the same identifier and name merges (`same_number`), and a pair with the same name whose identifier stands in the other's anchor block or table row as a number of a different form merges (`number_correspondence`, a concordance such as "마도23-3 마도발굴23-28"), provided the link is one to one. Numbers of one form side by side ("33호 … 5호") are relations such as overlaps, and a number linking one candidate to several goes to the model. The model judges only possible duplicates: every pair of a kind told apart by context (`CANDIDATE_DEDUPLICATION_CONTEXT_KINDS`: site, area, trench, layer, shipwreck, unknown), a shared identifier under another name, one name without identifiers, an unnumbered mention whose name only one numbered candidate has, correspondences that are not one to one, and (split `candidate-deduplication-split.v2`) numbers of different forms linking two names one of which contains the other, such as `마도23-26 청자양각연판문병(호)` and the table row `마도시굴23-12 청자양각연판문 병(호)저부편` under the heading "마도23-26 마도시굴23-12". Split v1 left such pairs apart without asking; a saved audit is replanned under its own split version. Each connected set of such pairs is a block, and `createCandidateDeduplicationBlockRequest` sends it as prompt `candidate-deduplication.v8` (the v7 merge prompt plus a block rule) with only the units that hold its candidates' evidence and its shared system prompt marked for the provider's prompt cache and Anthropic reasoning effort `low` (`CANDIDATE_DEDUPLICATION_BLOCK_PROVIDER_OPTIONS`: on the 32 saved blocks it kept 132 of 134 whole-pool merge pairs, against 131 at default effort, with 27% fewer output tokens); `completed` reuses saved block audits and `onBlock` receives each new one. `createCandidateDeduplicationBlockSchema(discovery, block)` returns a block's response schema for callers that send block requests themselves, such as through a batch API. `assembleCandidateDeduplication` accepts the resulting split audit (or `assembleCandidateDeduplicationSplit` directly): it recomputes the split and every block request, joins rule and model merges transitively into the same `ledger-candidate-groups.v1` groups, and reports a changed split, a missing or mismatched block, or an invalid response as issues without repair. On the saved runs of three reports the rules reproduced 81 of 93 Haiku merges on 화지산 (517 candidates) and 12 of 25 and 10 of 11 on two 마도 runs with no merge Haiku kept apart, except one 마도 row whose concordance differs from its body text; every other Haiku merge fell inside one block. The largest block request was about 81,000 characters instead of a 773,000-character whole-pool request, which keeps every Haiku 5.5 request under its 100,000-token long-context price.

The returned `CandidateDeduplicationResult` contains proposed groups referencing original candidate IDs. `getCandidateGroupMembers` retrieves every original occurrence, including unchanged names, quotes, offsets and source references. Original discovery results and model audits remain immutable; grouping does not rewrite source text, register final records or perform attribute/parent extraction. Group identity decisions still require human review.

The duplicate-review prompt distinguishes archaeological overlap/superposition (including Korean `중복`) from multiple records of one object. Reciprocal overlap notes and separately measured numbered features do not establish identity.

### Selective discovery retry

Discovery prompt v5 separates an unnumbered verbatim `sourceName` from the verbatim `sourceIdentifier`. It prohibits composing a name from context plus a number, adding suffixes, or restoring words split across source blocks/pages. Evidence fragments remain separate exact substrings, even when incomplete. Validation stays strict and never repairs model output.

`prepareCandidateDiscoveryRetry(plan, audits)` requires a complete replayable snapshot, selects only units with recorded validation issues and returns `retryUnitIds`, unchanged `retainedAudits` and their partial `result`. Run those selected units again, then assemble all retained/new audits and perform whole-pool duplicate review. Saved discovery v4 and v5 audits are checked against their respective exact prompts and current original unit input; unsupported or edited audit bindings remain issues.

The current discovery prompt is v15 (`CANDIDATE_DISCOVERY_PROMPT_VERSION`). It preserves merged header cells (`text`, `rowSpan`, `colSpan`, `isHeader`) in `headerRows`, asks for `tableRole` first, gives every exclusion one `category`, and has a table item select its number cell (`identifierSourceId`) and name cell (`nameSourceId`). Code checks, among other things, that every data row of an item table is answered by a candidate or a row-level exclusion, and that a feature or artifact with an independent body names its object within the first 15 non-space characters of an evidence block (`CANDIDATE_DISCOVERY_NAME_LEAD_CHARS`); body sources carry their heading section (`section`, `sectionHeading`). When the first response leaves item-table rows or side-by-side row blocks unanswered, fails a check, excludes a section heading that names a numbered object, passes numbered body blocks without a candidate or exclusion, or drops a body artifact's catalog number, `discoverCandidateUnit` sends one follow-up call carrying only the rules it needs (`followUpRules`). The audit records it as `followUp`, and anything still unanswered becomes an issue so the unit can be retried. Invalid responses remain issues; code never replaces model values. `createCandidateDiscoveryRequest(unit, promptVersion?)` rebuilds the exact system and user prompts of any saved version (the current one by default), and saved audits replay with their own prompt and checks. New discovery audits also record `finishReason`, `structuredAttempts` and, when the provider reports thinking tokens, `usage.reasoningTokens`. The version-by-version changes from v6 to v15, with their measurements, are in the [prompt history](https://github.com/heripo-lab/heripo-engine/blob/main/packages/ledger-extractor/docs/prompt-history.md#candidate-discovery-prompt-history).

`prepareCandidateDiscoveryRetry(plan, audits, { unitIds, updatedPlan })` also accepts explicitly reviewed units (including semantic exclusions) and updated bounded inputs for those units. It returns the replacement `plan`; unselected units and audits remain unchanged. Historical v4/v5 prompts remain replayable without applying v6 validation retroactively.

## Thin per-unit content attachment

The thin path is the current way to attach body sentences and table items to a frozen registry. It reuses the `prepareContentAttachment` plan and replaces the per-segment recipient calls with one compact call per unit, sent twice by default. All functions are deterministic and offline except `attachContentThinUnit`, which calls the caller's model.

`prepareContentAttachment(index, discoveryPlan, discovery, groups, { inputSha256, candidateSnapshotId, pdfPageNumbers, maxUnitChars })` freezes a validated candidate partition into a registry and plans a physical-page sweep without model calls. Supply the processed document's declared PDF pages, including pages with no body/table text. Whole body blocks and original table rows stay together; `maxUnitChars` is a soft source-text limit, not a total prompt/token limit. Original merged-cell grids, logical page ranges and chapter paths are retained. The plan includes every registry entry and inherited identity uncertainty; it does not select candidates by name matching.

- **Compile** — `createContentAttachmentThinInput(plan, unit)` returns `{ version, input, codeMap }` (`content-attachment-thin-compile.v1`). Code splits source text into sentence segments, and the model addresses original words through Q windows of at most 16 words (`CONTENT_ATTACHMENT_THIN_WINDOW_WORDS`). Code also prefilters the candidates offered to the model: areas, trenches and layers always; literal name-and-number matches; same-chapter numbers; and members of chapters whose title core appears in the unit, if a chapter has at most 30 members (`CONTENT_ATTACHMENT_THIN_CHAPTER_MEMBER_LIMIT`). Chapter-by-kind handles (`H` refs) stand for whole groups. Original reading order, captions and table locations are kept. Registration rows, cell-registered candidates and uniquely typed table rows (`createContentAttachmentThinRowOwners`) are attached in code and never sent to the model.
- **Request** — `createContentAttachmentThinRequest(compilation)` builds the thin prompt (first released as `content-attachment-thin.v8`; the current default is in the next item) and a provider schema that requires every segment key. Each decision is `k: a|n` with targets, handles, excluded refs, identity and relationship-subject alternatives, and Q/L evidence. `contentAttachmentThinRestoredRules()` returns the attachment rules reused verbatim from the `segment-recipients.v26` prompt.
- **Request format** — `createContentAttachmentThinRequest(compilation)` defaults to prompt `content-attachment-thin.v13` (`CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION`). Prompt v11 (`CONTENT_ATTACHMENT_THIN_HEADINGS_VERSION`) is v10 plus one rule: a heading that names a registered candidate describes it even with figure or photo references, a topic heading naming no candidate stays `n`, and a sentence saying the report discusses named candidates describes them. Prompt v12 (`CONTENT_ATTACHMENT_THIN_CATALOG_VERSION`) adds a catalog-entry rule to v11: every line of an entry in a one-object-per-entry catalog, including number, name, translated name, findspot, find date and measurement lines, describes that entry's object until the next entry's number line. Prompt v13 adds a counts and collective summaries rule to v11, and v14 (`CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION`) adds it to v12: a sentence that describes or counts a collective the report defines for the current investigation, or one class within it, describes every registered member of that collective or class, including qualified follow-ups about most or some members; a sentence about one type within a collective describes only that type's registered members, listed individually without the collective's handle; and a count that clearly exceeds the registered members because it includes unregistered finds describes no candidate. Prompt v15 adds a layer-context rule to v13, and v16 (`CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION`) adds it to v14. For registered current layers it replaces the relation-counterpart rule: a segment stating that an identified artifact or feature was found in, recovered from, cut into, founded on or built on a layer describes both the object and the layer, and a segment about a layer's own formation, composition, sequence, depth or extent describes that layer; a layer named only as overburden removed to expose an object is not attached, and a common name such as 표토 alone does not identify one layer. V15 and V16 are opt-in (`{ version }`): rerun on three reports, they attached findspot and base layers in only one of two runs, so those segments stayed in review, and total review items did not fall. `attachContentThinUnit` sends v14 when the plan's `thinPolicy.catalog` is `'fields'`, and v13 otherwise; saved v11, v12, v15 and v16 requests replay as recorded. Pass `{ version }` to rebuild any saved version. Prompt v10 (`CONTENT_ATTACHMENT_THIN_ARRAY_VERSION`) introduced the array format: `d` is an array with one item per segment (`s` is the segment ref), and the schema (`createContentAttachmentThinArraySchema()`) is the same for every unit, checking segment, candidate, handle and range references by format only. Strict structured-output providers reject the per-segment object schema of large units as too complex; the array schema stays small. Pass `{ format: 'object' }` to build the v8/v9 request, whose schema enumerates segments, offered candidates, handles and windows.
- **Inspect** — `inspectContentAttachmentThinResponse(plan, unit, { request, rawResponse })` recompiles the request in the saved request's version (array for v10/v11, object for v8/v9) and rejects a changed one, so saved runs replay unchanged. Membership of segments, candidates, handles and ranges is checked here; in the array format an item without a segment ref is an issue, and a segment returned twice is an issue and left out. It checks the structure and resolves handles and evidence to original words and UTF-16 spans. It returns `{ issues, findings, decisions }` without editing the raw response.
- **Route** — `routeContentAttachmentThinSegments(plan, unit, compilation, runs, { wholeUnitReview })` automatically confirms only targets that every run returned. A segment goes to review when targets are contested, uncertainty groups differ, a run is invalid or an area is returned. Targets every run returns are confirmed however many there are, so a count or summary sentence that every run attached to a whole collective, directly or through its chapter handle, is attached without review. Earlier versions sent such segments to review above 50 confirmed targets (`large_collective`) or 10 targets through a handle (`large_handle`); saved routings with those reasons still read, and the size constants are no longer exported. A layer named literally in the segment that no run returned is listed in `layerMentions` instead of sending the segment to review: the prompt leaves relation counterparts such as a findspot or base layer to a later stage, so the segment keeps its other targets and the layer becomes a relation candidate. A layer named only as removed overburden, as in "표토층과 현대 퇴적층을 제거하자", is not listed, and a layer some runs returned is contested like any target. `assembleContentAttachmentThin` collects them in `layerMentions` (segment, span, layers and the segment's confirmed targets). Saved routings with the older `layer` reason still read; re-routing the saved 화지산 runs moved 27 layer reviews to 15 layer mentions and review items from 70 to 48. Areas always go to review by default. When the plan's `thinPolicy.areas` is `'unanimous'`, an area that every run returned is confirmed like other targets, and an area that only some runs returned is contested. `contentAttachmentThinPolicyFromProfile` sets this option for every profile. The option is frozen into each plan, so plans prepared earlier keep their routing. `checkContentAttachmentThinOutliers(segments, runs)` flags a run that alone disagrees on more than 25% and at least 3 segments (`CONTENT_ATTACHMENT_THIN_OUTLIER_RATE`, `CONTENT_ATTACHMENT_THIN_OUTLIER_MIN_COUNT`).
- **Run** — `attachContentThinUnit(plan, unit, { model, runs = 2, providerOptions, maxRetries = 0, abortSignal, onAttempt, onCall })` sends every call with `CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS` (Anthropic reasoning effort `low`; other providers ignore it) unless `providerOptions` is given (`{}` for the provider default), and records the options on each call. On 24 saved units of three reports, Haiku 5.5 at `low` differed from the saved default-effort runs on 5.2% of segments while those runs differed from each other on 6.0%, with 38% fewer output tokens; with reasoning disabled it produced 284 inspection issues and differed on 11.7%. It sends r1 and then r2 (`CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS`), so r2 can reuse the provider's prompt cache, and routes every segment with both runs: a target confirms only when both return it. A failed call is not re-sent and fails the unit. Two runs have no outlier check, so `outliers` holds only `finalRuns` (`r1`, `r2`) and `wholeUnitReview: false`. Replaying the saved Haiku 5.5 runs of three reports this way under `trivial: 'code'` auto-decided 89.8%, 95.1% and 96.3% of segments against 89.1%, 94.1% and 94.7% for the saved three-run routing, with 512 instead of 758 calls and about a third fewer output tokens. Scored against a third run left out (rotating the saved runs), two agreeing runs differed on 0.8–1.3% of their auto segments and one run alone on 1.6–3.0%. With `runs: 3` it sends r1, then r2 and r3 together. If exactly one run is an outlier, it sends one replacement call (r4). If the replacement is also an outlier, the runs hold two readings: segments are routed with all four runs (`finalRuns` lists r1–r4), so a target confirms only when all four return it and any disagreement goes to review. If the replacement fails, the whole unit goes to review. Saved results keep the routing they recorded. Every call is reported through `onCall` with its request, raw response, usage and inspection. The result status is `routed`, `failed` or `no_llm_segments`.
- **Calls made elsewhere** — `createContentAttachmentThinUnitRequest(plan, unit)` returns the frozen request `attachContentThinUnit` sends (prompt v14 under `catalog: 'fields'`, v13 otherwise), or `null` for a unit without model-judged segments, so a caller can send it through another channel such as a provider batch API. `recordContentAttachmentThinCall(plan, unit, { run, request, rawResponse, usage?, finishReason?, error?, callAttempts? })` turns each answer into the same call record, inspected and never repaired; `error` records a failed call. `routeContentAttachmentThinTwoRuns(plan, unit, calls)` routes the default two-run path from r1 and r2 and returns the same unit result: `failed` when either is missing or failed, `no_llm_segments` when no call is needed, and an error when a call's request differs from the unit's current request. `attachContentThinUnit` uses the same three functions.
- **Tie-break** — With two runs, `attachContentThinUnit` sends further runs as `contentAttachmentThinNextRun` asks: r3, then r4, to replace a degenerate run (`isContentAttachmentThinDegenerate`: a completed answer missing decisions for at least half the segments, as Haiku 5.5 at effort `low` occasionally returns) and to break a tie when the two usable runs leave segments in review only because they disagree (contested targets, differing uncertainty groups or one invalid run; `isContentAttachmentThinTiebreakable`). No run follows a failed call, and `tiebreak: false` turns this off. `routeContentAttachmentThinTiebreak` keeps the segments r1 and r2 agree on, decides the others by whichever of r1 or r2 r3 agrees with (`decidedBy: 'majority'`), and leaves the rest in review with all three runs; segments in review for areas or a whole-unit review are not settled this way. `routeContentAttachmentThinTwoRuns` routes the first two usable runs, with a third usable run as the tie-break; with fewer than two usable runs it routes r1 and r2 as they are. On the saved three-run 마도 thin run, r3 matched one side on 125 of the 127 segments r1 and r2 sent to review, in 24 of 111 units; how often such a majority is right cannot be measured without a fourth run.
- **Assemble** — `assembleContentAttachmentThin(plan, results)` returns `ledger-content-attachments.v2`. Contents reference original segments by resource key and span with a basis of `model_unanimous`, `model_majority` (decided by a tie-break), `code_row_owner`, `code_typed_row` or `code_cell_registration`. Review items keep each final run's decision. When a review item's confirmed and contested targets are exactly the members of one chapter collective with at least five members (`CONTENT_ATTACHMENT_THIN_COLLECTIVE_REVIEW_MIN_MEMBERS`), the item carries `collectiveHandle` (handle ref, chapter path, kind and member count; the deepest chapter wins), so a reviewer can decide every item of that collective at once. Nothing is confirmed automatically by this mark. The result starts as `not_reviewed`. Relation counterparts (for example the other feature in "cut by feature 3") are not attached at this stage: `scope.relationCounterparts` is `deferred_to_link_extraction`.

## Archaeology ledger

`assembleArchaeologyLedger(plan, attachments, { ledgerId, processedDocumentId, extractorVersion, extractedAt, createdAt })` assembles `archaeology-ledger.v1` from what the engine extracts today, deterministically and without model calls:

- **Ledger** — the ledger header: the processed document, extractor and attachment prompt versions, `validationStatus` (`not_run` until `applyLedgerValidation` decides it), `reviewStatus: 'not_reviewed'`, the candidate snapshot and, when the plan has one, the report profile with its thin rules and rule decisions.
- **Records** — one record per frozen registry entry (`record-<groupId>`), with kind, source identifier and name, and `content`: original sentences or table phrases cut unchanged from the processed document. Identical text shares one excerpt listing every source.
- **Sources** — where each excerpt occurs: resource key and character span (`locator`), PDF page, chapter, text block or table cell, the processed-document reference and `basis` (`registration` for the candidate's own evidence, otherwise the attachment basis). Registration evidence outside the plan falls back to its saved quote.
- **Review items** — what a person must decide; the engine never decides it. `segment` items come from attachment review (proposed and already-confirmed records, reasons, the segment text and, when the proposal equals a chapter collective, `collective`); `identity` items from uncertain registry merges; `profile_decision` items from thin rule decisions marked `needsDecision`. A record has `needsReview` when a non-collective item proposes it without every run agreeing or its identity is uncertain; a collective item is decided once for the whole set and does not flag each member.
- **Pending** — parent hierarchy is added by `applyLedgerParents`, media references by `applyLedgerMedia`, attributes by `applyLedgerAttributes` and links by `applyLedgerLinks` below. `attributes`, `mediaReferences` and `mediaCandidates` stay empty until those run, `layerMentions` holds the attachment view's layer mentions (`named_in_segment`: the layer record, the segment's records, text, locator and page) as relation candidates without review, `links` holds only relations kept beside a chosen parent until `applyLedgerLinks` runs, and `pending` (`ARCHAEOLOGY_LEDGER_PENDING_PARTS`) lists what is missing so consumers show it as pending, not as empty findings.

## Parent hierarchy signals and code-decided parents

The functions below collect parent candidates, decide the parents code can decide, send the remaining questions to a three-run model judgment, and put the results into the ledger. All are deterministic and offline except `judgeRelationParentBatch`.

- **Signals** — `collectRelationSignals(plan, ledger)` returns `relation-signals.v1`, the parent candidates of every record with their source text:
  - `phrase`: a find-spot phrase in the record's own excerpts (`X에서 출토된`, `출수위치 X`). `finding` is false for confirming verbs (`확인`, `검출`, `발견`).
  - `table_row`: another record named in the record's own table row. `header` is the column's first-row cell, and `finding` is true only for a find-spot or membership column (`출토`, `출수`, `수습`, `위치`, `소속`); a cell elsewhere in the row, such as a trench's list of features, only proposes a candidate.
  - `heading_scope`: the record heading the record's first text falls under in reading order. Numbered headings that name no record close the scope.
  - `chapter_title`: the record's own chapter title naming a record.

  Names match by identifier with name, longest name first, in the exact form and in a looser form without `호` after a number, so `98호 수혈` meets a record registered as `98` and `수혈`. When several records answer one place — a report that restarts numbering per period registers `29호 수혈` and `29 수혈` in different chapters — the records nearest the speaking record by chapter path are kept, then the exact form among those still tied; records still tied stay an ambiguous target. A place that names the record itself is no find-spot. The relation-sentence finder below chooses names the same way. A numbered place (`98호 수혈`) never matches a record that has only the bare name. Same-kind records are skipped for rows, headings and chapter titles, since they are siblings or classification headings. No kind hierarchy is assumed. A finding phrase whose place matches no record is kept with no target.

- **Code-decided parents** — `resolveRelationParents(signals, ledger)` returns `relation-parents.v1`:
  - A parent is set only when finding phrases and membership-column table rows name exactly one record. When they name one feature and records of other kinds, the feature is chosen and the others become link candidates.
  - Heading-scope and chapter-title signals never set a parent. They become questions, as do confirming phrases, other table rows (`row_only`), unmatched places, ambiguous or conflicting targets, and parents that would close a cycle.
  - Questions keep their candidates and signals for a later judgment or a person.
- **Parent judgment** — For questions code cannot decide, a model judges the parent. Only `judgeRelationParentBatch` calls the caller's model.
  - `createRelationParentRequests(plan, ledger, parents, { batchSize = 12, maxCandidates = 15 })` builds `relation-parent-judgment.v2` requests without a model call. Questions follow ledger order in batches.
  - Each question offers the candidates its signals named. For a finding phrase whose place matched no record, it also offers records of another kind that share a name word and, when the place has numbers, a number: `발굴 1구역` offers `23-1 구역`.
  - For a place that matched no record, up to three context records are shown, never offered as answers. These are records of an offered candidate's kind whose names contain a place word no candidate has, with their excerpts that carry numbered codes. For example, `발굴 1구역` brings the area `정밀발굴조사` and its "23-1~6구역" statement, so the model can tie the short form to `23-1 구역` only when the text states the coverage.
  - Evidence is the signal text and the record's first excerpts with up to 300 characters of their surrounding block. The model answers each question with a candidate ID or `none`, evidence IDs and a short reason. The rules require stated containment, never kind order, nearness or assumed spellings.
  - `inspectRelationParentResponse(request, rawResponse)` checks every answer against its question without repairing it.
  - `judgeRelationParentBatch(request, { model, maxRetries = 0, abortSignal, onAttempt, onCall })` sends r1, then r2 and r3 together. A failed call is not re-sent and sends the whole batch to review.
  - `decideRelationParents(request, inspections)` sets a parent, or `none`, only when every run validly agrees. Anything else is left for review.
- **Into the ledger** — `applyLedgerParents(ledger, parents, judgments = [])` returns the ledger with `parentRecordId`, `parentBasis` (`code` or `judgment`) and `parentEvidence` on each decided record.
  - Every other question becomes a `parent` review item with reason `unresolved_parent`, its candidates and the runs' votes, and flags the record. This covers questions not judged, judgments the runs split on, and a unanimous `none` for a stated place no record matched: the place is written but not registered.
  - A unanimous `none` for any other question leaves the record without a parent and without review.
  - Parents that would close a cycle are undone and reviewed. Link candidates beside a chosen parent become `links`, and `parent_hierarchy` leaves `pending`.
- **Place aliases** — A person can decide once how a report's short place names correspond to registered names, such as `발굴 {n}구역` → `23-{n} 구역`, and inject them as `place-aliases.v1` (`PlaceAliasTable`), like a report profile.
  - **Table:** the input hash, `source` (`'manual'` for a person's table, `'model'` for a kept proposal) and a confirmation time. Each rule has an `id`, its `written` forms, the `registered` name, an optional `numbers` range for the `{n}` placeholder, an optional `recordKind`, and a required `basis.quote`: the report text that states the correspondence.
  - **`validatePlaceAliases(plan, ledger, table)`** returns `{ errors, warnings }` without changing the table.
    - Errors make it unusable: version, input, source or time; no rules; missing or repeated IDs; empty forms; `{n}` not used once everywhere or nowhere; bad ranges; unknown kinds; a basis quote not found in the document; one written form sent to two names.
    - Warnings, for a table without errors: a registered name matching no record or several; a rule whose written forms never occur; a record registered under a written form, left for an identity review.
  - `PlaceAliasValidationError` carries the errors for callers that refuse an invalid table.
  - **Applying:** pass the table as `collectRelationSignals(plan, ledger, { placeAliases, placeAliasesSha256 })`. `placeAliasesSha256(table)` hashes a table with sorted keys; a table with errors throws.
    - A finding phrase or membership-column table cell whose place no record name matched is retried through the rules. The written form must end the place, ignoring trailing punctuation, and its number must be in range. When the registered name, of the rule's kind, names one record, that record is the target and the signal keeps the rule as `alias`; otherwise the place stays unresolved (`alias_unresolved`).
    - A parent decided only through rules has basis `alias`. In the ledger it gets `parentBasis: 'alias'` and, besides the phrase or cell, an `alias_rule` evidence entry with the rule, `<written> → <registered>` and the basis quote.
    - Records registered under a written form (`발굴 2구역` beside `23-2 구역`) get no parent from the rules. They become `identity` review items (`alias_duplicate`) with their registered record, without merging, and no parent question.
    - The ledger header records the applied table (`placeAliases`: rule IDs, source, confirmation time, input hash and, when given, the table hash). `buildArchaeologyLedger` reports the applied table's `source` too.
  - **Proposal (`place-alias-proposal.v1`):** when no person has decided a table, a model can propose one for the parent questions code left open.
    - `createPlaceAliasProposalRequest(plan, ledger, parents)` builds the request without a model call, or returns null. It lists the written places no record name matched, the registered names they may stand for (as offered to parent judgment, leaving out records named like a written place, such as `발굴 2구역`), and statements: the plan's text blocks of up to 400 characters with a numbered code (23-1, 23-A), a place word no name has and a word of the names, such as `1) 정밀발굴조사(23-1~ 6구역)`. Statements come from the report text, not from records.
    - `proposePlaceAliases(plan, ledger, request, { model })` sends two runs together; a failed call proposes no table.
    - `assemblePlaceAliasProposal` keeps, unchanged, the rules both runs gave alike (same written forms, registered name and numbers) that pass code checks, and lists every dropped rule with its reason. Checks: a basis cited by statement ID in both runs; a number range for a numbered rule; a written word the registered name lacks (a bare `{n}구역` never maps); a basis naming that word and the registered code (`23-A` of `23-A-{n} 구역`); `validatePlaceAliases`; and at least one written place mapped to exactly one record. Kept rules form a `source: 'model'` table whose basis quote is the whole statement.

## Figure and photo references

These functions link records to images and put the links into the ledger, deterministically and without model calls.

- **Caption index** — `indexMediaCaptions(index)` returns `media-caption-index.v1`.
  - Each captioned image gets a label from its caption number (`도면 1`, `사진 45`, `원색도판 3`, `도 12-1`; types in `MEDIA_LABEL_TYPES`). The caption text is kept unchanged.
  - Labels shared by several images are visible in `byLabel`. Images without a caption, or whose number is not such a label, are listed apart.
- **Text references** — `collectMediaReferences(captions, ledger)` returns `media-references.v1`.
  - It finds the labels each record's own excerpts cite, such as `(도면 31, 사진 143)` in an artifact heading. Ranges (`사진 45~49`, up to 60 numbers) and lists (`도판 10· 11`, `사진 45, 46`) are expanded. A label right after a Hangul letter is not a reference, so `마도23-1` is not figure `도 23-1`.
  - A label one image has links the record to that image (`text_reference`), with the excerpt that cites it. A label no image has is `missing`; a label several images share is `ambiguous`.
- **Caption references** — `collectCaptionReferences(captions, plan, ledger, textReferences)` returns `caption-references.v1`.
  - A caption naming exactly one numbered record that is not an artifact (`도면 41 … 1호 수혈 평면도`) links it (`caption_name`). Unnumbered names such as `지점` are not used, since they name kinds as often as records.
  - A numbered series (`11~20호 수혈`, `1~4호 건물지와 주변…`) links each numbered record of that name (`caption_range`).
  - Numbering can restart across sections, so a caption's chapter-title words before the name (such as `조선시대`) rule out records whose chapter titles lack them while other records of the kind have them. Words that name records of that kind (`수혈`) do not count. Among the rest the exact name form, then the image's chapter, decides; otherwise the number is reported as unresolved.
  - Parenthesized artifact numbers (`출토유물(24~28)`) create no links. They check the artifacts that text references linked to the same image (`artifactNumberChecks`: agreeing and disagreeing).
- **Same-page candidates** — `collectSamePageCandidates(index, ledger)` groups uncaptioned images with the records whose excerpts are on the same PDF page, such as a catalogue page with two artifacts and six photos. Without a caption or a layout position, code cannot tell which image shows which record, so nothing is linked; each page becomes a page-level candidate, not a review question.
- **Into the ledger** — `applyLedgerMedia(ledger, { captions, text, caption, samePage })` fills `mediaReferences` and `mediaCandidates`.
  - Text references come first, then caption names and series. Each record–image pair is kept once, with every excerpt or caption that linked it, the caption text as written and its label words (`mediaType`, `sequenceNo`), and its `ordinal` among the record's images.
  - Same-page groups become `mediaCandidates` (`same_page`: page, image IDs and the page's records in ledger order). They tie no image to one record and add no review item.
  - `media` review items are added for a cited label several images share (`media_ambiguous`, which flags the record) and a caption naming several records (`media_caption_several`, which concerns an image and does not flag records).
  - Cited labels no image has and disagreeing artifact numbers go to `issues` as `REFERENCE_LABEL_MISMATCH` warnings, unresolved caption series as `MEDIA_MATCH_AMBIGUOUS` warnings, and `media_references` leaves `pending`.

## Table attributes

`collectTableAttributes(index, plan)` returns `table-attributes.v2`, the first source of attributes, deterministically and without model calls.

- A record owns a table row segment from its original identifier cell to the right; this is the row-owner rule of content attachment. So a trench row's `도로유구 1기` cell stays the trench's attribute.
- `logicalTableCells(tableKey, table)` places each stored cell in the logical grid. Processed grids leave out the cells a merge covers, so a stored column index can differ from the real column.
- Column keys come from the rows above the first owned row, read top to bottom through the logical grid (`규모(cm) / 길이`); the input's header flags are not relied on. Rows of numbers only are not headers. A header part counts only when it names something (a Hangul letter or a two-letter word), so the numbers of a table fused alongside give no key; such cells are listed in `cellsWithoutHeader`. A header whose horizontal merge was lost in preprocessing (stored as one cell followed by empty cells over named sub-headers, `크기(cm)` over `길이/높이 · 입지름/너비 · …`) is carried right over those empty cells, so every column keeps `크기(cm) / …` and its unit.
- A two-column table of text labels with no owned rows is a key–value table. When exactly one record is registered in it, every other row gives that record an attribute keyed by the row's label.
- Each attribute keeps the cell text as `valueText` and `sourceText`, a unit written in parentheses in the key as `unitText` (`(cm)`), `extractionMethod: 'table_mapping'` and its table, row, logical column and page. A record's own registration cells and empty cells are not attributes; nothing is converted or normalized.

`collectTextAttributes(plan, ledger)` returns `text-attributes.v2`, the second source, from each record's own excerpts, also without model calls.

- In one sentence, consecutive measurements joined by commas or `와·과·및` form one value, kept as written and never split: `길이 4.9m, 너비 3.89m이상, 깊이 3.7m`, `높이 7.8cm 입지름(추정) 16.0cm 굽지름 6.6cm`, `238×28×32cm`. Dimension words may carry a qualifier (`잔존 너비`), an attached prefix (`굽지름`) or a parenthesized qualifier (`높이(잔존)`), and a value may carry a part written after it with further values of the same dimension (`굽높이 0.5cm(내) 0.5cm(외)`), so no value is dropped. Sentences end only at a period before whitespace or a line break, so `4.9m` is not split.
- The key is the label written right before the run (`전체 규모는` → `전체 규모`, `조사면적은` → `조사면적`); a modifier ending in a particle (`수혈의 규모는`) is dropped. Otherwise the key is the single dimension word, or `크기` for an unlabeled run. `unitText` is set when every measurement in the run uses the same unit; nothing is converted.
- A quantity right after an unnumbered (collective) record's own name (`수혈 5기`) becomes `수량`.
- When the sentence also names another numbered record of the same kind, the value is not assigned and becomes an owner question (`ownerQuestions`) with those records.

`applyLedgerAttributes(ledger, { table, text })` puts both into the ledger's `attributes`, table attributes first, as `attribute-N` with key, value, unit, source text, `extractionMethod` and where the value is (`tableId` and `cellKey`, or `sourceId` and `locator`, with the page). Values found in several places are all kept; nothing is merged. Owner questions become `attribute` review items (`attribute_owner_ambiguous`), one per sentence and value: `recordIds` are every record asked about that value, `candidateRecordIds` the other records named, and `detail` is `key: value`; each record asked about is flagged. A sentence such as "10 × 10m 크기의 그리드를 하나의 구역으로 설치하고 23-1구역부터 23-6구역까지 …" is one item rather than one per area; the value is not shared out to the records, because a value written once may also be a total. Owned cells without a header are counted per table in `issues` as `UNMAPPED_TABLE_CELL` info. `attributes` leaves `pending`.

## Record links

Three steps collect, decide and record links between records, and decide them deterministically and without model calls; relation labels are short source words, not ontology predicates.

- `collectRelationSentences(plan, ledger, tableAttributes?)` returns `relation-sentences.v1`. It keeps a sentence of a record's own excerpt when the sentence names another registered record and a clause carries a relation cue (overlap, cutting, adjacency, distance, connection, joining, enclosure) once record names are masked. Every name of a numbered record is used. An unnumbered name is used only when it has three or more letters, belongs to one record and is not the class name numbered records share (`트렌치`, `구상유구`). A name that is the record's ancestor or descendant is containment and left out. Layer order (`차례로`) is not a cue. Owned cells of a column whose header names a relation (`중복관계`, `선후관계`) are kept with the records they name.
- `resolveRecordLinks(sentences)` returns `record-links.v1`. A link is made only when, inside one comma-separated clause, the predicate follows the name with its particle:
  - `B와 중복`, `B와 인접`, `B와 접합` and `B와 연결될 가능성` give symmetric links.
  - `B를 파괴` and `B에 의해 파괴` give directed links.
  - Distance and direction (`B가 4.3m 떨어져`, `B와 8.5m 거리를 두고`, `동쪽으로 B가 위치`) give `위치` links.
  - A relation column's cell naming one record gives a link labeled with the header.
- Coordinated names (`72호 수혈 및 96호 수혈과 중복`) share the predicate. A symmetric pair is one link carrying the evidence from both records.
- The rest go elsewhere:
  - **Questions:** enclosure (`B로 감싸여진`, `B 내부`, `B를 사이에 두고`) gives `link_enclosure`; names without a predicate in a cue clause, or list items placed by direction, give `link_several_targets` or `link_unclear`.
  - **Unresolved:** a name several records share, and an unregistered `N호 …` name.
  - **Skipped and counted:** a place the record is in (`B 내`, `B 중앙부`, or `A는 B 북쪽 …`), names inside a number span (`2~4호 건물지`) and names in clauses without a cue.

`applyLedgerLinks(ledger, recordLinks)` puts the decided links into `links` with `basis` (`rule` or `table_column`), `symmetric` and every stating sentence (`excerpt` evidence) or cell (`table_cell` evidence). A link equal to one kept beside a parent (same label and pair) adds its evidence there. Each question becomes a `link` review item with its reason, candidate records and sentence, and flags the speaking record. Unresolved targets go to `issues` as `UNRESOLVED_LINK_TARGET` warnings. `links` leaves `pending`.

## Ledger validation

`validateArchaeologyLedger(ledger, { document, plan, attachments? })` returns `ledger-validation.v1`. It checks the assembled ledger against the processed document it came from (implementation spec §22), deterministically and without model calls. Nothing in the ledger changes, and `reviewStatus` is never touched.

- Each check reports how many items it looked at and how many failed, so `0/0` is told apart from a check that did not run. Failures become issues with a spec code, a severity, the record, attribute or link, and a locator.
- **Structure:** unique IDs, records named by sources, attributes, media, links, review items and parents, ledger IDs, image IDs.
- **Hierarchy:** no self-parent, no cycle, every parent with a basis and evidence.
- **Source:**
  - a registration source for each record
  - excerpt sources that exist, belong to the record and carry its text
  - source resources and character spans equal to the document text
  - sourceRefs and table cell pointers
  - a source for each attribute
  - with `attachments`, a tracked attachment for each planned unit
- **Fidelity:** attribute values and units written in their source, and link evidence stated in either record's text.
- **Severities:**
  - Every contract violation is an `error`.
  - A name or identifier found in none of the record's registration excerpts and name anchors, captions of its registration tables, chapter titles or candidate evidence is a `warning` (`UNSUPPORTED_CONTENT_CLAIM`).

`applyLedgerNameAnchors(ledger, plan, document)` adds where a record's name is written when that evidence misses it. Catalogs print `번호 / 이름(한자) / 영문명 / …` as separate blocks and headings print a scope's name a block above its text, so the registration evidence can miss the name line. The blocks within `NAME_ANCHOR_DISTANCE` (3) of a registration text block in the same chapter are searched for the name, spaces ignored; a short heading-like block wins, then the nearest, then the earlier. The name's exact original span becomes a `name_anchor` source. Names, excerpts and `content` are not changed; a name the document itself misreads (OCR) stays as written.

- Excerpts that differ only in spacing, and a key with differing values, are `info` (`DIFFERING_SOURCE_VALUES`); both are kept as written.
- Records of one kind sharing a name (`29호 수혈` and `29 수혈` when numbering restarts per period) are `info` (`AMBIGUOUS_RECORD_IDENTITY`); they stay separate records told apart by chapter.
- `status` is `failed` with any error, `warnings` with warnings only, and `passed` otherwise.

Ledger `issues` are structured the same way for every step: `{ code, severity, stage, recordId?, attributeId?, linkId?, imageId?, message, locator? }`, with `stage` naming `assembly`, `media`, `attributes`, `links` or `validation`. Assembly reports attachment problems (`UNRESOLVED_EVIDENCE_ASSIGNMENT`; a missing unit is an error). The `apply*` stages add their issues but never set `validationStatus`; the ledger stays `not_run` until `applyLedgerValidation(ledger, report)` appends the report's issues, flags `needsReview` on records a warning names and decides `validationStatus` once from every issue's severity.

## Building the ledger in one call

`buildArchaeologyLedger({ document, plan, attachments, meta, placeAliases?, parentJudgments?, discoveryScope?, droppedProposals? })` runs every ledger step in order, deterministically and without model calls. `droppedProposals` (discovery `issues`: proposals that failed their checks and registered no record) become `DROPPED_CANDIDATE_PROPOSAL` warnings of stage `discovery` in `issues`, so a consumer sees what discovery left out. The steps:

1. assembly from the saved thin attachment result
2. the place alias table, applied only when `validatePlaceAliases` finds no errors
3. relation signals, code parents and saved parent judgments
4. figures and photos
5. table and text attributes
6. record links
7. name anchors (`applyLedgerNameAnchors`)
8. full validation, which decides `validationStatus`
9. the spec §23 order

Model steps (candidate discovery, thin attachment, parent judgments) run elsewhere; their saved results are the inputs, so the same inputs always give the same ledger. `meta` takes the ledger ID, extractor version and timestamps; `processedDocumentId` defaults to the document's `reportId`.

It resolves to `{ result, validation, placeAliases, stages }`:

- `placeAliases` says whether the table was applied: `none`, `applied` with rule IDs, hash and warnings, or `invalid` with errors.
- `stages` holds what each step produced (signals, parents, caption index, media references, attribute sources, relation sentences, record links) for measurement and debugging.

`sortArchaeologyLedger(ledger, document)` applies the order on its own without changing any ID or value:

- records by parent depth, parent, `ordinal` and ID
- excerpts by the document order of their first source
- attributes by record and source position
- sources by record, PDF page and locator
- media references by record and ordinal
- links by their records and label

Display can still sort by `ordinal` for reading order.

## Extraction preview

`LedgerExtractor.extract()` is the first slice of this package, kept as a minor, model-free check. It summarizes a `ProcessedDocument` into a `LedgerExtractionPreview` — aggregated counts plus a few representative samples — proving the data arrived at the ledger stage intact.

- **Runtime validation**: `parseProcessedDocument()` validates unknown input (e.g. uploaded JSON) against the `ProcessedDocument` model using zod
- **Recursive aggregation**: chapters and text blocks are counted across the whole `chapters`/`children` tree
- **Table cell aggregation**: every `grid` cell of every table is counted
- **Bounded samples**: chapter titles, text blocks, image URLs, and tables limited to a configurable sample limit (default 5); long text is truncated
- **Injected logging**: no direct `console.log`; all logs flow through an injected logger

```typescript
import {
  LedgerExtractor,
  parseProcessedDocument,
} from '@heripo/ledger-extractor';
import { readFileSync } from 'fs';

// 1. Validate unknown input (e.g. an uploaded processed-document.json)
const raw = JSON.parse(readFileSync('processed-document.json', 'utf8'));
const document = parseProcessedDocument(raw);

// 2. Run the extraction preview
const extractor = new LedgerExtractor({
  logger: console, // any debug/info/warn/error logger
  sampleLimit: 5,
});
const preview = await extractor.extract(document);

console.log(preview.counts);
// { chapters: 24, textBlocks: 831, images: 173, tables: 48, tableCells: 1240, footnotes: 91 }
console.log(preview.samples.images[0]?.url);
// https://cdn.example.com/images/report-id/file-id/image.png
```

Example log output:

```text
[LedgerExtractor] ProcessedDocument loaded: reportId=...
[LedgerExtractor] chapters=24, textBlocks=831
[LedgerExtractor] images=173, tables=48, tableCells=1240, footnotes=91
[LedgerExtractor] sample image URL: https://...
[LedgerExtractor] extraction preview completed
```

### `parseProcessedDocument(input: unknown): ProcessedDocument`

Validates an unknown value and returns a typed `ProcessedDocument`. Throws `ProcessedDocumentValidationError` (with a bounded list of issues) when validation fails.

### `new LedgerExtractor(options?: LedgerExtractorOptions)`

| Option        | Type                    | Default      | Description                        |
| ------------- | ----------------------- | ------------ | ---------------------------------- |
| `logger`      | `LedgerExtractorLogger` | no-op logger | debug/info/warn/error log receiver |
| `sampleLimit` | `number`                | `5`          | Max entries per sample list        |

### `extract(document: ProcessedDocument): Promise<LedgerExtractionPreview>`

Returns aggregated counts (`chapters`, `textBlocks`, `images`, `tables`, `tableCells`, `footnotes`) and samples (`chapterTitles`, `textBlocks`, `images`, `tables`).

## Prompt history

Earlier content-attachment paths — per-unit prompts up to `content-attachment.v74`, per-segment recipient judgments up to `segment-recipients.v26` and the evidence-window contracts — and the version-by-version notes of the discovery and duplicate-review prompts are kept in [docs/prompt-history.md](https://github.com/heripo-lab/heripo-engine/blob/main/packages/ledger-extractor/docs/prompt-history.md). Those APIs remain exported so saved audits stay replayable; new runs use the thin per-unit content attachment above.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
