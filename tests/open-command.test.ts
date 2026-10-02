// ============================================================
// open-command.test.ts — the openers never go through a shell.
//
// open_in_app's `filePath` is model-supplied, so prompt injection from any
// document the model read can steer it. It used to reach `exec` inside a
// JSON.stringify'd string, and /bin/sh expands $(...) and backticks even
// inside double quotes. Every opener now takes an argv array via execFile;
// these tests assert the hostile path arrives as ONE verbatim argument.
// ============================================================

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const { exec, execFile } = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  exec,
  execFile,
}));

import { server } from '../src/index.js';
import { openInBrowser } from '../src/open-browser.js';

const HOSTILE = '/tmp/a$(touch /tmp/pwn).dgmo';

const client = new Client({ name: 'open-command-test', version: '1.0.0' });

beforeAll(async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  exec.mockReset();
  execFile.mockReset();
  // Succeed: the callback is always the last argument.
  execFile.mockImplementation((...args: unknown[]) => {
    (args[args.length - 1] as (e: Error | null) => void)(null);
  });
});

describe('open_in_app', () => {
  it('passes a hostile filePath to `open` as one verbatim argument, with no shell', async () => {
    const res = (await client.callTool({
      name: 'open_in_app',
      arguments: { dgmo: 'pie T\nA 1', filePath: HOSTILE },
    })) as { isError?: boolean };

    expect(res.isError).toBeFalsy();
    expect(exec).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args] = execFile.mock.calls[0] as [string, string[]];
    expect(file).toBe('open');
    expect(args).toEqual(['-a', 'Diagrammo', HOSTILE]);
  });

  it('hands the deep link to `open` as one argument when no filePath is given', async () => {
    await client.callTool({
      name: 'open_in_app',
      arguments: { dgmo: 'pie T\nA 1' },
    });

    expect(exec).not.toHaveBeenCalled();
    const [file, args] = execFile.mock.calls[0] as [string, string[]];
    expect(file).toBe('open');
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/^diagrammo:\/\/open\?dgmo=/);
  });
});

describe('openInBrowser', () => {
  it.skipIf(process.platform === 'win32')(
    'passes the path to the opener as one verbatim argument, with no shell',
    async () => {
      await openInBrowser(HOSTILE);

      expect(exec).not.toHaveBeenCalled();
      const [file, args] = execFile.mock.calls[0] as [string, string[]];
      expect(file).toBe(process.platform === 'darwin' ? 'open' : 'xdg-open');
      expect(args).toEqual([HOSTILE]);
    }
  );
});
