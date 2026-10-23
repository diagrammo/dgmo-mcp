// ============================================================
// guidance-studio-origin.test.ts — the studio's POST endpoints write files and
// spawn a metered `claude -p`. Any web page open in the same browser can send
// them a blind cross-site POST (a `text/plain` body needs no preflight), so a
// POST whose Origin is not the studio's own is refused before any handler (#1501).
// ============================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { savePlugin } from '../tools/guidance-studio/save-plugin';

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => void;

/** The middlewares a fake Vite dev server was given, in registration order. */
function registered(): [string, Handler][] {
  const handlers: [string, Handler][] = [];
  const configure = savePlugin().configureServer as unknown as (server: {
    middlewares: { use: (route: string, h: Handler) => void };
  }) => void;
  configure({ middlewares: { use: (route, h) => handlers.push([route, h]) } });
  return handlers;
}

/** Runs the first middleware; returns the status it sent, or 'next'. */
function guard(
  method: string,
  headers: Record<string, string>
): number | 'next' {
  const [route, h] = registered()[0];
  expect(route).toBe('/studio');
  const res = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  let passed = false;
  h({ method, headers } as IncomingMessage, res, () => (passed = true));
  return passed ? 'next' : res.statusCode;
}

describe('studio origin guard', () => {
  it('is registered before every /studio handler', () => {
    expect(registered()[0][0]).toBe('/studio');
  });

  it('refuses a POST from another origin', () => {
    expect(
      guard('POST', { host: 'localhost:4347', origin: 'https://evil.example' })
    ).toBe(403);
    expect(
      guard('POST', { host: 'localhost:4347', origin: 'http://localhost:5173' })
    ).toBe(403);
    expect(guard('POST', { host: 'localhost:4347', origin: 'null' })).toBe(403);
  });

  it('passes a POST from the studio page itself, and one with no Origin', () => {
    expect(
      guard('POST', { host: 'localhost:4347', origin: 'http://localhost:4347' })
    ).toBe('next');
    expect(guard('POST', { host: 'localhost:4347' })).toBe('next');
  });

  it('leaves GETs alone', () => {
    expect(
      guard('GET', { host: 'localhost:4347', origin: 'https://evil.example' })
    ).toBe('next');
  });
});
