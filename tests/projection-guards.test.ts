// The projection scripts must FAIL when a registry chart type would be
// invisible to the AI picker or to list_chart_types (diagrammo/diagrammo#2288).
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '../scripts');

const registry = {
  families: [{ id: 'data', label: 'Data' }],
  entities: [
    {
      kind: 'type',
      id: 'bar',
      family: 'data',
      intent: ['compare'],
      keywords: [{ text: 'bar chart' }],
    },
    {
      kind: 'type',
      id: 'newtype',
      family: 'data',
      intent: ['compare'],
      keywords: [{ text: 'brand new chart' }],
    },
  ],
};

let dir: string;
const run = (script: string, args: string[]) =>
  spawnSync(process.execPath, [join(scripts, script), ...args], {
    encoding: 'utf8',
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dgmo-mcp-proj-'));
  writeFileSync(join(dir, 'registry.json'), JSON.stringify(registry));
});

describe('project-triggers --check', () => {
  const args = () => [
    '--registry',
    join(dir, 'registry.json'),
    '--triggers',
    join(dir, 'triggers.json'),
  ];

  it('fails naming a registry type that has no triggers entry', () => {
    writeFileSync(join(dir, 'triggers.json'), '{}');
    expect(run('project-triggers.mjs', args()).status).toBe(0);
    expect(run('project-triggers.mjs', [...args(), '--check']).status).toBe(0);

    const triggers = JSON.parse(
      readFileSync(join(dir, 'triggers.json'), 'utf8')
    ) as Record<string, { phrases: string[] }>;
    expect(triggers['newtype']?.phrases).toEqual(['brand new chart']);
    delete triggers['newtype'];
    writeFileSync(
      join(dir, 'triggers.json'),
      JSON.stringify(triggers, null, 2) + '\n'
    );

    const r = run('project-triggers.mjs', [...args(), '--check']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('newtype');
    expect(r.stderr).not.toContain('bar,');
  });
});

describe('project-families', () => {
  const args = () => [
    '--registry',
    join(dir, 'registry.json'),
    '--out',
    join(dir, 'chart-families.json'),
  ];

  it('passes when every type has a known family', () => {
    expect(run('project-families.mjs', args()).status).toBe(0);
    expect(run('project-families.mjs', [...args(), '--check']).status).toBe(0);
  });

  it.each([
    ['no family', undefined],
    ['an unknown family', 'nowhere'],
  ])('fails naming a type with %s', (_label, family) => {
    const broken = structuredClone(registry);
    broken.entities[1].family = family as string;
    writeFileSync(join(dir, 'registry.json'), JSON.stringify(broken));
    for (const extra of [[], ['--check']]) {
      const r = run('project-families.mjs', [...args(), ...extra]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('newtype');
    }
  });
});
