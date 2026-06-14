// Trigger vocabulary keyed by chart-type id — the natural-language phrases the
// suggester matches. Lives here (dgmo-mcp), NOT in the dgmo render library:
// chart-type SELECTION is AI-authoring functionality only this server needs.
//
// The DATA lives in `triggers.json` (one entry per chart-type id) so the eval
// harness's curation UI can read/edit it as plain data. Each entry has:
//   • phrases  — literal contiguous phrases the scorer matches (the vocabulary)
//   • concepts — plain-language authoring hints ("trigonometry", "venues") that
//                an LLM-in-the-loop expander turns INTO phrases; the scorer
//                itself never reads concepts (they only produce phrases).
//
// Keyed by id; validated against @diagrammo/dgmo chartTypes by suggest.test.ts.
import data from './triggers.json';

export interface TriggerEntry {
  readonly phrases: readonly string[];
  readonly concepts: readonly string[];
}

/** Full per-type authoring data (phrases + concept hints). */
export const TRIGGER_DATA = data as Record<string, TriggerEntry>;

/** The phrase vocabulary the scorer consumes — `{ id: [phrases] }`. */
export const TRIGGERS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(TRIGGER_DATA).map(([id, entry]) => [id, entry.phrases])
);
