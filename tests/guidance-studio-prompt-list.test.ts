// @vitest-environment jsdom
// ============================================================
// guidance-studio-prompt-list.test.ts — the studio's prompt list must show a
// prompt as text. prompts.json is written by the studio's own POST
// /studio/prompts, so a prompt string is data from a request; the list used to
// put it into the page through innerHTML, where markup in it ran (#1501).
// ============================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeAll } from 'vitest';

const PAYLOAD = '<img src="x" onerror="window.__studioPwned = 1">';

vi.mock('../tools/guidance-studio/registry.json', () => ({
  default: {
    types: [{ id: 'bar', description: 'Bar chart', hasTips: false }],
  },
}));
vi.mock('../tools/guidance-studio/prompts.json', () => ({
  default: { bar: [PAYLOAD] },
}));

/** Answers each studio endpoint with the empty shape main.ts reads. */
function fakeFetch(input: unknown): Promise<Response> {
  const url = String(input);
  const body = url.startsWith('/studio/guidance')
    ? { block: '' }
    : url.startsWith('/studio/datasets')
      ? { all: [], fitting: [] }
      : url.startsWith('/studio/coverage')
        ? { types: [] }
        : {};
  return Promise.resolve(new Response(JSON.stringify(body)));
}

describe('studio prompt list', () => {
  beforeAll(async () => {
    const html = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../tools/guidance-studio/index.html'
      ),
      'utf8'
    );
    document.documentElement.innerHTML = html.replace(
      /<script[\s\S]*?<\/script>/g,
      ''
    );
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    await import('../tools/guidance-studio/main');
  });

  it('renders a prompt holding markup as text, never as elements', async () => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>('#picker button'),
    ].find((b) => b.textContent?.includes('bar'));
    expect(button).toBeDefined();
    button!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#prompt-list .prompt-row')).not.toBeNull();
    });

    const list = document.querySelector('#prompt-list')!;
    expect(list.querySelector('img')).toBeNull();
    expect(list.textContent).toContain(PAYLOAD);
  });
});
