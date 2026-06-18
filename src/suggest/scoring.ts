// ============================================================
// Chart-type SELECTION engine (moved out of the dgmo render library).
// ============================================================
//
// "Given a plain-English prompt, which chart type?" is AI-authoring
// functionality — only this MCP server (and the eval harness) needs it, so it
// lives here, NOT in @diagrammo/dgmo, which every renderer (Obsidian, Astro,
// the desktop/online apps) bundles and would otherwise ship NLP trigger vocab
// it never invokes. The dgmo library still owns the chart-type REGISTRY
// (ids / descriptions / fallback flag — used by its parser, router, CLI); we
// import that and pair it with the local TRIGGERS vocabulary.
//
// Algorithm: a hybrid of two signals so we get both precision and recall:
//   PRIMARY (precise)   contiguous trigger-phrase matches, weighted by token
//                       count and multiplied by CONTIGUITY_DOMINANCE so a real
//                       phrase always wins (keeps trigger-word prompts at #1).
//   SECONDARY (recall)  IDF-weighted token-subset overlap (stopword-stripped,
//                       plural-stemmed, non-contiguous) — rescues natural-
//                       language paraphrases that miss every exact phrase.
//   TIEBREAK            description-word overlap at 0.25x.
//
// The scorer is built by `createSuggester(triggers)` so a caller (the eval
// harness's curation UI) can score a *live-edited* vocabulary without a
// rebuild. The module-level exports (`suggestChartTypes`, `scoreChartType`) are
// the instances bound to the committed `TRIGGERS`.

import { chartTypes } from '@diagrammo/dgmo/advanced';
import { TRIGGERS, PRIORS } from './triggers.js';

/** The registry shape we depend on (dgmo owns this; triggers are local). */
interface RegistryType {
  readonly id: string;
  readonly description: string;
  readonly fallback?: boolean;
}
const REGISTRY: readonly RegistryType[] = chartTypes as readonly RegistryType[];

/** The trigger vocabulary shape a suggester scores against. */
export type TriggerMap = Record<string, readonly string[]>;

/** Per-type popularity prior: "when a prompt is ambiguous, how typically does a
 *  user mean THIS chart?" 0 = no bias (default). A small integer (0–PRIOR_MAX). */
export type PriorMap = Record<string, number>;

const TYPOGRAPHIC_REPLACEMENTS: [RegExp, string][] = [
  [/[‘’]/g, "'"], // curly single quotes
  [/[“”]/g, '"'], // curly double quotes
  [/[–—]/g, '-'], // en/em dash
  [/×/g, 'x'], // unicode multiplication → ASCII (for "2×2" vs "2x2")
];

/** Normalize a string to lowercase ASCII-ish tokens for matching. */
export function normalize(s: string): string[] {
  let out = s.normalize('NFKD').toLowerCase();
  for (const [re, repl] of TYPOGRAPHIC_REPLACEMENTS)
    out = out.replace(re, repl);
  return out.split(/[^a-z0-9]+/).filter(Boolean);
}

/** True if `triggerTokens` appears as a contiguous slice of `promptTokens`. */
export function matchesContiguously(
  promptTokens: readonly string[],
  triggerTokens: readonly string[]
): boolean {
  if (triggerTokens.length === 0 || triggerTokens.length > promptTokens.length)
    return false;
  outer: for (let i = 0; i <= promptTokens.length - triggerTokens.length; i++) {
    for (let j = 0; j < triggerTokens.length; j++) {
      if (promptTokens[i + j] !== triggerTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** The three already-computed score components, surfaced so a UI can explain
 *  *why* a type scored: contiguous-phrase, IDF token-overlap, description. */
export interface ScoreBreakdown {
  readonly contig: number;
  readonly idf: number;
  readonly desc: number;
  /** Popularity-prior contribution (0 unless the type has a prior AND match
   *  signal). `score = contig + idf + desc + prior`; match = score - prior. */
  readonly prior: number;
}

export interface ChartTypeScore {
  readonly type: RegistryType;
  readonly score: number;
  readonly matched: string[];
  readonly breakdown?: ScoreBreakdown;
}

// Generic English function words + generic chart vocabulary, stripped before
// token-overlap matching ("chart"/"diagram" match nothing — every type is one).
const STOPWORDS = new Set([
  'of',
  'the',
  'a',
  'an',
  'our',
  'their',
  'your',
  'my',
  'with',
  'and',
  'to',
  'for',
  'in',
  'on',
  'by',
  'from',
  'how',
  'what',
  'show',
  'me',
  'us',
  'we',
  'i',
  'is',
  'are',
  'do',
  'does',
  'each',
  'between',
  'across',
  'over',
  'per',
  'that',
  'this',
  'they',
  'them',
  'take',
  'through',
  'works',
  'work',
  'about',
  'into',
  'as',
  'it',
  'its',
  'chart',
  'diagram',
  'graph',
  'plot',
  'view',
  'display',
  'visualize',
  'yesterday',
  'using',
  'need',
  'want',
  'use',
  'create',
  'make',
  'give',
  'help',
]);

/** Conservative plural stemmer (plurals only — NOT -ing/-ed). */
function stemPlural(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  // "-es" plural ONLY after a sibilant (boxes→box, watches→watch, dishes→dish,
  // buzzes→buzz, classes→class). For everything else ending in "es" the 'e' is
  // part of the stem (moves, states, names, files, phases, cases) → fall through
  // to the plain "-s" rule below so they stem to move/state/name/… not mov/stat.
  if (t.length > 4 && /(x|z|ch|sh|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss'))
    return t.slice(0, -1);
  return t;
}

/** Tokens for overlap matching: normalized, plural-stemmed, stopword-stripped. */
function matchTokens(s: string): string[] {
  return normalize(s)
    .map(stemPlural)
    .filter((t) => !STOPWORDS.has(t));
}

/** Contiguous matches outrank loose token overlap (larger than any realistic
 *  overlap sum), so a real trigger phrase always wins. */
export const CONTIGUITY_DOMINANCE = 100;

/** Popularity-prior calibration. A type's prior contributes `prior * PRIOR_SCALE`
 *  to its score, but ONLY when the type already has match signal (so a prior can
 *  never resurrect a no-match type or fake a confident suggestion). PRIOR_MAX *
 *  PRIOR_SCALE is held strictly BELOW CONTIGUITY_DOMINANCE (100), so a genuine
 *  contiguous trigger-phrase match for the "right" type always beats any prior —
 *  the prior only decides the ambiguous middle, where types separate on the
 *  single-digit idf/desc terms. Crank these to make priors stronger. */
export const PRIOR_MAX = 10;
export const PRIOR_SCALE = 9; // PRIOR_MAX * PRIOR_SCALE = 90 < 100

/** A result below this floor means no real trigger phrase fired. */
export const MIN_PRIMARY_SCORE = 1.0;
/** Min absolute score gap before a match is non-ambiguous. */
export const AMBIGUITY_THRESHOLD = 0.5;

export type Confidence = 'high' | 'medium' | 'ambiguous';

export function confidence(top: number, second: number): Confidence {
  if (top < MIN_PRIMARY_SCORE) return 'ambiguous';
  if (second === 0) return 'high';
  if (top >= second * 2) return 'high';
  if (top - second < AMBIGUITY_THRESHOLD) return 'ambiguous';
  return 'medium';
}

export interface SuggestionResult {
  readonly ranked: readonly ChartTypeScore[];
  readonly fallback: readonly RegistryType[];
  readonly confidence: Confidence;
  readonly fellBack: boolean;
}

export interface Suggester {
  scoreChartType(
    prompt: string,
    type: RegistryType
  ): { score: number; matched: string[]; breakdown: ScoreBreakdown };
  suggestChartTypes(prompt: string): SuggestionResult;
}

/**
 * Build a scorer bound to a specific trigger vocabulary. The IDF document
 * frequency is computed once from `triggers` here, so passing a live-edited map
 * scores exactly as a rebuilt engine would — no rebuild needed to preview edits.
 */
export function createSuggester(
  triggers: TriggerMap,
  priors: PriorMap = {}
): Suggester {
  const triggersFor = (id: string): readonly string[] => triggers[id] ?? [];
  /** Clamped prior contribution for a type, before the match-signal gate. */
  const priorBonus = (id: string): number =>
    Math.max(0, Math.min(priors[id] ?? 0, PRIOR_MAX)) * PRIOR_SCALE;

  // IDF: how many chart types use a token in any trigger. Distinctive tokens
  // ("sankey", "raci", "venn") weigh full; generic ones ("flow", "structure")
  // decay. Built once from this vocabulary.
  const triggerDocFreq = ((): Map<string, number> => {
    const df = new Map<string, number>();
    for (const type of REGISTRY) {
      const seen = new Set<string>();
      for (const trigger of triggersFor(type.id))
        for (const tok of matchTokens(trigger)) seen.add(tok);
      for (const tok of seen) df.set(tok, (df.get(tok) ?? 0) + 1);
    }
    return df;
  })();

  const tokenWeight = (tok: string): number => {
    const d = triggerDocFreq.get(tok) ?? 1;
    return d <= 2 ? 1 : 1 / Math.sqrt(d - 1);
  };

  function scoreChartType(
    prompt: string,
    type: RegistryType
  ): { score: number; matched: string[]; breakdown: ScoreBreakdown } {
    const promptTokensArr = normalize(prompt);
    const promptMatchTokens = new Set(matchTokens(prompt));
    const matched: string[] = [];
    const triggerList = triggersFor(type.id);

    // PRIMARY: contiguous trigger-phrase matches (precise).
    let contig = 0;
    for (const trigger of triggerList) {
      const triggerTokens = normalize(trigger);
      if (matchesContiguously(promptTokensArr, triggerTokens)) {
        matched.push(trigger);
        contig += triggerTokens.length;
      }
    }

    // SECONDARY: IDF-weighted token-subset overlap (recall).
    const triggerTokenUnion = new Set<string>();
    for (const trigger of triggerList) {
      let hit = false;
      for (const tok of matchTokens(trigger)) {
        triggerTokenUnion.add(tok);
        if (promptMatchTokens.has(tok)) hit = true;
      }
      if (hit && !matched.includes(trigger)) matched.push(trigger);
    }
    let idf = 0;
    for (const tok of promptMatchTokens)
      if (triggerTokenUnion.has(tok)) idf += tokenWeight(tok);

    // TIEBREAK: description overlap (tokens not already credited).
    const descTokens = new Set(matchTokens(type.description));
    let desc = 0;
    for (const tok of promptMatchTokens)
      if (descTokens.has(tok) && !triggerTokenUnion.has(tok)) desc += 0.25;

    const contigScore = contig * CONTIGUITY_DOMINANCE;
    const match = contigScore + idf + desc;
    // Popularity prior: applied ONLY to types that already have match signal, so
    // it tilts the ambiguous middle toward the typically-wanted type without ever
    // resurrecting a no-match type. Bounded < CONTIGUITY_DOMINANCE (see above).
    const prior = match > 0 ? priorBonus(type.id) : 0;
    return {
      score: match + prior,
      matched,
      breakdown: { contig: contigScore, idf, desc, prior },
    };
  }

  function suggestChartTypes(prompt: string): SuggestionResult {
    const scored: ChartTypeScore[] = [];
    for (const type of REGISTRY) {
      const { score, matched, breakdown } = scoreChartType(prompt, type);
      if (score > 0) scored.push({ type, score, matched, breakdown });
    }
    scored.sort((a, b) => b.score - a.score);

    const fallback = REGISTRY.filter((c) => c.fallback);
    const topScore = scored[0]?.score ?? 0;
    const secondScore = scored[1]?.score ?? 0;
    // fellBack keys off MATCH strength (prior stripped) — a popularity prior must
    // never make a no-real-match prompt look like a confident suggestion.
    const topMatch = topScore - (scored[0]?.breakdown?.prior ?? 0);
    const fellBack = topMatch < MIN_PRIMARY_SCORE;

    return {
      ranked: scored,
      fallback,
      confidence: confidence(topScore, secondScore),
      fellBack,
    };
  }

  return { scoreChartType, suggestChartTypes };
}

// Default instances bound to the committed TRIGGERS vocabulary + PRIORS.
const defaultSuggester = createSuggester(TRIGGERS, PRIORS);

export function scoreChartType(
  prompt: string,
  type: RegistryType
): { score: number; matched: string[]; breakdown: ScoreBreakdown } {
  return defaultSuggester.scoreChartType(prompt, type);
}

export function suggestChartTypes(prompt: string): SuggestionResult {
  return defaultSuggester.suggestChartTypes(prompt);
}
