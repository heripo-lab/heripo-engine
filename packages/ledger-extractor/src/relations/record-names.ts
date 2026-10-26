import type { ContentAttachmentPlan } from '../content-attachment/types';

export const norm = (text: string) => text.replace(/\s+/g, '');
/**
 * A looser form for names the exact form misses: no `호` after a number, so a place written `98호 수혈` meets
 * a record registered with identifier `98` and name `수혈`. It is tried only when the exact form matches
 * nothing, so `96호 수혈` keeps meeting a record registered as `96호 수혈` beside one registered as `96 수혈`.
 */
export const looseKey = (text: string) => norm(text).replace(/(\d)호/g, '$1');
/** Name forms, exact first. */
export const FORMS = [norm, looseKey];
export type NameForm = (typeof FORMS)[number];
export type AliasIndex = Map<string, string[]>;
/** Names a record is written as: identifier with name in either order, or the bare name of an unnumbered record. */
export function aliasesOf(
  entry: ContentAttachmentPlan['registry'][number],
  form: NameForm,
) {
  const names = new Set<string>();
  for (const m of entry.mentions) {
    const name = form(m.sourceName);
    const id = form(m.sourceIdentifier ?? '');
    if (!id) names.add(name);
    else if (name.includes(id)) names.add(name);
    else {
      names.add(id + name);
      names.add(name + id);
    }
  }
  return [...names].filter((n) => n.length >= 2);
}

/**
 * Name lookup over the plan's registry: alias indexes by name form, and the records a text names exactly in
 * the first form that names any (exact, then without `호` after a number). Record IDs are `record-<groupId>`.
 */
export function createRecordNamer(plan: ContentAttachmentPlan) {
  const indexes = FORMS.map((form): [NameForm, AliasIndex] => {
    const index: AliasIndex = new Map();
    for (const entry of plan.registry)
      for (const alias of aliasesOf(entry, form))
        index.set(alias, [
          ...(index.get(alias) ?? []),
          `record-${entry.groupId}`,
        ]);
    return [form, index];
  });
  const named = (text: string) => {
    for (const [form, index] of indexes) {
      const ids = index.get(form(text));
      if (ids) return ids;
    }
    return [];
  };
  return { indexes, named };
}

/**
 * Narrow records sharing a written name to those nearest the speaking record: the ones whose chapter path
 * shares the longest prefix with it (over every mention of either). Reports that restart numbering per period
 * register `29호 수혈` and `29 수혈` in different chapters; a sentence under the later period means its own.
 * A tie keeps every tied record, so the caller leaves the name undecided.
 */
export function createNearestRecords(plan: ContentAttachmentPlan) {
  const paths = new Map(
    plan.registry.map((e) => [
      `record-${e.groupId}`,
      e.mentions.map((m) => m.chapterPath.map((c) => c.id)),
    ]),
  );
  const shared = (a: string[], b: string[]) => {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  };
  const proximity = (a: string, b: string) =>
    Math.max(
      ...paths.get(a)!.flatMap((x) => paths.get(b)!.map((y) => shared(x, y))),
    );
  return (ids: string[], near: string) => {
    if (ids.length < 2) return ids;
    const scores = ids.map((id) => proximity(near, id));
    const best = Math.max(...scores);
    return ids.filter((_, i) => scores[i] === best);
  };
}
