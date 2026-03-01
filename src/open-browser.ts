import { exec } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Open a file path in the default browser. Cross-platform.
 */
export function openInBrowser(filePath: string): Promise<void> {
  const os = platform();
  const cmd =
    os === 'darwin' ? 'open' : os === 'win32' ? 'start ""' : 'xdg-open';

  return new Promise((resolve, reject) => {
    exec(`${cmd} ${JSON.stringify(filePath)}`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
