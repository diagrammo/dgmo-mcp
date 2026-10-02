import { execFile, type ExecFileOptions } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Open a file path in the default browser. Cross-platform.
 *
 * argv, never a shell string: `filePath` reaches the opener as one argument,
 * so `$(...)` or backticks in it are never run.
 */
export function openInBrowser(filePath: string): Promise<void> {
  const os = platform();
  let cmd = os === 'darwin' ? 'open' : 'xdg-open';
  let args = [filePath];
  const options: ExecFileOptions = {};
  if (os === 'win32') {
    // `start` is a cmd builtin, so cmd has to parse this line. Verbatim keeps
    // Node from re-quoting the empty title; `"` cannot occur in a Windows
    // path, so the quoted path cannot be closed early.
    cmd = 'cmd';
    args = ['/c', 'start', '""', `"${filePath}"`];
    options.windowsVerbatimArguments = true;
  }

  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
