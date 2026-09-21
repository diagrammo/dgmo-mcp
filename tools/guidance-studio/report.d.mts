// Types for report.mjs. Hand-written because the studio's node-side scripts
// are plain .mjs (dump-registry, build-gallery) while `tsc --noEmit` covers
// `tests/` — so a test that imports one needs a declaration or it is an
// implicit `any`, which `strict` refuses.

export interface TrialSummary {
  idx: number;
  prompt: string;
  ts: number | null;
  rendered: boolean;
  error: string | null;
  diagnostics: string[];
  dgmo: string;
}

export interface TypeSummary {
  type: string;
  trials: TrialSummary[];
  rendered: number;
  failed: number;
  withDiagnostics: number;
}

export interface RunSummary {
  types: TypeSummary[];
  /** How many chart types the studio offers, for the coverage line. */
  knownTypeCount: number;
  /** Offered types the session never exercised, sorted. */
  uncovered: string[];
  totals: {
    types: number;
    trials: number;
    rendered: number;
    failed: number;
    withDiagnostics: number;
  };
}

export function summariseTrials(
  trials: Record<string, Record<string, unknown>>,
  knownTypes?: string[]
): RunSummary;

export function renderMarkdown(
  summary: RunSummary,
  generatedAt: string
): string;
