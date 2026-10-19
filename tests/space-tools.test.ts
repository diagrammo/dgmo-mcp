// ============================================================
// space-tools.test.ts — put_space_diagram / get_space_diagram /
// list_space_diagrams (#1094) over the real wired server, with the Cloud API
// mocked at `fetch`. The HTTP client itself is dgmo's (`cloud-space.ts`) and is
// covered there through `dgmo put` / `get` / `ls`; this asserts the tool layer:
// the key comes from the environment, results are JSON, failures are isError.
// ============================================================

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';

const API = 'https://api.diagrammo.app';
const KEY = 'dgmo_sk_lookup_secret';
const SOURCE = 'flowchart\n\nStart -> End\n';

const folders = [{ id: 'f-docs', name: 'Docs', parentId: null }];
const summary = {
  id: 'd-1',
  title: 'System',
  version: 'v-3',
  updatedAt: 1760000000000,
  chartType: 'flowchart',
  folderId: 'f-docs',
};
const contents = { items: [summary], folders, role: 'editor' };
const detail = { ...summary, source: SOURCE };

type Answer = { status: number; body?: unknown };
type Request = {
  method: string;
  url: string;
  auth: string | undefined;
  body?: unknown;
};

/** Script the Cloud's answers by `METHOD path`; record what was sent. */
function mockCloud(routes: Record<string, Answer>): Request[] {
  const requests: Request[] = [];
  // A Promise executor, so a throw here rejects the call as an async stub would.
  vi.stubGlobal(
    'fetch',
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        const method = init.method ?? 'GET';
        const headers = init.headers as Record<string, string>;
        requests.push({
          method,
          url,
          auth: headers['authorization'],
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        const a = routes[`${method} ${url.slice(API.length)}`];
        if (!a) throw new Error(`unexpected ${method} ${url}`);
        resolve(
          new Response(a.body === undefined ? '' : JSON.stringify(a.body), {
            status: a.status,
            headers: { 'content-type': 'application/json' },
          })
        );
      })
  );
  return requests;
}

const client = new Client({ name: 'space-tools-test', version: '1.0.0' });

beforeAll(async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await createServer('stdio').connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
    isError?: boolean;
  };
  return {
    text: res.content.map((c) => c.text ?? '').join('\n'),
    isError: res.isError === true,
  };
}

describe('space tools', () => {
  it('are listed', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'put_space_diagram',
        'get_space_diagram',
        'list_space_diagrams',
      ])
    );
  });

  it('take no API key argument — the key is the server environment', async () => {
    const { tools } = await client.listTools();
    for (const t of tools.filter((t) => t.name.endsWith('space_diagram')))
      expect(Object.keys(t.inputSchema.properties ?? {})).not.toContain(
        'api_key'
      );
  });

  it('refuse without DGMO_API_KEY and send nothing', async () => {
    vi.stubEnv('DGMO_API_KEY', '');
    const requests = mockCloud({});
    const r = await call('list_space_diagrams', { space_id: 's-1' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('DGMO_API_KEY is not set');
    expect(requests).toEqual([]);
  });

  it('put_space_diagram creates (201) with the key from the environment', async () => {
    vi.stubEnv('DGMO_API_KEY', KEY);
    const requests = mockCloud({
      'GET /spaces/s-1/contents': { status: 200, body: contents },
      'PUT /spaces/s-1/diagrams': { status: 201, body: detail },
    });
    const r = await call('put_space_diagram', {
      space_id: 's-1',
      title: 'System',
      folder: 'docs',
      dgmo: SOURCE,
    });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toEqual({
      action: 'created',
      id: 'd-1',
      title: 'System',
      folder: 'Docs',
      version: 'v-3',
    });
    const put = requests.find((q) => q.method === 'PUT');
    expect(put?.auth).toBe(`Bearer ${KEY}`);
    expect(put?.body).toMatchObject({
      title: 'System',
      source: SOURCE,
      folderId: 'f-docs',
      chartType: 'flowchart',
    });
  });

  it('put_space_diagram reports an update (200)', async () => {
    vi.stubEnv('DGMO_API_KEY', KEY);
    mockCloud({
      'GET /spaces/s-1/contents': { status: 200, body: contents },
      'PUT /spaces/s-1/diagrams': { status: 200, body: detail },
    });
    const r = await call('put_space_diagram', {
      space_id: 's-1',
      title: 'System',
      folder: 'Docs',
      dgmo: SOURCE,
    });
    expect(JSON.parse(r.text)).toMatchObject({ action: 'updated' });
  });

  it('get_space_diagram returns the source by folder + title', async () => {
    vi.stubEnv('DGMO_API_KEY', KEY);
    mockCloud({
      'GET /spaces/s-1/contents': { status: 200, body: contents },
      'GET /spaces/s-1/diagrams/d-1': { status: 200, body: detail },
    });
    const r = await call('get_space_diagram', {
      space_id: 's-1',
      folder: 'docs',
      title: 'system',
    });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toMatchObject({
      id: 'd-1',
      folder: 'Docs',
      source: SOURCE,
    });
  });

  it('get_space_diagram needs an id or a title', async () => {
    vi.stubEnv('DGMO_API_KEY', KEY);
    const requests = mockCloud({});
    const r = await call('get_space_diagram', { space_id: 's-1' });
    expect(r.isError).toBe(true);
    expect(requests).toEqual([]);
  });

  it('list_space_diagrams returns every diagram with its folder path', async () => {
    vi.stubEnv('DGMO_API_KEY', KEY);
    mockCloud({ 'GET /spaces/s-1/contents': { status: 200, body: contents } });
    const r = await call('list_space_diagrams', { space_id: 's-1' });
    expect(JSON.parse(r.text)).toEqual({
      diagrams: [
        {
          id: 'd-1',
          title: 'System',
          folder: 'Docs',
          chartType: 'flowchart',
          version: 'v-3',
          updatedAt: 1760000000000,
        },
      ],
    });
  });

  it.each([
    [401, 'The API key was refused (401)'],
    [403, 'may not do this (403)'],
    [404, 'Not found (404)'],
    [409, 'landed first (409)'],
  ])(
    'a %i from the Cloud is an error result naming it',
    async (status, says) => {
      vi.stubEnv('DGMO_API_KEY', KEY);
      mockCloud({
        'GET /spaces/s-1/contents': { status: 200, body: contents },
        'PUT /spaces/s-1/diagrams': {
          status,
          body: { title: 'Refused', detail: 'by the test' },
        },
      });
      const r = await call('put_space_diagram', {
        space_id: 's-1',
        title: 'System',
        dgmo: SOURCE,
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(says);
    }
  );

  it('a title with no match is a 404 error result', async () => {
    vi.stubEnv('DGMO_API_KEY', KEY);
    mockCloud({ 'GET /spaces/s-1/contents': { status: 200, body: contents } });
    const r = await call('get_space_diagram', {
      space_id: 's-1',
      title: 'Nope',
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No diagram titled "Nope"');
  });
});
