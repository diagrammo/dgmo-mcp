// ---------------------------------------------------------------------------
// Streamable HTTP transport.
//
// Every request gets its OWN McpServer and its OWN transport, which is not an
// optimisation choice — the SDK throws `Stateless transport cannot be reused
// across requests` if you try to share one, because two clients that both send
// JSON-RPC id 1 would otherwise collide. So the unit of isolation is a request,
// and nothing survives it.
//
// Stateless is also the right shape for what this server does: all seven tools
// offered over HTTP are pure functions of their arguments. There is no session
// worth keeping, no server-initiated message to push down a standing stream,
// and therefore no session table to leak in a process nobody is watching.
// ---------------------------------------------------------------------------

import { createServer as createHttpServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RuntimeConfig } from './runtime-config.js';
import { deriveAllowedHosts } from './runtime-config.js';

/** Request bodies above this are refused unread — an MCP call is text. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** JSON-RPC error codes used for failures that never reach the protocol layer. */
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_INTERNAL_ERROR = -32603;

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
  res.writeHead(status, { 'content-type': 'application/json' }).end(body);
}

/**
 * Buffer the body ourselves so an oversized one is refused before it is parsed
 * rather than after. Resolves `undefined` for a body-less method.
 *
 * A declared Content-Length is checked first, so the usual oversized request is
 * turned away without a byte being read. The running total still guards a
 * chunked body, which declares no length. Neither path destroys the request:
 * hanging up mid-upload gives the client a socket error instead of the 413 that
 * would have told it what was wrong.
 */
function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number.parseInt(req.headers['content-length'] ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Promise.reject(new RangeError('request body too large'));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        refused = true;
        req.pause();
        reject(new RangeError('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new SyntaxError('request body is not valid JSON'));
      }
    });
  });
}

export interface HttpServerHandle {
  server: Server;
  /** The address actually bound — the port differs from the request when 0. */
  port: number;
  close(): Promise<void>;
}

/**
 * @param makeServer  called once per request; must return a server that has
 *                    never been connected to a transport.
 */
export function createMcpRequestListener(
  getConfig: () => RuntimeConfig,
  makeServer: () => McpServer
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(req, res);
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const config = getConfig();
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`
    );
    if (url.pathname !== config.path) {
      sendJsonRpcError(
        res,
        404,
        JSONRPC_INVALID_REQUEST,
        `No MCP endpoint at ${url.pathname}. It is served at ${config.path}.`
      );
      return;
    }

    let body: unknown;
    try {
      body = req.method === 'POST' ? await readBody(req) : undefined;
    } catch (err) {
      const tooLarge = err instanceof RangeError;
      sendJsonRpcError(
        res,
        tooLarge ? 413 : 400,
        JSONRPC_INVALID_REQUEST,
        err instanceof Error ? err.message : 'unreadable request body'
      );
      return;
    }

    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      // Stateless: no session id, one transport per request. See the header.
      // The SDK's docs spell this `sessionIdGenerator: undefined`, which this
      // repo's `exactOptionalPropertyTypes` rejects; omitting the key reaches
      // the same field as undefined and the same `!sessionIdGenerator` branch.
      // Plain JSON rather than an SSE frame. No tool here streams, and a single
      // JSON body is what a plain HTTP client can read without an SSE parser.
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: config.allowedHosts,
      ...(config.allowedOrigins.length > 0
        ? { allowedOrigins: config.allowedOrigins }
        : {}),
    });

    // The pair is per-request, so it is torn down when the response is, whether
    // that is a clean end or a client that hung up mid-flight.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      // Cast: the SDK's own transport does not satisfy the SDK's own Transport
      // interface under `exactOptionalPropertyTypes` — its `onclose` accessor is
      // `(() => void) | undefined` against an optional `() => void`. A typing
      // gap upstream, not a mismatch in what is passed.
      await server.connect(
        transport as unknown as Parameters<McpServer['connect']>[0]
      );
      await transport.handleRequest(req, res, body);
    } catch (err) {
      process.stderr.write(
        `dgmo-mcp: request failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      sendJsonRpcError(
        res,
        500,
        JSONRPC_INTERNAL_ERROR,
        'Internal server error handling MCP request'
      );
    }
  }
}

export function startHttpServer(
  config: RuntimeConfig,
  makeServer: () => McpServer
): Promise<HttpServerHandle> {
  // The accept-list names a port, and the bound port is not known until listen
  // returns — asking for 0 means the OS chooses. So the listener reads the
  // config through a box that is refilled once the real port is in hand;
  // building it up front would refuse every request as a rebinding attempt.
  let active = config;
  const httpServer = createHttpServer(
    createMcpRequestListener(() => active, makeServer)
  );

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.removeListener('error', reject);
      const address = httpServer.address();
      const port =
        typeof address === 'object' && address ? address.port : config.port;
      active = {
        ...config,
        port,
        allowedHosts: deriveAllowedHosts(config.declaredHosts, port),
      };
      resolve({
        server: httpServer,
        port,
        close: () =>
          new Promise<void>((done, fail) =>
            httpServer.close((err) => (err ? fail(err) : done()))
          ),
      });
    });
  });
}
