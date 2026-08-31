import { DiffResult } from './git';

export const SYSTEM_PROMPT =
  'You are a git commit message generator. You receive a git diff and reply with the commit message and nothing else. ' +
  'Never add a preamble, an explanation, quotes or code fences.';

export interface StyleOptions {
  language: 'english' | 'dutch';
  includeBody: boolean;
  template: string;
}

const TYPES = 'feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert';

function rules(style: StyleOptions): string {
  const language =
    style.language === 'dutch'
      ? '- Write the description in Dutch. Keep the type and scope in English. Do not use em dashes.'
      : '- Write the message in English. Do not use em dashes.';

  const body = style.includeBody
    ? '- After the subject, add one blank line and 1 to 4 bullet lines starting with "- ", each one short sentence about what changed and why. No file list.'
    : '- Output the subject line only. No body, no bullets.';

  return [
    `- Use Conventional Commits: type(scope): description`,
    `- Allowed types: ${TYPES}`,
    '- The scope is the touched area (module, feature or folder name). Only drop it when it cannot be assigned, then use "type: description".',
    '- Subject: imperative mood, at most 72 characters, lowercase after the colon, no trailing period.',
    '- Describe the change and its intent, not the file names.',
    '- For a breaking change use "type(scope)!: ..." and add a "BREAKING CHANGE: ..." line.',
    language,
    body,
    '- Reply with the commit message only.'
  ].join('\n');
}

export function buildPrompt(diff: DiffResult, style: StyleOptions): string {
  const untracked = diff.untracked.length
    ? `\nUntracked files (no patch available):\n${diff.untracked.join('\n')}\n`
    : '';

  if (style.template.trim()) {
    return style.template
      .replace(/\{\{rules\}\}/g, rules(style))
      .replace(/\{\{branch\}\}/g, diff.branch)
      .replace(/\{\{source\}\}/g, diff.source)
      .replace(/\{\{stat\}\}/g, diff.stat)
      .replace(/\{\{patch\}\}/g, diff.patch);
  }

  return [
    'Write a commit message for the changes below.',
    '',
    'Rules:',
    rules(style),
    '',
    `Branch: ${diff.branch}`,
    `Changes come from: ${diff.source}`,
    '',
    'Changed files:',
    diff.stat || '(none)',
    untracked,
    'Diff:',
    diff.patch || '(empty)'
  ].join('\n');
}

/** Models sometimes wrap the answer in fences or add a lead-in line. Strip that. */
export function sanitize(raw: string): string {
  let text = raw.trim();

  // Drop a lead-in line first, so a fence that follows it is still recognised.
  const lines = text.split('\n');
  if (lines.length > 1 && /^(here('|’|`)?s|here is|commit message)\b.*:$/i.test(lines[0].trim())) {
    text = lines.slice(1).join('\n').trim();
  }

  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();

  return text.replace(/\n{3,}/g, '\n\n').trim();
}
