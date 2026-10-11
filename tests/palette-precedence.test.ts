// ============================================================
// palette-precedence.test.ts — a diagram's own `palette` line against the
// tools' `palette` argument (#1038, palette slice 2). Who wins, highest first:
// an explicit `palette` argument, the diagram's own line, slate.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';
import { svgBackground } from '../src/render-helpers.js';

const BODY = 'pie Sales\nApples 30\nPears 70\n';
const WITH_LINE = `palette nord\n${BODY}`;

const client = new Client({ name: 'palette-precedence', version: '1.0.0' });

beforeAll(async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await createServer('stdio').connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

/** render_diagram's SVG background for `dgmo`, with an optional palette arg. */
async function background(dgmo: string, palette?: string) {
  const res = (await client.callTool({
    name: 'render_diagram',
    arguments: { dgmo, ...(palette === undefined ? {} : { palette }) },
  })) as { content: { type: string; text?: string }[]; isError?: boolean };
  expect(res.isError).toBeFalsy();
  const svg = res.content.find((c) => c.text?.startsWith('<svg'))?.text ?? '';
  return svgBackground(svg);
}

describe('render_diagram palette precedence', () => {
  it('draws the three cases in three different palettes', async () => {
    const fileWins = await background(WITH_LINE);
    const overrideWins = await background(WITH_LINE, 'catppuccin');
    const defaultOnly = await background(BODY);
    expect(new Set([fileWins, overrideWins, defaultOnly]).size).toBe(3);
  });

  it("uses the diagram's own palette when no palette is passed", async () => {
    expect(await background(WITH_LINE)).toBe(await background(BODY, 'nord'));
  });

  it('lets an explicit palette argument beat the diagram', async () => {
    expect(await background(WITH_LINE, 'catppuccin')).toBe(
      await background(BODY, 'catppuccin')
    );
  });

  it('falls back to slate with neither', async () => {
    expect(await background(BODY)).toBe(await background(BODY, 'slate'));
  });
});

describe('svgBackground', () => {
  it("reads the root element's background", () => {
    expect(
      svgBackground(
        '<svg width="1" style="background: rgb(1, 2, 3); font-family: Inter;"><rect style="background: red"/></svg>'
      )
    ).toBe('rgb(1, 2, 3)');
  });

  it('is undefined when the root carries none', () => {
    expect(svgBackground('<svg width="1"><rect/></svg>')).toBeUndefined();
  });
});
