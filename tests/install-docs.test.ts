// install-docs.test.ts — the README tells a reader to install the CLI with
// npm, and never to brew.
//
// Homebrew is macOS-only, so a brew line sends a Linux reader to install a
// package manager to get a Node CLI that npm installs directly
// (diagrammo/diagrammo#921). The owner's decision: `npm install -g
// @diagrammo/dgmo-cli` is the one universal line, described as macOS and
// Linux; brew and pacman live only on diagrammo.app/dev. Windows is not named
// until a windows-latest job has run.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const readme = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'),
  'utf8'
);

describe('CLI install instructions (diagrammo/diagrammo#921)', () => {
  it('gives the npm line, described as macOS and Linux', () => {
    expect(readme).toContain(
      'npm install -g @diagrammo/dgmo-cli   # macOS and Linux'
    );
  });

  it('never tells the reader to install with Homebrew', () => {
    expect(readme).not.toMatch(/brew install/);
    expect(readme).not.toMatch(/install via Homebrew/i);
  });

  it('points at diagrammo.app/dev for Homebrew and pacman', () => {
    expect(readme).toContain('https://diagrammo.app/dev#cli');
  });

  it('does not name Windows as an install target', () => {
    expect(readme).not.toMatch(/windows/i);
  });
});
