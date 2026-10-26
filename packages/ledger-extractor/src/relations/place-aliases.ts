import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';

import { kindSchema } from '../candidates/discovery-types';
import { canonicalSha256 } from '../profile/report-profile';
import { createRecordNamer } from './record-names';

export const PLACE_ALIASES_VERSION = 'place-aliases.v1' as const;

/**
 * One person-decided correspondence between how a report writes a place and the name a record is registered
 * under, such as `발굴 {n}구역` → `23-{n} 구역`. `{n}` stands for one number and is carried over.
 */
export interface PlaceAliasRule {
  id: string;
  /** Written forms in the report; each has `{n}` once, or none when the rule maps one fixed form. */
  written: string[];
  /** The registered record name, with `{n}` when the written forms have it. */
  registered: string;
  /** The numbers `{n}` may take; numbers outside are not mapped. */
  numbers?: { from: number; to: number };
  /** Only records of this kind are matched. */
  recordKind?: string;
  /** The report text that states the correspondence; it must occur in the document. */
  basis: { quote: string };
  note?: string;
}
/** Place alias table (`place-aliases.v1`), injected from outside like a report profile. */
export interface PlaceAliasTable {
  version: typeof PLACE_ALIASES_VERSION;
  /** SHA-256 of the processed-document input the table was decided for. */
  inputSha256: string;
  source: 'manual';
  confirmedAt: string;
  rules: PlaceAliasRule[];
  notes?: string;
}
export interface PlaceAliasValidation {
  /** Problems that make the table unusable. */
  errors: string[];
  /** Problems that leave the affected numbers or rules unapplied, or records for an identity review. */
  warnings: string[];
}

/** Thrown when an invalid place alias table is used; `errors` lists every problem. */
export class PlaceAliasValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid place aliases: ${errors.join('; ')}`);
    this.name = 'PlaceAliasValidationError';
    this.errors = errors;
  }
}

const norm = (text: string) => text.replace(/\s+/g, '');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A written form as a pattern over space-free text; `{n}` captures a whole number. `whole` matches the entire
 * text, `end` its end (a place at the end of a phrase), `anywhere` any part.
 */
function patternOf(written: string, mode: 'whole' | 'end' | 'anywhere') {
  const body = norm(written)
    .split('{n}')
    .map(escape)
    .join('(?<!\\d)(\\d+)(?!\\d)');
  return new RegExp(
    mode === 'whole' ? `^${body}$` : mode === 'end' ? `${body}$` : body,
  );
}
const KINDS: readonly string[] = kindSchema.options;

/**
 * Check a place alias table against the attachment plan and the assembled ledger without changing it, like
 * `validateReportProfile`. Errors: an unsupported version, another input, a source other than `manual`, an
 * invalid time, no rules, a missing or repeated ID, empty forms, `{n}` not once in every form and the
 * registered name (or nowhere), a bad number range, an unknown record kind, a basis quote that is missing or
 * not found in the document's text, and a written form two rules send to different names. Warnings, only for
 * a table without errors: a registered name that matches no record or several, a rule whose written forms do
 * not occur in the document, and a record registered under a written form (the same unit as its registered
 * record, for an identity review).
 */
export function validatePlaceAliases(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  table: unknown,
): PlaceAliasValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const t = (table ?? {}) as Partial<PlaceAliasTable>;
  if (t.version !== PLACE_ALIASES_VERSION)
    errors.push('Unsupported place alias version');
  if (t.inputSha256 !== plan.inputSha256)
    errors.push('Place aliases belong to a different input');
  if (t.source !== 'manual') errors.push('Unknown place alias source');
  if (
    typeof t.confirmedAt !== 'string' ||
    Number.isNaN(Date.parse(t.confirmedAt))
  )
    errors.push('Invalid confirmation time');
  if (!Array.isArray(t.rules) || !t.rules.length) {
    errors.push('Place aliases have no rule');
    return { errors, warnings };
  }

  const texts = plan.units.flatMap((u) => [
    ...u.sources.map((s) => norm(s.resource.data.text)),
    ...u.readOnlyContext.map((c) => norm(c.text)),
  ]);
  const ids = new Set<string>();
  const sentTo = new Map<string, { rule: string; registered: string }>();
  t.rules.forEach((raw, index) => {
    const rule = (raw ?? {}) as Partial<PlaceAliasRule>;
    const label = `Rule ${rule.id || index + 1}`;
    if (typeof rule.id !== 'string' || !rule.id)
      errors.push(`${label}: missing id`);
    else if (ids.has(rule.id)) errors.push(`${label}: repeated id`);
    else ids.add(rule.id);
    const written = Array.isArray(rule.written) ? rule.written : [];
    const registered =
      typeof rule.registered === 'string' ? rule.registered : '';
    if (
      !written.length ||
      written.some((w) => typeof w !== 'string' || !norm(w))
    )
      errors.push(`${label}: written forms must be non-empty text`);
    if (!norm(registered)) errors.push(`${label}: missing registered name`);
    const forms = [...written.filter((w) => typeof w === 'string'), registered];
    if (forms.some((f) => /[{}]/.test(f.replaceAll('{n}', ''))))
      errors.push(`${label}: only the {n} placeholder is allowed`);
    const counts = forms.map((f) => f.split('{n}').length - 1);
    const numbered = counts.every((c) => c === 1);
    if (!numbered && !counts.every((c) => c === 0))
      errors.push(
        `${label}: {n} must appear once in every written form and the registered name, or nowhere`,
      );
    if (rule.numbers !== undefined) {
      // Object() turns a null range into an empty one, which fails the checks below
      const { from, to } = Object(rule.numbers) as Partial<
        NonNullable<PlaceAliasRule['numbers']>
      >;
      if (!numbered) errors.push(`${label}: numbers need the {n} placeholder`);
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from! < 0 ||
        from! > to!
      )
        errors.push(`${label}: invalid number range`);
    }
    if (rule.recordKind !== undefined && !KINDS.includes(rule.recordKind))
      errors.push(`${label}: unknown record kind ${rule.recordKind}`);
    const quote = rule.basis?.quote;
    if (typeof quote !== 'string' || !norm(quote))
      errors.push(`${label}: missing basis quote`);
    else if (!texts.some((x) => x.includes(norm(quote))))
      errors.push(`${label}: basis quote not found in the document`);
    for (const w of written.filter((x) => typeof x === 'string' && norm(x))) {
      const previous = sentTo.get(norm(w));
      if (previous && previous.registered !== norm(registered))
        errors.push(
          `${label}: written form ${w} is sent elsewhere by ${previous.rule}`,
        );
      else sentTo.set(norm(w), { rule: label, registered: norm(registered) });
    }
  });
  if (errors.length) return { errors, warnings };

  const { named } = createRecordNamer(plan);
  const kindOf = new Map(ledger.records.map((r) => [r.id, r.recordKind]));
  for (const rule of t.rules) {
    const label = `Rule ${rule.id}`;
    const ofKind = (name: string) =>
      named(name).filter(
        (id) => !rule.recordKind || kindOf.get(id) === rule.recordKind,
      );
    const numbers = rule.numbers
      ? Array.from(
          { length: rule.numbers.to - rule.numbers.from + 1 },
          (_, i) => String(rule.numbers!.from + i),
        )
      : [];
    const names = rule.registered.includes('{n}')
      ? numbers.map((n) => rule.registered.replace('{n}', n))
      : [rule.registered];
    for (const name of names) {
      const found = ofKind(name).length;
      if (found !== 1)
        warnings.push(
          `${label}: ${name} matches ${found ? `${found} records` : 'no record'}`,
        );
    }
    const loose = rule.written.map((w) => patternOf(w, 'anywhere'));
    if (!texts.some((x) => loose.some((p) => p.test(x))))
      warnings.push(`${label}: no written form occurs in the document`);
    const exact = rule.written.map((w) => patternOf(w, 'whole'));
    for (const r of ledger.records) {
      const name = `${r.sourceIdentifier ?? ''}${r.sourceName}`;
      if (exact.some((p) => p.test(norm(name))))
        warnings.push(
          `${label}: record ${r.id} (${r.sourceName}) is registered under a written form`,
        );
    }
  }
  return { errors, warnings };
}

/** The rule that mapped a written place, and the records its registered name matched. */
export interface PlaceAliasMatch {
  ruleId: string;
  /** The written place as it matched, without spaces. */
  written: string;
  /** The registered name the rule produced. */
  registered: string;
  /** The rule's basis quote. */
  quote: string;
  /** Records of the rule's kind with the registered name; one means the place is resolved. */
  recordIds: string[];
}
/** A record registered under a written form: the same unit as its registered record, for an identity review. */
export interface PlaceAliasDuplicate {
  recordId: string;
  ruleId: string;
  written: string;
  registered: string;
  /** The registered record, when exactly one has the registered name. */
  registeredRecordId?: string;
}
/** What the ledger header records about an applied table. */
export interface PlaceAliasSummary {
  ruleIds: string[];
  source: 'manual';
  confirmedAt: string;
  inputSha256: string;
  sha256?: string;
}

/**
 * Prepare a validated table for use: `resolve` maps a place that ends in a written form (number in range) to
 * the records its registered name matches, excluding the asking record; `duplicates` lists records registered
 * under a written form. Throws `PlaceAliasValidationError` when the table has errors.
 */
export function createPlaceAliasResolver(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  table: PlaceAliasTable,
  options: { sha256?: string } = {},
) {
  const { errors } = validatePlaceAliases(plan, ledger, table);
  if (errors.length) throw new PlaceAliasValidationError(errors);
  const { named } = createRecordNamer(plan);
  const kindOf = new Map(ledger.records.map((r) => [r.id, r.recordKind]));
  const apply = (
    text: string,
    mode: 'whole' | 'end',
  ): (Omit<PlaceAliasMatch, 'recordIds'> & { all: string[] }) | null => {
    for (const rule of table.rules)
      for (const w of rule.written) {
        // trailing punctuation (`발굴 1구역.`) does not belong to the place
        const m = norm(text)
          .replace(/[.,;:·]+$/, '')
          .match(patternOf(w, mode));
        if (!m) continue;
        const n = m[1];
        if (
          n !== undefined &&
          rule.numbers &&
          (Number(n) < rule.numbers.from || Number(n) > rule.numbers.to)
        )
          continue;
        const registered =
          n === undefined ? rule.registered : rule.registered.replace('{n}', n);
        return {
          ruleId: rule.id,
          written: m[0],
          registered,
          quote: rule.basis.quote,
          all: named(registered).filter(
            (id) => !rule.recordKind || kindOf.get(id) === rule.recordKind,
          ),
        };
      }
    return null;
  };
  const duplicates: PlaceAliasDuplicate[] = ledger.records.flatMap((r) => {
    const found = apply(`${r.sourceIdentifier ?? ''}${r.sourceName}`, 'whole');
    if (!found) return [];
    const others = found.all.filter((id) => id !== r.id);
    return [
      {
        recordId: r.id,
        ruleId: found.ruleId,
        written: found.written,
        registered: found.registered,
        ...(others.length === 1 ? { registeredRecordId: others[0] } : {}),
      },
    ];
  });
  const shortForm = new Set(duplicates.map((d) => d.recordId));
  const summary: PlaceAliasSummary = {
    ruleIds: table.rules.map((r) => r.id),
    source: table.source,
    confirmedAt: table.confirmedAt,
    inputSha256: table.inputSha256,
    ...(options.sha256 ? { sha256: options.sha256 } : {}),
  };
  return {
    summary,
    duplicates,
    /** A record registered under a written form gets no parent from the rules; it is the same unit. */
    resolve(place: string, recordId: string): PlaceAliasMatch | null {
      if (shortForm.has(recordId)) return null;
      const found = apply(place, 'end');
      if (!found) return null;
      const { all, ...match } = found;
      return { ...match, recordIds: all.filter((id) => id !== recordId) };
    },
  };
}

/** SHA-256 of a place alias table with sorted keys, for the ledger header. */
export function placeAliasesSha256(table: PlaceAliasTable): Promise<string> {
  return canonicalSha256(table);
}
