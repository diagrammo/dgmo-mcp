// ============================================================
// flowchart-structure.ts — structural-validity gate for flowcharts.
//
// dgmo's parser already emits *warnings* for degree-0 orphan nodes, but the
// MCP server must REFUSE structurally-invalid flowcharts so the authoring LLM
// is forced to regenerate (same philosophy as the named-palette color gate in
// render-helpers.ts). Two rules are enforced as hard errors:
//
//   1. Every decision node (`<Question?>`) must have at least two outgoing
//      branches — a one-way decision is meaningless.
//   2. Every node must lie on a path from a start (a node with no incoming
//      edges) to an end (a node with no outgoing edges). Anything that can't
//      be traced start→…→node→…→end is an orphan and must not appear.
//
// This complements — does not replace — the guidance tips: guidance shapes the
// LLM, this gate guarantees the output.
// ============================================================

import {
  parseFlowchart,
  type DgmoError,
} from '@diagrammo/dgmo/advanced';

export const FLOWCHART_STRUCTURE_CODE = 'E_FLOWCHART_STRUCTURE';

function err(line: number, message: string): DgmoError {
  return { line, message, severity: 'error', code: FLOWCHART_STRUCTURE_CODE };
}

/**
 * Returns hard-error diagnostics for a flowchart that violates the structural
 * rules above. Empty array = structurally valid (or not enough graph to judge).
 * Callers merge these into the blocking set alongside parse errors.
 */
export function validateFlowchartStructure(dgmo: string): DgmoError[] {
  let parsed: ReturnType<typeof parseFlowchart>;
  try {
    parsed = parseFlowchart(dgmo);
  } catch {
    return []; // let the normal parse-error path report a broken parse
  }

  const nodes = parsed.nodes ?? [];
  const edges = parsed.edges ?? [];

  // No edges = nothing to check structurally (single labels, parse failure).
  // Let the standard diagnostics handle those cases.
  if (nodes.length === 0 || edges.length === 0) return [];

  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const n of nodes) {
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const e of edges) {
    out.get(e.source)?.push(e.target);
    inc.get(e.target)?.push(e.source);
  }

  const issues: DgmoError[] = [];

  // --- Rule 1: every decision needs >= 2 outgoing branches ---
  for (const n of nodes) {
    if (n.shape !== 'decision') continue;
    const branches = out.get(n.id)?.length ?? 0;
    if (branches < 2) {
      issues.push(
        err(
          n.lineNumber,
          `Decision "${n.label}" has ${branches === 0 ? 'no' : 'only one'} outgoing branch — a decision needs at least two (e.g. -yes-> / -no->, or specific labels like -retirement-> / -survivor->).`
        )
      );
    }
  }

  // --- Rule 2: every node lies on a start -> end path ---
  // A "start" is any node with no incoming edges but at least one outgoing one;
  // an "end" is any node with no outgoing edges but at least one incoming one.
  // (Topology, not shape — flowcharts that don't use the `()` terminal shape
  // still parse and must not be rejected.)
  const starts = nodes.filter(
    (n) => (inc.get(n.id)?.length ?? 0) === 0 && (out.get(n.id)?.length ?? 0) > 0
  );
  const ends = nodes.filter(
    (n) => (out.get(n.id)?.length ?? 0) === 0 && (inc.get(n.id)?.length ?? 0) > 0
  );

  if (starts.length === 0) {
    issues.push(
      err(
        0,
        'Flowchart has no entry point — every node has an incoming arrow, so the flow loops with no start. Add a start node that nothing points to.'
      )
    );
  }
  if (ends.length === 0) {
    issues.push(
      err(
        0,
        'Flowchart has no end — every node has an outgoing arrow, so the flow never stops. Add a terminal node where the flow ends.'
      )
    );
  }

  // Per-node reachability only makes sense once a start AND an end exist;
  // otherwise the two global errors above already explain the problem.
  if (starts.length > 0 && ends.length > 0) {
    const forward = bfs(
      starts.map((n) => n.id),
      out
    );
    const backward = bfs(
      ends.map((n) => n.id),
      inc
    );
    for (const n of nodes) {
      if (!forward.has(n.id) || !backward.has(n.id)) {
        issues.push(
          err(
            n.lineNumber,
            `Node "${n.label}" is not connected to the flow — it must lie on a path from the start to an end. Wire it into the diagram or remove it.`
          )
        );
      }
    }
  }

  return issues;
}

function bfs(seeds: string[], adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
