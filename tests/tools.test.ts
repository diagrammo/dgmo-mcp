// ============================================================
// tools.test.ts — MCP tool-contract harness.
//
// Drives the REAL wired server over an in-memory transport (the same protocol
// path a client uses) and asserts each tool's contract: it exists, accepts its
// schema, and returns the right shape. This is the deterministic Layer-1 guard
// — it validates the server's PLUMBING against its declared @diagrammo/dgmo
// dep (what users actually install), so it stays tolerant of dgmo-version-
// specific behavior (exact suggest rankings / anchored slices depend on the
// not-yet-released dgmo and are covered by reference.test.ts + the workspace
// scorecard instead).
//
// Browser-opening tools (open_in_app, preview_diagram, generate_report w/
// open) are intentionally not exercised here.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chartTypes } from '@diagrammo/dgmo/internal';
import { server } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'tool-contract-test', version: '1.0.0' });

let toolNames: string[] = [];

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  toolNames = (await client.listTools()).tools.map((t) => t.name);
});

afterAll(async () => {
  await client.close();
});

/** Call a tool and return its concatenated text + isError flag. */
async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  return { text, isError: res.isError === true };
}

describe('server exposes the expected tool set', () => {
  const EXPECTED = [
    'render_diagram',
    'share_diagram',
    'open_in_app',
    'list_chart_types',
    'get_language_reference',
    'preview_diagram',
    'generate_report',
    'validate_diagram',
    'suggest_chart_type',
    'get_examples',
    'migrate_diagram',
  ];
  it('registers every expected tool (no missing / renamed)', () => {
    for (const name of EXPECTED) expect(toolNames).toContain(name);
  });
});

describe('validate_diagram', () => {
  it('passes a valid diagram', async () => {
    const { text, isError } = await call('validate_diagram', {
      dgmo: 'sequence Auth\n\nUser -hi-> API',
    });
    expect(isError).toBe(false);
    expect(text.toLowerCase()).toMatch(/valid|no error|0 error/);
  });

  it('flags a clearly invalid diagram (removed pipe metadata)', async () => {
    const { text } = await call('validate_diagram', {
      dgmo: 'infra\n\nLB\n  -> API | split: 70%',
    });
    expect(text.toLowerCase()).toMatch(/error|pipe|removed|invalid/);
  });
});

describe('list_chart_types', () => {
  it('returns the full chart-type set (parity with dgmo)', async () => {
    const { text, isError } = await call('list_chart_types', {});
    expect(isError).toBe(false);
    expect(text).toMatch(/sequence/);
    expect(text).toMatch(/flowchart/);
    // every id the bundled dgmo knows should be listed
    for (const c of chartTypes) expect(text).toContain(c.id);
  });
});

describe('suggest_chart_type', () => {
  it('returns a ranked suggestion naming a real chart type', async () => {
    const { text, isError } = await call('suggest_chart_type', {
      prompt: 'show the steps of an OAuth login between a user, app, and auth server',
    });
    expect(isError).toBe(false);
    // tolerant: assert it surfaces at least one real chart-type id (ranking
    // exactness depends on the unreleased dgmo trigger set).
    expect(chartTypes.some((c) => text.includes(c.id))).toBe(true);
  });
});

describe('get_language_reference', () => {
  it('returns the full reference when no type is given', async () => {
    const { text, isError } = await call('get_language_reference', {});
    expect(isError).toBe(false);
    expect(text.length).toBeGreaterThan(500);
  });

  it('per-type call is graceful (slice if the bundle is anchored, else a clear miss)', async () => {
    const { text, isError } = await call('get_language_reference', {
      chart_type: 'sequence',
    });
    // Either a real slice (anchored bundle, post-release) or the documented
    // not-found message (pre-anchor bundle) — never a crash/empty.
    expect(text.length).toBeGreaterThan(0);
    if (!isError) expect(text.toLowerCase()).toMatch(/sequence/);
  });

  it('rejects an unknown chart type at the schema layer', async () => {
    const { isError } = await call('get_language_reference', {
      chart_type: 'not-a-real-type',
    });
    expect(isError).toBe(true);
  });
});

describe('get_examples', () => {
  it('returns example content for a known type', async () => {
    const { text, isError } = await call('get_examples', { chart_type: 'sequence' });
    expect(isError).toBe(false);
    expect(text.length).toBeGreaterThan(20);
  });
});

describe('render_diagram', () => {
  it('renders a valid diagram to SVG', async () => {
    const { text, isError } = await call('render_diagram', {
      dgmo: 'bar Revenue\n\nNorth 850\nSouth 620',
      format: 'svg',
    });
    expect(isError).toBe(false);
    expect(text).toMatch(/<svg/);
  });

  it('returns an error for an invalid diagram instead of rendering', async () => {
    const { text } = await call('render_diagram', {
      dgmo: 'infra\n\nLB\n  -> API | split: 70%',
      format: 'svg',
    });
    expect(text.toLowerCase()).toMatch(/error/);
  });
});

describe('migrate_diagram', () => {
  it('responds with content for legacy syntax without crashing', async () => {
    // migrate may report "nothing to migrate" as isError depending on the
    // bundled dgmo; the contract point is that it RESPONDS, not how.
    const { text } = await call('migrate_diagram', {
      dgmo: 'sequence T\n\ntag Team as t\n  A blue\n\nA -hi-> B',
    });
    expect(text.length).toBeGreaterThan(0);
  });
});

// --- Drift guard: instruction surfaces must only reference real tools --------
describe('no stale MCP tool references in the dgmo instruction surfaces', () => {
  const SURFACES = [
    'SKILL.md',
    '.claude/commands/dgmo.md',
    '.claude/commands/dgmo-diagram-this.md',
    '.claude/commands/dgmo-document-project.md',
  ];
  it('every `mcp__dgmo__<tool>` mentioned is a registered tool', () => {
    const dgmoRoot = join(here, '..', '..', 'dgmo');
    const referenced = new Set<string>();
    for (const rel of SURFACES) {
      const p = join(dgmoRoot, rel);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf8');
      for (const m of content.matchAll(/mcp__dgmo__([a-z_]+)/g)) referenced.add(m[1]);
    }
    const unknown = [...referenced].filter((t) => !toolNames.includes(t));
    expect(unknown, `surfaces reference non-existent tool(s): ${unknown.join(', ')}`).toEqual([]);
  });
});
