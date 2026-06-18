// Selection synonym groups — near-identical chart types we deliberately DON'T
// distinguish in chart-type selection (pie vs doughnut, arc vs chord). Each group
// lists interchangeable types, CANONICAL FIRST. We stay opinionated: a popularity
// prior (see triggers.json) makes the canonical win ambiguous prompts, while an
// explicit phrase ("doughnut chart") still wins via its contiguous match. These
// groups make the regression gate + advisory primary-hit-rate treat any sibling
// of an accepted type as equivalent, so within-group differences never count as a
// miss — killing the noise. Membership here is a product decision, not a claim
// the renderers are identical.
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['pie', 'doughnut'], // same part-to-whole chart, hole or no hole; pie canonical
  ['arc', 'chord'], // connection / relationship arcs; arc is canonical
];

const groupOf = (id: string): readonly string[] | undefined =>
  SYNONYM_GROUPS.find((g) => g.includes(id));

/** True if `a` and `b` are the same type or interchangeable synonyms. */
export function sameSelectionGroup(a: string, b: string): boolean {
  if (a === b) return true;
  const g = groupOf(a);
  return !!g && g.includes(b);
}

/** The canonical (opinionated default) type for an id — itself if ungrouped. */
export function canonicalOf(id: string): string {
  return groupOf(id)?.[0] ?? id;
}

/** A pick satisfies a case if it's an accepted id OR a synonym of one. Use this
 *  everywhere a top-1 is checked against `accept[]` (gate, harness, net-delta) so
 *  the synonym policy is enforced in exactly one place. */
export function accepts(
  accept: readonly string[],
  pick: string | undefined
): boolean {
  return !!pick && accept.some((a) => sameSelectionGroup(a, pick));
}
