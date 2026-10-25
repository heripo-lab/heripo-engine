import type { DocumentResourceIndex } from '../resources/document-resource-index';

export const REPORT_PROFILE_VERSION = 'report-profile.v1' as const;

/**
 * Report traits the router judges. The list stays open: a trait proposed for a new kind of report is first
 * recorded with an `x-` prefix and becomes a listed trait once a branch uses it.
 */
export const REPORT_TRAIT_IDS = [
  'multi_chapter_scope',
  'trench_survey',
  'grid_survey',
  'few_remains',
  'reinvestigated_known_features',
  'local_stratigraphy',
  'catalog_artifacts',
  'uncaptioned_figures',
  'log_tables',
  'appendix_registry',
  'fragmented_blocks',
  'ocr_identifier_noise',
] as const;
export type ReportTraitId = (typeof REPORT_TRAIT_IDS)[number];
export type ReportTraitValue = 'yes' | 'no' | 'unclear';

/** A person-confirmed description of one report that later extraction steps read instead of guessing. */
export interface ReportProfile {
  version: typeof REPORT_PROFILE_VERSION;
  /** SHA-256 of the original ProcessedDocument file the profile was confirmed for. */
  inputSha256: string;
  /** Listed trait IDs or `x-` prefixed experimental traits; a missing trait counts as unclear. */
  traits: Record<string, ReportTraitValue>;
  /** Distinct, non-nested chapters that hold this investigation's objects. */
  scopeChapterIds: string[];
  source: 'router' | 'manual';
  routerRunId?: string;
  confirmedAt: string;
  notes?: string;
}

/** Thin attachment rules chosen from a profile and frozen into the attachment plan. */
export interface ContentAttachmentThinPolicy {
  /** `all`: every layer is offered everywhere; `local`: single-unit layers are offered only near their evidence. */
  layers: 'all' | 'local';
  /**
   * `linked`: the read-only blocks before a unit's first body block stay in its reading order across chapters
   * and list the offered candidates whose evidence they are. Absent: compilation is unchanged.
   */
  continuity?: 'linked';
  /**
   * `unanimous`: an area returned by every run is confirmed like other targets and an area returned by only
   * some runs is contested. Absent: every returned area goes to review.
   */
  areas?: 'unanimous';
  /** `fields`: requests add the rule that every line of a catalog entry describes its object (prompt v12, v14 with the collective-summary rule). */
  catalog?: 'fields';
}

const TRAIT_VALUES = new Set<string>(['yes', 'no', 'unclear']);
const EXPERIMENTAL_TRAIT = /^x-[a-z0-9_]+$/;

/**
 * Check a profile against the original input and its resource index. Returns every issue found;
 * an empty list means the profile can be used. The profile itself is never changed.
 */
export function validateReportProfile(
  index: DocumentResourceIndex,
  inputSha256: string,
  profile: ReportProfile,
): string[] {
  const issues: string[] = [];
  if (profile.version !== REPORT_PROFILE_VERSION)
    issues.push('Unsupported profile version');
  if (profile.inputSha256 !== inputSha256)
    issues.push('Profile belongs to a different input');
  for (const [id, value] of Object.entries(profile.traits ?? {})) {
    if (
      !(REPORT_TRAIT_IDS as readonly string[]).includes(id) &&
      !EXPERIMENTAL_TRAIT.test(id)
    )
      issues.push(`Unknown trait ${id}`);
    if (!TRAIT_VALUES.has(value)) issues.push(`Invalid value for trait ${id}`);
  }
  const chapters = index.resources.filter((r) => r.kind === 'chapter');
  const ids = profile.scopeChapterIds ?? [];
  const roots = chapters.filter((c) => ids.includes(c.resourceId!));
  if (!ids.length) issues.push('Profile scope has no chapter');
  for (const id of new Set(ids))
    if (!roots.some((c) => c.resourceId === id))
      issues.push(`Scope chapter ${id} not found`);
  if (new Set(ids).size !== ids.length)
    issues.push('Scope chapters are repeated');
  if (
    roots.some((a) => roots.some((b) => b.key.startsWith(`${a.key}/children/`)))
  )
    issues.push('Scope chapters are nested');
  if (!['router', 'manual'].includes(profile.source))
    issues.push('Unknown profile source');
  if (Number.isNaN(Date.parse(profile.confirmedAt)))
    issues.push('Profile confirmation time is invalid');
  return issues;
}

/**
 * Map profile traits to thin attachment rules. Report-wide layers stay offered everywhere under `local`,
 * so an unclear stratigraphy judgment also uses `local`; only a confirmed `no`, or no profile, keeps `all`.
 * A confirmed profile also links page-boundary context and confirms unanimous areas, and a confirmed catalog
 * of artifacts adds the catalog-entry rule; without a profile the rules stay as before.
 */
export function contentAttachmentThinPolicyFromProfile(
  profile?: ReportProfile,
): ContentAttachmentThinPolicy {
  if (!profile) return { layers: 'all' };
  return {
    layers: profile.traits.local_stratigraphy === 'no' ? 'all' : 'local',
    continuity: 'linked',
    areas: 'unanimous',
    ...(profile.traits.catalog_artifacts === 'yes'
      ? { catalog: 'fields' as const }
      : {}),
  };
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
      : value;

/** SHA-256 of a profile with sorted keys, so the same judgments hash the same regardless of key order. */
export async function reportProfileSha256(
  profile: ReportProfile,
): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(profile))),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
