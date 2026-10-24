// ============================================================
// http-transport.test.ts — the streamable HTTP transport.
//
// Drives a REAL http.Server with a REAL MCP client over the wire, because the
// two things most worth proving here are only true end to end: that the tools
// which act on the server's own machine are not offered, and that two clients
// in flight at once do not collide (the SDK refuses a reused stateless
// transport, so a regression there is a 500 rather than a subtle wrong answer).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, transportMode } from '../src/index.js';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import {
  startHttpServer,
  MAX_BODY_BYTES,
  type HttpServerHandle,
} from '../src/http-transport.js';
import {
  parseRuntimeConfig,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PATH,
  DEFAULT_HTTP_PORT,
} from '../src/runtime-config.js';

/** Tools that act on the machine the server runs on. */
const MACHINE_LOCAL = [
  'open_in_app',
  'check_app_installed',
  'preview_diagram',
  'generate_report',
];

/** Tools that are pure functions of their arguments, so they travel. */
const PORTABLE = [
  'render_diagram',
  'share_diagram',
  'list_chart_types',
  'get_language_reference',
  'validate_diagram',
  'suggest_chart_type',
];

describe('parseRuntimeConfig', () => {
  it('defaults to stdio, so an existing client is unaffected', () => {
    expect(parseRuntimeConfig([], {}).mode).toBe('stdio');
  });

  it('takes --http, --transport and MCP_TRANSPORT alike', () => {
    expect(parseRuntimeConfig(['--http'], {}).mode).toBe('http');
    expect(parseRuntimeConfig(['--transport', 'http'], {}).mode).toBe('http');
    expect(parseRuntimeConfig(['--transport=streamable-http'], {}).mode).toBe(
      'http'
    );
    expect(parseRuntimeConfig([], { MCP_TRANSPORT: 'http' }).mode).toBe('http');
    expect(
      parseRuntimeConfig([], { MCP_TRANSPORT: 'streamable-http' }).mode
    ).toBe('http');
  });

  it('binds loopback on the default port and path unless told otherwise', () => {
    const config = parseRuntimeConfig(['--http'], {});
    expect(config.host).toBe(DEFAULT_HTTP_HOST);
    expect(config.port).toBe(DEFAULT_HTTP_PORT);
    expect(config.path).toBe(DEFAULT_HTTP_PATH);
  });

  it('lets a flag beat the environment variable asking for the same thing', () => {
    const config = parseRuntimeConfig(['--http', '--port', '9001'], {
      MCP_PORT: '9002',
    });
    expect(config.port).toBe(9001);
  });

  it('falls back to the default port rather than NaN on an unparseable one', () => {
    expect(parseRuntimeConfig(['--http', '--port', 'lots'], {}).port).toBe(
      DEFAULT_HTTP_PORT
    );
  });

  it('normalises a path given without its leading slash', () => {
    expect(parseRuntimeConfig(['--http', '--path', 'rpc'], {}).path).toBe(
      '/rpc'
    );
  });

  it('always accepts the loopback Host headers, with and without the port', () => {
    const { allowedHosts } = parseRuntimeConfig(
      ['--http', '--port', '9001'],
      {}
    );
    expect(allowedHosts).toContain('localhost');
    expect(allowedHosts).toContain('localhost:9001');
    expect(allowedHosts).toContain('127.0.0.1:9001');
  });

  it('takes extra hosts from a repeated flag and from a comma-separated variable', () => {
    const config = parseRuntimeConfig(
      [
        '--http',
        '--allow-host',
        'mcp.internal',
        '--allow-host',
        'other.internal',
      ],
      { MCP_ALLOWED_HOSTS: 'third.internal, fourth.internal' }
    );
    for (const host of [
      'mcp.internal',
      'other.internal',
      'third.internal',
      'fourth.internal',
    ]) {
      expect(config.allowedHosts).toContain(host);
    }
  });

  it('flags the one exposed-and-unconfigured combination, and only that one', () => {
    expect(parseRuntimeConfig(['--http'], {}).exposedWithoutAllowList).toBe(
      false
    );
    expect(
      parseRuntimeConfig(['--http', '--host', '0.0.0.0'], {})
        .exposedWithoutAllowList
    ).toBe(true);
    expect(
      parseRuntimeConfig(
        ['--http', '--host', '0.0.0.0', '--allow-host', 'mcp.internal'],
        {}
      ).exposedWithoutAllowList
    ).toBe(false);
    // stdio is never exposed, whatever it was told about hosts.
    expect(
      parseRuntimeConfig(['--host', '0.0.0.0'], {}).exposedWithoutAllowList
    ).toBe(false);
  });
});

describe('tool surface per transport', () => {
  it('offers every tool over stdio', () => {
    const server = createServer('stdio');
    const names = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools
    );
    for (const name of [...MACHINE_LOCAL, ...PORTABLE])
      expect(names).toContain(name);
  });

  it('leaves the module-level server on stdio regardless of how vitest was invoked', () => {
    expect(transportMode()).toBe('stdio');
  });
});

describe('over the wire', () => {
  let handle: HttpServerHandle;
  let baseUrl: URL;

  beforeAll(async () => {
    // Port 0: the OS picks a free one, so the suite cannot collide with a
    // server someone left running.
    const config = parseRuntimeConfig(['--http', '--port', '0'], {});
    handle = await startHttpServer({ ...config, port: 0 }, () =>
      createServer('http')
    );
    baseUrl = new URL(`http://127.0.0.1:${handle.port}${config.path}`);
  });

  afterAll(async () => {
    await handle?.close();
  });

  async function connect(): Promise<Client> {
    const client = new Client({
      name: 'http-transport-test',
      version: '1.0.0',
    });
    // Cast: the SDK's transport does not satisfy the SDK's own Transport type
    // under `exactOptionalPropertyTypes` (`sessionId` is `string | undefined`
    // against a required `string`). Upstream typing gap, not a real mismatch.
    await client.connect(
      new StreamableHTTPClientTransport(baseUrl) as unknown as Parameters<
        Client['connect']
      >[0]
    );
    return client;
  }

  it('does not offer the tools that would act on the server rather than the caller', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of MACHINE_LOCAL) expect(names).not.toContain(name);
    for (const name of PORTABLE) expect(names).toContain(name);
    await client.close();
  });

  it('answers a real tool call', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'validate_diagram',
      arguments: { dgmo: 'pie Sales\nApples 30\nPears 70' },
    })) as { content: { type: string; text?: string }[]; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toMatch(/valid/i);
    await client.close();
  });

  it('refuses a machine-local tool by name rather than silently doing nothing', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'open_in_app',
      arguments: { dgmo: 'pie T\nA 1' },
    })) as { content: { text?: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    // The name is in the message: a caller that asked for it learns which tool
    // it cannot have here, rather than reading a bare protocol code.
    expect(result.content[0]?.text).toContain('open_in_app');
    await client.close();
  });

  it('serves concurrent clients without collision', async () => {
    // The regression this guards: one shared stateless transport makes the SDK
    // throw `Stateless transport cannot be reused across requests`.
    const clients = await Promise.all([
      connect(),
      connect(),
      connect(),
      connect(),
    ]);
    const results = await Promise.all(
      clients.map((client, i) =>
        client.callTool({
          name: 'validate_diagram',
          arguments: { dgmo: `pie Sales ${i}\nApples ${i + 1}\nPears 70` },
        })
      )
    );
    for (const result of results) {
      expect((result as { isError?: boolean }).isError).toBeFalsy();
    }
    await Promise.all(clients.map((c) => c.close()));
  });

  it('404s a path that is not the MCP endpoint, and says where it is', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain(DEFAULT_HTTP_PATH);
  });

  it('rejects a request carrying a Host header it was not told to answer to', async () => {
    // DNS rebinding: a browser on the operator's machine, pointed at a hostname
    // that resolves to loopback, must not reach an unauthenticated server.
    // Raw http again — `fetch` treats Host as a forbidden header and drops it,
    // which quietly turns this into a test of the allowed case.
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle.port,
          path: baseUrl.pathname,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            host: 'evil.example.com',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  // Raw http, so the Origin header goes out exactly as a browser would send it.
  function postWithOrigin(origin: string): Promise<number> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    return new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle.port,
          path: baseUrl.pathname,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            origin,
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  it('refuses a cross-site Origin even when no --allow-origin was given (#1501)', async () => {
    // A web page open on the operator's machine can POST to loopback. With no
    // accept-list the SDK skips its Origin check entirely, so the server
    // supplies its own origins as the default list.
    expect(await postWithOrigin('https://evil.example.com')).toBe(403);
    expect(await postWithOrigin('http://localhost:1')).toBe(403);
  });

  it('serves a request from its own origin when no --allow-origin was given', async () => {
    expect(await postWithOrigin(`http://127.0.0.1:${handle.port}`)).toBe(200);
    expect(await postWithOrigin(`http://localhost:${handle.port}`)).toBe(200);
  });

  it('refuses a body past the cap on its declared length, without reading it', async () => {
    // Raw http, because the point is a Content-Length larger than what is sent:
    // the server must answer from the header alone, having read no body at all.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle.port,
          path: baseUrl.pathname,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(MAX_BODY_BYTES + 1),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.write('{');
    });
    expect(status).toBe(413);
  });

  // Raw TCP, so the request line and Host header go out byte for byte: both
  // `fetch` and `http.request` would normalise or refuse what is under test.
  function rawStatus(target: string, host: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const socket = netConnect(handle.port, '127.0.0.1', () => {
        socket.write(
          `GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`
        );
      });
      let head = '';
      socket.on('data', (chunk) => {
        head += chunk.toString('latin1');
      });
      socket.on('end', () => {
        const status = /^HTTP\/1\.1 (\d{3})/.exec(head);
        resolve(status ? Number(status[1]) : 0);
      });
      socket.on('error', reject);
    });
  }

  it('answers 400 to a malformed Host header or request target, and keeps serving (#1499)', async () => {
    // Either input once made `new URL()` throw outside any catch, and the
    // unhandled rejection ended the process.
    expect(await rawStatus(baseUrl.pathname, 'a b')).toBe(400);
    expect(await rawStatus('//[', `127.0.0.1:${handle.port}`)).toBe(400);
    expect(await postWithOrigin(`http://127.0.0.1:${handle.port}`)).toBe(200);
  });
});
