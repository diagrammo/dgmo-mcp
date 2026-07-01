// Trigger vocabulary keyed by chart-type id — the natural-language phrases the
// suggester matches. Lives here (dgmo-mcp), NOT in the dgmo render library:
// chart-type SELECTION is AI-authoring functionality only this server needs.
//
// The DATA lives in `triggers.json` (one entry per chart-type id) so the eval
// harness's curation UI can read/edit it as plain data. Each entry has:
//   • phrases  — literal contiguous phrases the scorer matches (the vocabulary).
//                GENERATED: projected from the canonical model's shared keyword
//                field (dgmo-content/registry.json) by scripts/project-triggers.mjs
//                — see docs/registry-entity-model.md. Curate phrases in the
//                console Workspace, not here; `pnpm check:triggers` guards drift.
//   • concepts — plain-language authoring hints ("trigonometry", "venues") that
//                an LLM-in-the-loop expander turns INTO phrases; the scorer
//                itself never reads concepts (they only produce phrases).
//   • prior    — optional popularity bias (0–10): how typically a user means
//                this type when the prompt is ambiguous. Absent = 0 = no bias.
//   concepts + prior are MCP-owned TUNING and stay authored here.
//
// Keyed by id; validated against @diagrammo/dgmo chartTypes by suggest.test.ts.
import data from './triggers.json';

export interface TriggerEntry {
  readonly phrases: readonly string[];
  readonly concepts: readonly string[];
  /** Popularity prior (0–10): how typically a user means THIS type when a prompt
   *  is ambiguous. Optional; absent = 0 = no bias. See PRIOR_SCALE in scoring. */
  readonly prior?: number;
}

/** Full per-type authoring data (phrases + concept hints + optional prior). */
export const TRIGGER_DATA = data as Record<string, TriggerEntry>;

/** The phrase vocabulary the scorer consumes — `{ id: [phrases] }`. */
export const TRIGGERS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(TRIGGER_DATA).map(([id, entry]) => [id, entry.phrases])
);

/** The popularity priors the scorer consumes — `{ id: prior }` (only non-zero). */
export const PRIORS: Record<string, number> = Object.fromEntries(
  Object.entries(TRIGGER_DATA)
    .map(([id, entry]) => [id, entry.prior ?? 0] as const)
    .filter(([, p]) => p > 0)
);
