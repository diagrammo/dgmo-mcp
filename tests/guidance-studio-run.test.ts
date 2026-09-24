// ============================================================
// guidance-studio-run.test.ts — the studio's POST /studio/run must not report
// a failed `claude -p` as a clean run. execFile hands back whatever stdout the
// child printed even when it errored — a 120 s timeout kill included — so a
// run with an error AND partial stdout used to be rendered and stored with
// `error: null`, which `pnpm studio:report` then counts as `rendered`.
// ============================================================

import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

import { savePlugin } from '../tools/guidance-studio/save-plugin';

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => void;

/** The /studio/run middleware, taken from a fake Vite dev server. */
function runHandler(): Handler {
  const handlers = new Map<string, Handler>();
  const plugin = savePlugin();
  const configure = plugin.configureServer as unknown as (server: {
    middlewares: { use: (route: string, h: Handler) => void };
  }) => void;
  configure({ middlewares: { use: (route, h) => handlers.set(route, h) } });
  const h = handlers.get('/studio/run');
  if (!h) throw new Error('/studio/run is not registered');
  return h;
}

/** POST a body to the handler; resolve with the status and parsed JSON. */
function post(
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST',
    }) as unknown as IncomingMessage;
    const res = {
      statusCode: 0,
      setHeader: () => undefined,
      end(payload: string) {
        resolve({ status: res.statusCode, json: JSON.parse(payload) });
      },
    } as unknown as ServerResponse;
    runHandler()(req, res, () => resolve({ status: -1, json: {} }));
  });
}

/** Make the next `claude -p` call finish with this error and stdout. */
function claudeReturns(err: Error | null, stdout: string): void {
  execFile.mockImplementationOnce(
    (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, out: string, errOut: string) => void
    ) => cb(err, stdout, '')
  );
}

function timeoutKill(): Error {
  return Object.assign(new Error('Command failed: claude -p …'), {
    killed: true,
    signal: 'SIGTERM',
  });
}

describe('/studio/run — a claude error fails the run', () => {
  beforeEach(() => execFile.mockReset());

  it('reports the error when claude was killed after printing part of an answer', async () => {
    const partial = 'bar Quarterly revenue\nQ1: 10\nQ2: 1';
    claudeReturns(timeoutKill(), '```dgmo\n' + partial + '\n```');

    const { status, json } = await post({ type: 'bar', prompt: 'revenue' });

    expect(status).toBe(200);
    expect(json['error']).toMatch(/^claude failed: Command failed/);
    expect(json['svg']).toBeNull();
    expect(json['pngBase64']).toBeNull();
    // The partial answer is kept, fence stripped, so the studio can show it.
    expect(json['dgmo']).toBe(partial);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('reports the error when claude failed before printing anything', async () => {
    claudeReturns(timeoutKill(), '');

    const { status, json } = await post({ type: 'bar', prompt: 'revenue' });

    expect(status).toBe(200);
    expect(json['error']).toMatch(/^claude failed: Command failed/);
    expect(json['dgmo']).toBe('');
    expect(json['svg']).toBeNull();
  });
});
