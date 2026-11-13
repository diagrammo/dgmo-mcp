// Groups chart-type ids by the registry's families and, inside a family that
// has them (data, business), by purpose sub-head — the map the app's picker
// and the docs show (diagrammo/diagrammo#1970). The data is a committed
// projection of dgmo-content/registry.json: regenerate it with
// `pnpm project:families`, never edit it by hand.
import projection from './chart-families.json';

interface Subhead {
  id: string;
  label: string;
  intents: string[];
}
interface Family {
  id: string;
  label: string;
  subheads?: Subhead[];
}
interface Projection {
  families: Family[];
  types: Record<string, { family: string; intent: string | null }>;
}

const { families, types } = projection as Projection;

interface ChartTypeGroup {
  /** Sub-head label, or null for a family listed without sub-heads. */
  subhead: string | null;
  ids: string[];
}
interface ChartTypeSection {
  family: string;
  groups: ChartTypeGroup[];
}

/** Label of the section for types the registry does not place. */
export const UNGROUPED_LABEL = 'Other';

/**
 * Sort `ids` into family sections, in registry order. Within a group the ids
 * keep the order they were given in. A family or sub-head with no ids is
 * left out. An id the registry does not know, or whose first intent matches
 * no sub-head of its family, goes to a last `Other` section (family) or
 * group (sub-head), so no id given is ever dropped.
 */
export function groupChartTypes(ids: readonly string[]): ChartTypeSection[] {
  const sections: ChartTypeSection[] = [];
  const placed = new Set<string>();
  for (const family of families) {
    const inFamily = ids.filter((id) => types[id]?.family === family.id);
    if (inFamily.length === 0) continue;
    for (const id of inFamily) placed.add(id);
    if (!family.subheads) {
      sections.push({
        family: family.label,
        groups: [{ subhead: null, ids: inFamily }],
      });
      continue;
    }
    const groups: ChartTypeGroup[] = [];
    const inSubhead = new Set<string>();
    for (const s of family.subheads) {
      const sub = inFamily.filter((id) => {
        if (inSubhead.has(id)) return false; // first matching sub-head wins
        const intent = types[id]?.intent;
        return intent != null && s.intents.includes(intent);
      });
      for (const id of sub) inSubhead.add(id);
      if (sub.length > 0) groups.push({ subhead: s.label, ids: sub });
    }
    const rest = inFamily.filter((id) => !inSubhead.has(id));
    if (rest.length > 0) groups.push({ subhead: UNGROUPED_LABEL, ids: rest });
    sections.push({ family: family.label, groups });
  }
  const unplaced = ids.filter((id) => !placed.has(id));
  if (unplaced.length > 0) {
    sections.push({
      family: UNGROUPED_LABEL,
      groups: [{ subhead: null, ids: unplaced }],
    });
  }
  return sections;
}
