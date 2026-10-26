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
  /**
   * `proposed`: the scope is a router proposal that a person or caller has not decided; candidate discovery
   * should not start from it. Absent: the scope was decided (manual profile or injected scope).
   */
  scopeStatus?: 'proposed';
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
  if (profile.scopeStatus !== undefined && profile.scopeStatus !== 'proposed')
    issues.push('Unknown scope status');
  if (!['router', 'manual'].includes(profile.source))
    issues.push('Unknown profile source');
  if (Number.isNaN(Date.parse(profile.confirmedAt)))
    issues.push('Profile confirmation time is invalid');
  return issues;
}

/** Traits that currently drive a thin attachment branch; other traits do not change any rule yet. */
export const CONTENT_ATTACHMENT_THIN_POLICY_TRAITS: readonly ReportTraitId[] = [
  'local_stratigraphy',
  'catalog_artifacts',
];

/** Thin attachment branches a caller can decide directly; `none` and `review` turn a branch off. */
export interface ContentAttachmentThinPolicyOverrides {
  layers?: 'all' | 'local';
  continuity?: 'linked' | 'none';
  areas?: 'unanimous' | 'review';
  catalog?: 'fields' | 'none';
}
export type ContentAttachmentThinBranch =
  keyof ContentAttachmentThinPolicyOverrides;
/**
 * How one branch of the thin policy was decided. `policy_override` and `trait_override` are caller decisions;
 * `trait` follows a yes/no profile trait; `profile` applies to every confirmed profile; `default` is the rule
 * used without a decisive trait. `needsDecision` marks a branch that a profile left to the default because its
 * trait is unclear or missing, so an outside reviewer can decide it.
 */
export interface ContentAttachmentThinPolicyDecision {
  branch: ContentAttachmentThinBranch;
  value: string;
  source:
    'policy_override' | 'trait_override' | 'trait' | 'profile' | 'default';
  trait?: ReportTraitId;
  traitValue?: ReportTraitValue;
  needsDecision: boolean;
}

const BRANCH_VALUES: Record<ContentAttachmentThinBranch, string[]> = {
  layers: ['all', 'local'],
  continuity: ['linked', 'none'],
  areas: ['unanimous', 'review'],
  catalog: ['fields', 'none'],
};

/**
 * Resolve the thin attachment rules in priority order: a branch decided directly (`policyOverrides`), then a
 * trait decided by the caller (`traitOverrides`), then the profile's trait, then the default. Without a profile
 * and without overrides the rules stay as before. Report-wide layers stay offered everywhere under `local`, so
 * an unclear stratigraphy judgment uses `local`; page-boundary linking and unanimous areas follow any confirmed
 * profile; the catalog-entry rule needs a confirmed catalog of artifacts. Every branch is recorded with its source.
 */
export function resolveContentAttachmentThinPolicy(
  profile?: ReportProfile,
  options: {
    traitOverrides?: Partial<Record<ReportTraitId, ReportTraitValue>>;
    policyOverrides?: ContentAttachmentThinPolicyOverrides;
  } = {},
): {
  policy: ContentAttachmentThinPolicy;
  decisions: ContentAttachmentThinPolicyDecision[];
} {
  const traitOverrides = options.traitOverrides ?? {};
  const policyOverrides = options.policyOverrides ?? {};
  for (const [id, value] of Object.entries(traitOverrides))
    if (
      !(REPORT_TRAIT_IDS as readonly string[]).includes(id) ||
      !TRAIT_VALUES.has(value)
    )
      throw new Error(`Invalid trait override ${id}`);
  for (const [branch, value] of Object.entries(policyOverrides))
    if (!BRANCH_VALUES[branch as ContentAttachmentThinBranch]?.includes(value))
      throw new Error(`Invalid policy override ${branch}`);
  const traitOf = (id: ReportTraitId) => {
    if (traitOverrides[id])
      return { value: traitOverrides[id], overridden: true };
    return { value: profile?.traits[id] ?? 'unclear', overridden: false };
  };
  const decide = (
    branch: ContentAttachmentThinBranch,
    fromProfile: () => Omit<ContentAttachmentThinPolicyDecision, 'branch'>,
  ): ContentAttachmentThinPolicyDecision =>
    policyOverrides[branch]
      ? {
          branch,
          value: policyOverrides[branch],
          source: 'policy_override',
          needsDecision: false,
        }
      : { branch, ...fromProfile() };
  const byTrait = (
    id: ReportTraitId,
    yes: string,
    no: string,
    unclear: string,
  ): Omit<ContentAttachmentThinPolicyDecision, 'branch'> => {
    const t = traitOf(id);
    const decisive = t.value !== 'unclear';
    if (!profile && !t.overridden)
      return { value: no, source: 'default', needsDecision: false };
    return {
      value: t.value === 'yes' ? yes : t.value === 'no' ? no : unclear,
      source: t.overridden ? 'trait_override' : decisive ? 'trait' : 'default',
      trait: id,
      traitValue: t.value,
      needsDecision: !decisive,
    };
  };
  const byProfile = (on: string, off: string) => ({
    value: profile ? on : off,
    source: profile ? ('profile' as const) : ('default' as const),
    needsDecision: false,
  });
  const decisions = [
    decide('layers', () =>
      byTrait('local_stratigraphy', 'local', 'all', 'local'),
    ),
    decide('continuity', () => byProfile('linked', 'none')),
    decide('areas', () => byProfile('unanimous', 'review')),
    decide('catalog', () =>
      byTrait('catalog_artifacts', 'fields', 'none', 'none'),
    ),
  ];
  const value = (branch: ContentAttachmentThinBranch) =>
    decisions.find((d) => d.branch === branch)!.value;
  return {
    policy: {
      layers: value('layers') as ContentAttachmentThinPolicy['layers'],
      ...(value('continuity') === 'linked'
        ? { continuity: 'linked' as const }
        : {}),
      ...(value('areas') === 'unanimous'
        ? { areas: 'unanimous' as const }
        : {}),
      ...(value('catalog') === 'fields' ? { catalog: 'fields' as const } : {}),
    },
    decisions,
  };
}

/** The thin attachment rules of a profile without caller overrides (see `resolveContentAttachmentThinPolicy`). */
export function contentAttachmentThinPolicyFromProfile(
  profile?: ReportProfile,
): ContentAttachmentThinPolicy {
  return resolveContentAttachmentThinPolicy(profile).policy;
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

/** SHA-256 of a JSON value with sorted keys, so the same content hashes the same regardless of key order. */
export async function canonicalSha256(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** SHA-256 of a profile with sorted keys, so the same judgments hash the same regardless of key order. */
export async function reportProfileSha256(
  profile: ReportProfile,
): Promise<string> {
  return canonicalSha256(profile);
}
