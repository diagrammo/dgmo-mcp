#!/usr/bin/env node
// Smoke-test a packed dgmo-mcp tarball: install in a temp dir, spawn the binary,
// run an MCP initialize + tools/list exchange, verify the server responds with
// a non-empty tools list. Exits non-zero on any failure.
//
// Usage: node scripts/smoke.mjs <path-to-tarball>

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const tarball = resolve(process.argv[2] ?? '');
if (!tarball) {
  console.error('usage: smoke.mjs <tarball.tgz>');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'dgmo-mcp-smoke-'));
let failed = false;
try {
  console.log(`→ smoke: install ${tarball} into ${dir}`);
  execFileSync('npm', ['init', '-y', '--silent'], { cwd: dir, stdio: 'pipe' });
  execFileSync('npm', ['install', '--no-fund', '--no-audit', tarball], {
    cwd: dir,
    stdio: 'pipe',
  });

  console.log('→ smoke: probe MCP initialize + tools/list');
  const bin = join(dir, 'node_modules', '.bin', 'dgmo-mcp');
  const result = await probe(bin);
  if (!result.tools || result.tools.length === 0) {
    throw new Error('tools/list returned empty');
  }
  console.log(`✓ smoke: server reports ${result.tools.length} tools (${result.tools.slice(0, 3).join(', ')}, ...)`);
} catch (err) {
  failed = true;
  console.error('✗ smoke FAILED:', err.message ?? err);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

function probe(binPath) {
  return new Promise((res, rej) => {
    const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

    setTimeout(() => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } }), 100);
    setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/initialized' }), 600);
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), 1200);
    setTimeout(() => child.stdin.end(), 2500);
    const killer = setTimeout(() => child.kill('SIGKILL'), 8000);

    child.on('exit', (code) => {
      clearTimeout(killer);
      if (code !== 0 && code !== null) {
        return rej(new Error(`server exited code=${code}\nstderr: ${stderr}`));
      }
      const lines = stdout.split('\n').filter(Boolean);
      const responses = lines.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      const initResp = responses.find((r) => r.id === 1);
      const toolsResp = responses.find((r) => r.id === 2);
      if (!initResp?.result?.protocolVersion) {
        return rej(new Error(`no valid initialize response\nstdout: ${stdout.slice(0, 500)}`));
      }
      if (!Array.isArray(toolsResp?.result?.tools)) {
        return rej(new Error(`no valid tools/list response\nstdout: ${stdout.slice(0, 500)}`));
      }
      res({ tools: toolsResp.result.tools.map((t) => t.name) });
    });
  });
}
