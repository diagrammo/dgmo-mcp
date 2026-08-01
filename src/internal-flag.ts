// ============================================================
// The `internal` chart-type flag — read defensively.
// ============================================================
//
// dgmo added `ChartTypeMeta.internal` with the live-link chart type: a type
// that ROUTES but is never OFFERED, because nobody hand-authors one. This
// server must honour it in `list_chart_types` and in the suggester's candidate
// pool, or the assistant will propose a pointer to someone who asked for a
// diagram.
//
// 🔴 Read through a LOCAL view of the shape rather than dgmo's exported type.
// This server resolves the INSTALLED @diagrammo/dgmo, so between the two
// repos' releases the installed `ChartTypeMeta` may not declare the field yet
// — and a hard reference would fail `tsc` for a change made elsewhere. The
// same trick `suggest/scoring.ts` already uses for `RegistryType`.

/** The narrow view of a chart type this file needs. */
export interface FlaggedChartType {
  readonly id: string;
  readonly internal?: boolean;
}

/** Ids of every chart type that routes but is never offered. */
export function internalChartTypeIds(
  types: readonly { readonly id: string }[]
): Set<string> {
  return new Set(
    (types as readonly FlaggedChartType[])
      .filter((t) => t.internal)
      .map((t) => t.id)
  );
}
