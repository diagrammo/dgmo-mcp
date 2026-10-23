// ============================================================
// guidance-studio-dataset-id.test.ts — a dataset id is a bare file stem.
// The studio joined the id from GET /studio/dataset?id= and POST /studio/run's
// `datasetId` straight into DATASETS_DIR, so `../registry` read
// tools/guidance-studio/registry.json and any `../…` reached any .json file
// the dev user could read (#1500). An id with a separator or `..` is now
// refused, while a real dataset id still loads.
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

type Reply = { status: number; json: Record<string, unknown> };

/** One studio middleware, taken from a fake Vite dev server. */
function handler(route: string): Handler {
  const handlers = new Map<string, Handler>();
  const configure = savePlugin().configureServer as unknown as (server: {
    middlewares: { use: (route: string, h: Handler) => void };
  }) => void;
  configure({ middlewares: { use: (r, h) => handlers.set(r, h) } });
  const h = handlers.get(route);
  if (!h) throw new Error(`${route} is not registered`);
  return h;
}

function call(route: string, req: IncomingMessage): Promise<Reply> {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      setHeader: () => undefined,
      end(payload: string) {
        resolve({
          status: res.statusCode,
          json: JSON.parse(payload) as Record<string, unknown>,
        });
      },
    } as unknown as ServerResponse;
    handler(route)(req, res, () => resolve({ status: -1, json: {} }));
  });
}

/** GET /studio/dataset with a raw (already URL-encoded) query string. */
function getDataset(rawQuery: string): Promise<Reply> {
  return call('/studio/dataset', {
    method: 'GET',
    url: `/?${rawQuery}`,
  } as unknown as IncomingMessage);
}

/**
 * POST /studio/run; resolves with the prompt handed to `claude -p`. The fake
 * claude fails, so the run stops before rendering (no built dist/ needed).
 */
async function runPrompt(datasetId: string): Promise<string> {
  execFile.mockImplementationOnce(
    (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, out: string, errOut: string) => void
    ) => cb(new Error('claude stopped by the test'), '', '')
  );
  const req = Object.assign(
    Readable.from([
      JSON.stringify({ type: 'bar', prompt: 'revenue', datasetId }),
    ]),
    { method: 'POST' }
  ) as unknown as IncomingMessage;
  const { status } = await call('/studio/run', req);
  expect(status).toBe(200);
  expect(execFile).toHaveBeenCalledTimes(1);
  const args = execFile.mock.calls[0]?.[1] as string[];
  return args[args.indexOf('-p') + 1] ?? '';
}

const DATA_LINE = 'Use EXACTLY this data';

describe('GET /studio/dataset — the id cannot leave the datasets directory', () => {
  it.each([
    ['id=../registry'],
    ['id=../package'],
    ['id=..%2Fpackage'],
    ['id=a/b'],
    ['id=..%2F..%2F..%2Fpackage'],
  ])('refuses %s', async (query) => {
    const { status, json } = await getDataset(query);
    expect(status).toBe(400);
    expect(json).toEqual({ error: 'invalid dataset id' });
  });

  it('still loads a real dataset', async () => {
    const { status, json } = await getDataset('id=sales-by-quarter-region');
    expect(status).toBe(200);
    expect(json['data']).toBeDefined();
  });

  it('answers 404 for a well-formed id with no file', async () => {
    const { status } = await getDataset('id=no-such-dataset');
    expect(status).toBe(404);
  });
});

describe('POST /studio/run — a traversing datasetId injects nothing', () => {
  beforeEach(() => execFile.mockReset());

  it('sends no data for ../registry', async () => {
    expect(await runPrompt('../registry')).not.toContain(DATA_LINE);
  });

  it('still sends a real dataset', async () => {
    expect(await runPrompt('sales-by-quarter-region')).toContain(DATA_LINE);
  });
});
