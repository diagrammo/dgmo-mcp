// ---------------------------------------------------------------------------
// Runtime configuration — which transport this process speaks, and on what.
//
// Kept apart from index.ts because the tool callbacks need to know the answer
// (a tool that opens a browser means something different when nobody is sitting
// at the machine), and index.ts is where the tools live. Parsing here keeps
// that dependency one-way.
// ---------------------------------------------------------------------------

export type TransportMode = 'stdio' | 'http';

export interface RuntimeConfig {
  mode: TransportMode;
  /** Interface to bind. Loopback unless the operator says otherwise. */
  host: string;
  port: number;
  /** URL path the MCP endpoint answers on. */
  path: string;
  /** Hostnames the operator named, before the port is known. */
  declaredHosts: string[];
  /** Host headers accepted, for DNS-rebinding protection. */
  allowedHosts: string[];
  /** Origin headers accepted. Empty means "don't police Origin". */
  allowedOrigins: string[];
  /**
   * True when the operator bound a non-loopback interface without naming the
   * hostnames it should answer to — the one combination that is both exposed
   * and unconfigured, so the caller warns rather than failing.
   */
  exposedWithoutAllowList: boolean;
}

export const DEFAULT_HTTP_PORT = 3333;
export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PATH = '/mcp';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** `--flag value` or `--flag=value`, last occurrence wins. */
function readOption(argv: string[], flag: string): string | undefined {
  let found: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) found = next;
    } else if (arg?.startsWith(`${flag}=`)) {
      found = arg.slice(flag.length + 1);
    }
  }
  return found;
}

/** Repeatable `--flag value`, collected in order. */
function readAllOptions(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) values.push(next);
    } else if (arg?.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return values;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isHttpRequested(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes('--http')) return true;
  const transport = (
    readOption(argv, '--transport') ??
    env['MCP_TRANSPORT'] ??
    ''
  ).toLowerCase();
  return transport === 'http' || transport === 'streamable-http';
}

/**
 * A Host header carries the port, so the accept-list can only be built once the
 * port is settled. Asking for port 0 — or any case where the bound port is not
 * the requested one — otherwise produces a list naming a port nothing listens
 * on, and every request is refused as a rebinding attempt.
 *
 * Loopback names are always accepted: they are how the operator's own client
 * reaches a server bound to loopback, and a rebinding attack cannot forge them
 * without already being on the machine.
 */
export function deriveAllowedHosts(
  declaredHosts: string[],
  port: number
): string[] {
  const loopbackNames = ['localhost', '127.0.0.1', '[::1]'];
  return Array.from(
    new Set([
      ...loopbackNames.flatMap((name) => [name, `${name}:${port}`]),
      ...declaredHosts.flatMap((h) => [h, `${h}:${port}`]),
    ])
  );
}

/**
 * Both spellings are accepted for every setting — a flag for a client that
 * spawns a command line, an environment variable for a container that doesn't.
 * The two ask for the same thing, so the flag wins where both are present.
 */
export function parseRuntimeConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const mode: TransportMode = isHttpRequested(argv, env) ? 'http' : 'stdio';

  const rawPort = readOption(argv, '--port') ?? env['MCP_PORT'];
  const parsedPort = rawPort === undefined ? NaN : Number.parseInt(rawPort, 10);
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
      ? parsedPort
      : DEFAULT_HTTP_PORT;

  const host =
    readOption(argv, '--host') ?? env['MCP_HOST'] ?? DEFAULT_HTTP_HOST;

  const rawPath =
    readOption(argv, '--path') ?? env['MCP_PATH'] ?? DEFAULT_HTTP_PATH;
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  const declaredHosts = [
    ...readAllOptions(argv, '--allow-host'),
    ...splitList(env['MCP_ALLOWED_HOSTS']),
  ];
  const allowedOrigins = [
    ...readAllOptions(argv, '--allow-origin'),
    ...splitList(env['MCP_ALLOWED_ORIGINS']),
  ];

  const boundToLoopback = LOOPBACK_HOSTS.has(host);

  return {
    mode,
    host,
    port,
    path,
    declaredHosts,
    allowedHosts: deriveAllowedHosts(declaredHosts, port),
    allowedOrigins,
    exposedWithoutAllowList:
      mode === 'http' &&
      !boundToLoopback &&
      declaredHosts.length === 0 &&
      allowedOrigins.length === 0,
  };
}

export const USAGE = `dgmo MCP server

  dgmo-mcp                       speak MCP over stdio (default)
  dgmo-mcp --http                speak MCP over streamable HTTP

HTTP options (flag, or environment variable):
  --port <n>          MCP_PORT              default ${DEFAULT_HTTP_PORT}
  --host <addr>       MCP_HOST              default ${DEFAULT_HTTP_HOST} (loopback)
  --path <path>       MCP_PATH              default ${DEFAULT_HTTP_PATH}
  --allow-host <h>    MCP_ALLOWED_HOSTS     extra Host headers to accept (repeatable)
  --allow-origin <o>  MCP_ALLOWED_ORIGINS   Origin headers to accept (repeatable)

In HTTP mode the four tools that act on the machine the server runs on
(open_in_app, check_app_installed, preview_diagram, generate_report) are not
offered, because over a network they would act on the server rather than on
the person asking.

The server has no authentication of its own. Bind loopback, or put your own
auth in front of it.
`;
