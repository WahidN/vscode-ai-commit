import * as os from 'os';
import { run } from './exec';
import { sanitize } from './prompt';

export type ProviderId = 'claude' | 'codex';

export interface ProviderOptions {
  provider: ProviderId;
  claudePath: string;
  codexPath: string;
  claudeModel: string;
  codexModel: string;
  codexArgs: string[];
  timeoutMs: number;
  log: (line: string) => void;
}

/**
 * Both CLIs are already logged in to the user's own subscription, so we shell
 * out to them instead of calling an API with a key. We run in a temp directory
 * on purpose: the CLI never needs to see the repo, we hand it the diff, and a
 * neutral cwd keeps project CLAUDE.md / AGENTS.md files out of the prompt.
 */
export async function generateMessage(prompt: string, system: string, options: ProviderOptions): Promise<string> {
  const cwd = os.tmpdir();
  if (options.provider === 'codex') {
    return runCodex(prompt, system, options, cwd);
  }
  return runClaude(prompt, system, options, cwd);
}

async function runClaude(
  prompt: string,
  system: string,
  options: ProviderOptions,
  cwd: string
): Promise<string> {
  const args = [
    '--print',
    '--output-format',
    'json',
    // No tools: this is pure text generation, so nothing can read or write files.
    '--tools',
    '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--system-prompt',
    system
  ];
  if (options.claudeModel.trim()) args.push('--model', options.claudeModel.trim());

  options.log(`$ ${options.claudePath} ${args.map((a) => (a === '' ? '""' : a)).join(' ')}`);
  // The prompt goes over stdin so a large diff cannot hit the argument size limit.
  const res = await run(options.claudePath, args, { cwd, stdin: prompt, timeoutMs: options.timeoutMs });
  options.log(res.stderr.trim());

  let payload: { result?: string; is_error?: boolean; subtype?: string };
  try {
    payload = JSON.parse(res.stdout);
  } catch {
    if (res.code !== 0) throw new Error(claudeFailure(res.stderr, res.stdout));
    return sanitize(res.stdout);
  }

  if (payload.is_error || res.code !== 0) {
    throw new Error(claudeFailure(res.stderr, payload.result || payload.subtype || res.stdout));
  }
  if (!payload.result?.trim()) throw new Error('Claude returned an empty message.');
  return sanitize(payload.result);
}

function claudeFailure(stderr: string, detail: string): string {
  const text = `${stderr}\n${detail}`.toLowerCase();
  if (text.includes('login') || text.includes('not authenticated') || text.includes('invalid api key')) {
    return 'Claude CLI is not logged in. Run "claude" in a terminal once and finish the login.';
  }
  return `Claude CLI failed: ${(detail || stderr).trim().slice(0, 400)}`;
}

async function runCodex(
  prompt: string,
  system: string,
  options: ProviderOptions,
  cwd: string
): Promise<string> {
  const args = ['exec', '--json', '--skip-git-repo-check'];
  if (options.codexModel.trim()) args.push('-m', options.codexModel.trim());
  args.push(...options.codexArgs);
  // Codex exec takes the prompt as an argument; the diff is capped by maxDiffChars.
  args.push(`${system}\n\n${prompt}`);

  options.log(`$ ${options.codexPath} exec --json --skip-git-repo-check [prompt ${prompt.length} chars]`);
  const res = await run(options.codexPath, args, { cwd, timeoutMs: options.timeoutMs });
  options.log(res.stderr.trim());

  const message = parseCodexJsonl(res.stdout);
  if (!message) {
    throw new Error(`Codex CLI returned no message: ${(res.stderr || res.stdout).trim().slice(0, 400)}`);
  }
  return sanitize(message);
}

/** Codex streams JSONL events. Take the text of the last agent message. */
export function parseCodexJsonl(stdout: string): string | undefined {
  let last: string | undefined;
  const plain: string[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) {
      plain.push(trimmed);
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      const node = event.msg ?? event;
      if (node.type === 'item.completed' && node.item?.type === 'agent_message' && node.item.text) {
        last = node.item.text;
      } else if (node.type === 'agent_message' && (node.message || node.text)) {
        last = node.message ?? node.text;
      }
    } catch {
      plain.push(trimmed);
    }
  }

  return last ?? (plain.length ? plain.join('\n') : undefined);
}
