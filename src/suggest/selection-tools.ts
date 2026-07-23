/**
 * selection-tools — the package's public surface for external selection-tuning
 * tools (the console AI Board). Bundles the pure diff/ripple helpers that
 * otherwise live under tools/ (unshipped) plus the acceptance rule, so
 * consumers can import them from `@diagrammo/dgmo-mcp/selection` without
 * reaching into source paths the exports map blocks.
 */
export {
  diffRun,
  passingPrompts,
  activeCases,
  type SuggesterState,
  type Corpus,
  type CorpusCase,
  type DiffResult,
} from '../../tools/selection-harness/diff-run.js';
export { accepts } from './synonyms.js';
