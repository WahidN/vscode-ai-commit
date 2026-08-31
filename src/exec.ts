import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
}

/**
 * GUI apps on macOS do not inherit the PATH from your shell profile, so a CLI
 * installed in ~/.local/bin or /opt/homebrew/bin is invisible to a spawned
 * process. We append the usual install locations to PATH before spawning.
 */
function envWithToolPaths(): NodeJS.ProcessEnv {
  const extra = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.bun', 'bin'),
    path.join(os.homedir(), '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ];
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const merged = [...current, ...extra.filter((p) => !current.includes(p))];
  return { ...process.env, PATH: merged.join(path.delimiter) };
}

export function run(bin: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: envWithToolPaths(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(`Could not run "${bin}". Set its full path in the extension settings.`));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`"${bin}" timed out.`));
        return;
      }
      resolve({ code, stdout, stderr });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}
