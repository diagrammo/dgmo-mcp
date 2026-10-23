// release-supply-chain.test.ts — the release job runs only from a gated
// environment, runs a pinned and checksum-verified mcp-publisher, and builds
// the .mcpb from the committed lockfile (diagrammo/diagrammo#1501, slice b).
//
// The scripts run against fake `curl`, `pnpm`, `npm` and `npx` on PATH, as in
// publish-registry.test.ts, so nothing here touches the network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseYml = readFileSync(
  join(root, '.github', 'workflows', 'release.yml'),
  'utf8'
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-supply-chain-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A fake command that appends "<cwd> <args>" to <name>.log, then runs `body`.
function fake(bin: string, name: string, body = '') {
  const path = join(bin, name);
  writeFileSync(
    path,
    `#!/usr/bin/env bash\necho "$PWD $*" >> "${join(dir, `${name}.log`)}"\n${body}\n`
  );
  chmodSync(path, 0o755);
}

function log(name: string): string {
  const path = join(dir, `${name}.log`);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('release.yml publish job', () => {
  // The job's own block: from `  publish:` to the next top-level job or EOF.
  const job = releaseYml.slice(releaseYml.indexOf('\n  publish:\n'));

  it('runs in the release environment', () => {
    expect(job).toMatch(/^ {4}environment: release$/m);
  });

  it('never downloads mcp-publisher from releases/latest', () => {
    expect(releaseYml).not.toMatch(/releases\/latest/);
    expect(job).toMatch(/run: bash scripts\/install-mcp-publisher\.sh/);
  });
});

describe('scripts/install-mcp-publisher.sh', () => {
  const script = join(root, 'scripts', 'install-mcp-publisher.sh');

  function run() {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // Writes junk to the `-o` path: its sha256 can never match the pin.
    fake(
      bin,
      'curl',
      'while [ $# -gt 0 ]; do [ "$1" = -o ] && { echo junk > "$2"; shift; }; shift; done'
    );
    const dest = join(dir, 'dest');
    mkdirSync(dest);
    const res = spawnSync('bash', [script, dest], {
      env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` },
      encoding: 'utf8',
    });
    return { ...res, dest };
  }

  it('downloads one pinned version, not latest', () => {
    run();
    expect(log('curl')).toMatch(
      /releases\/download\/v\d+\.\d+\.\d+\/mcp-publisher_linux_amd64\.tar\.gz/
    );
  });

  it('refuses a tarball whose checksum does not match, installing nothing', () => {
    const { status, stderr, dest } = run();
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/checksum mismatch/);
    expect(existsSync(join(dest, 'mcp-publisher'))).toBe(false);
    expect(existsSync(join(dest, 'mcp-publisher.tar.gz'))).toBe(false);
  });
});

describe('scripts/bundle.sh', () => {
  // A copy of the repo's shape in a temp dir, so the real dist/ and bundle/
  // are never touched.
  function run() {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    mkdirSync(join(repo, 'dist'));
    mkdirSync(join(repo, 'icons'));
    cpSync(
      join(root, 'scripts', 'bundle.sh'),
      join(repo, 'scripts', 'bundle.sh')
    );
    for (const f of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'manifest.json',
      'README.md',
    ]) {
      cpSync(join(root, f), join(repo, f));
    }
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    fake(bin, 'pnpm', '[ "$1" = install ] && mkdir -p node_modules; exit 0');
    fake(bin, 'npm', 'exit 0');
    fake(bin, 'npx', 'touch "${@: -1}"');
    const res = spawnSync('bash', [join(repo, 'scripts', 'bundle.sh')], {
      env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` },
      encoding: 'utf8',
    });
    return { ...res, bundle: join(repo, 'bundle') };
  }

  it('installs the runtime tree frozen from the lockfile, never with npm', () => {
    const { status, stderr, bundle } = run();
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(log('npm')).toBe('');
    expect(log('pnpm')).toContain(`${bundle} install --prod --frozen-lockfile`);
  });

  it('ships the lockfile, and a manifest whose specifiers match it', () => {
    const { bundle } = run();
    expect(readFileSync(join(bundle, 'pnpm-lock.yaml'), 'utf8')).toBe(
      readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
    );
    type Manifest = {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const read = (path: string) =>
      JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    const pkg = read(join(bundle, 'package.json'));
    const repoPkg = read(join(root, 'package.json'));
    expect(pkg.dependencies).toEqual(repoPkg.dependencies);
    expect(pkg.devDependencies).toEqual(repoPkg.devDependencies);
  });
});
