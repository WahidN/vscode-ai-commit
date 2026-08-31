import { run } from './exec';

export interface DiffOptions {
  diffSource: 'staged' | 'stagedThenAll';
  maxDiffChars: number;
  excludeGlobs: string[];
}

export interface DiffResult {
  branch: string;
  /** Where the changes came from, shown to the model. */
  source: 'staged changes' | 'working tree (nothing staged)';
  /** git diff --stat over every changed file, never excluded, never truncated by globs. */
  stat: string;
  /** The patch the model reads. May be truncated. */
  patch: string;
  untracked: string[];
  truncated: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const res = await run('git', args, { cwd, timeoutMs: 20000 });
  if (res.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  return res.stdout;
}

function excludePathspecs(globs: string[]): string[] {
  return globs.filter(Boolean).map((g) => `:(exclude,glob)${g}`);
}

function limitLines(text: string, max: number): string {
  const lines = text.trimEnd().split('\n');
  if (lines.length <= max) return lines.join('\n');
  return [...lines.slice(0, max), `... and ${lines.length - max} more files`].join('\n');
}

export async function collectDiff(repoRoot: string, options: DiffOptions): Promise<DiffResult> {
  const branch = (await git(repoRoot, ['branch', '--show-current'])).trim() || '(detached HEAD)';
  const hasHead = (await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot })).code === 0;
  const excludes = excludePathspecs(options.excludeGlobs);

  const stagedStat = await git(repoRoot, ['diff', '--cached', '--stat', '--no-color']);
  let source: DiffResult['source'] = 'staged changes';
  let stat = stagedStat;
  let patchArgs = ['diff', '--cached', '-M', '--no-color', '-U3', '--', '.', ...excludes];

  if (!stagedStat.trim() && options.diffSource === 'stagedThenAll') {
    source = 'working tree (nothing staged)';
    const base = hasHead ? ['diff', 'HEAD'] : ['diff'];
    stat = await git(repoRoot, [...base, '--stat', '--no-color']);
    patchArgs = [...base, '-M', '--no-color', '-U3', '--', '.', ...excludes];
  }

  const untracked = (await git(repoRoot, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let patch = await git(repoRoot, patchArgs);
  const truncated = patch.length > options.maxDiffChars;
  if (truncated) {
    patch = `${patch.slice(0, options.maxDiffChars)}\n\n[patch truncated: showing ${options.maxDiffChars} of ${
      patch.length
    } characters]`;
  }

  return {
    branch,
    source,
    stat: limitLines(stat, 100),
    patch: patch.trim(),
    untracked: source === 'staged changes' ? [] : untracked.slice(0, 50),
    truncated
  };
}
