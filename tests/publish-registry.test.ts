// publish-registry.test.ts — the MCP registry publish waits for npm, and
// retries the registry's own not-found 404, instead of failing the release.
//
// The registry validates against npm, and npm can take ~10 minutes to serve a
// fresh version. release.yml waited 60 seconds and "proceeded anyway", so the
// 0.29.7 release failed at the registry step and needed a manual re-dispatch
// (diagrammo/diagrammo#1164). These tests run scripts/publish-registry.sh
// against a fake `npm` and a fake `mcp-publisher`, with the sleeps set to 0.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'publish-registry.sh');
const NOT_FOUND =
  "Error: publish failed: server returned status 400: registry validation failed for package 0 (@diagrammo/dgmo-mcp): NPM package '@diagrammo/dgmo-mcp' exists, but version '1.2.3' was not found (status: 404).";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'publish-registry-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A fake that appends its arguments to <name>.log and answers from a counter:
// it fails (printing `failText`) on its first `failures` calls of `verb`.
function fake(name: string, verb: string, failures: number, failText = '') {
  const path = join(dir, name);
  writeFileSync(
    path,
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/${name}.log"
case "$*" in *${verb}*) ;; *) exit 0 ;; esac
n=$(cat "${dir}/${name}.count" 2>/dev/null || echo 0)
n=$((n + 1)); echo "$n" > "${dir}/${name}.count"
if [ "$n" -le ${failures} ]; then echo "${failText}"; exit 1; fi
echo "ok"
`,
    { mode: 0o755 }
  );
}

function calls(name: string): string[] {
  const log = join(dir, `${name}.log`);
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
}

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [script, '1.2.3'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env['PATH']}`,
      MCP_PUBLISHER: join(dir, 'mcp-publisher'),
      NPM_POLL_SECONDS: '0',
      PUBLISH_RETRY_SECONDS: '0',
      NPM_POLL_ATTEMPTS: '5',
      PUBLISH_ATTEMPTS: '3',
      ...env,
    },
  });
}

describe('MCP registry publish (diagrammo/diagrammo#1164)', () => {
  it('waits until npm serves the version, then publishes once', () => {
    fake('npm', 'view', 3);
    fake('mcp-publisher', 'publish', 0);
    const r = run();
    expect(r.status).toBe(0);
    expect(calls('npm')).toHaveLength(4);
    expect(calls('npm')[0]).toBe('view @diagrammo/dgmo-mcp@1.2.3 version');
    expect(calls('mcp-publisher')).toEqual(['login github-oidc', 'publish']);
  });

  it('fails without publishing when npm never serves the version', () => {
    fake('npm', 'view', 99);
    fake('mcp-publisher', 'publish', 0);
    const r = run();
    expect(r.status).not.toBe(0);
    expect(calls('npm')).toHaveLength(5);
    expect(calls('mcp-publisher')).toEqual([]);
    expect(r.stdout).toContain('::error::npm did not serve');
  });

  it("retries the registry's not-found 404, logging in before each try", () => {
    fake('npm', 'view', 0);
    fake('mcp-publisher', 'publish', 2, NOT_FOUND);
    const r = run();
    expect(r.status).toBe(0);
    expect(calls('mcp-publisher')).toEqual([
      'login github-oidc',
      'publish',
      'login github-oidc',
      'publish',
      'login github-oidc',
      'publish',
    ]);
  });

  it('gives up after PUBLISH_ATTEMPTS when the 404 persists', () => {
    fake('npm', 'view', 0);
    fake('mcp-publisher', 'publish', 99, NOT_FOUND);
    const r = run();
    expect(r.status).not.toBe(0);
    expect(calls('mcp-publisher').filter((c) => c === 'publish')).toHaveLength(
      3
    );
    expect(r.stdout).toContain('after 3 attempts');
  });

  it('does not retry any other publish failure', () => {
    fake('npm', 'view', 0);
    fake('mcp-publisher', 'publish', 99, 'Error: invalid server.json');
    const r = run();
    expect(r.status).not.toBe(0);
    expect(calls('mcp-publisher')).toEqual(['login github-oidc', 'publish']);
  });

  it('release.yml publishes through the script, with no 60-second fallback', () => {
    const yml = readFileSync(
      join(root, '.github', 'workflows', 'release.yml'),
      'utf8'
    );
    expect(yml).toContain('run: bash scripts/publish-registry.sh');
    expect(yml).not.toContain('proceeding anyway');
    expect(yml).not.toMatch(/^\s*\.\/mcp-publisher publish/m);
  });
});
