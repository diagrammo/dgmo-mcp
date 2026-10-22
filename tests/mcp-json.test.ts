// mcp-json.test.ts — the repo-root .mcp.json is how cursor.directory finds
// this server (diagrammo/diagrammo#1123).
//
// cursor.directory lists a submitted repo by auto-detecting its components,
// and an MCP server is detected only from `.mcp.json` (or `mcp.json`) at the
// repo root: it reads `mcpServers` and lists one server per key. Without the
// file a submission of this repo detects nothing. The owner's decision
// (2026-10-21): the file runs the published package through npx, the same
// config the README gives a reader.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcpJson = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as {
  mcpServers: Record<string, unknown>;
};
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
};

describe('.mcp.json (diagrammo/diagrammo#1123)', () => {
  it('declares exactly one server, dgmo', () => {
    expect(Object.keys(mcpJson)).toEqual(['mcpServers']);
    expect(Object.keys(mcpJson.mcpServers)).toEqual(['dgmo']);
  });

  it('runs the published package through npx', () => {
    expect(mcpJson.mcpServers.dgmo).toEqual({
      command: 'npx',
      args: ['-y', pkg.name],
    });
  });
});
