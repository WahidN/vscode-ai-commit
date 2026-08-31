# AI Commit Message

Generates a commit message from your changes and drops it in the Source Control input box.
It runs your locally installed **Claude Code** or **Codex** CLI, so it uses your existing
subscription. No API key anywhere.

## How it works

```
sparkle button / command palette
        |
   extension.ts          asks the built-in vscode.git extension which repo, writes the result
        |                to repo.inputBox.value
   git.ts                spawns real git: --stat over every file, patch with junk paths excluded
        |
   prompt.ts             builds one text prompt: rules + branch + file list + patch
        |
   providers.ts          spawns `claude --print` (stdin) or `codex exec` (argv), parses the reply
```

Four things matter in that chain:

1. **Why a CLI instead of the API.** Your subscription login lives in the CLI (an OAuth token in
   the keychain), not in an API key. Shelling out to the CLI reuses that login, so generating a
   message costs nothing extra. Calling the Anthropic or OpenAI API directly would need a
   pay-per-token key, which is a different product.
2. **No tools, neutral working directory.** Claude runs with `--tools ""` and in a temp directory.
   It cannot read or write files, and no project `CLAUDE.md` / `AGENTS.md` leaks into the prompt.
   The extension collects the diff itself and hands over plain text, so the result is repeatable.
3. **PATH.** VS Code started from the Dock does not read your `.zshrc`, so `claude` in
   `~/.local/bin` would be invisible. `exec.ts` appends the usual install directories to `PATH`
   before spawning. If it still fails, set `aiCommit.claudePath` to the absolute path.
4. **Diff budget.** A patch is capped at `aiCommit.maxDiffChars` (40k) and lockfiles,
   `node_modules`, `dist` and minified files are kept out of the patch body. They still appear in
   the file list, so the model knows they changed without burning the budget on them.

## Use

Stage your changes, then click the sparkle in the Source Control title bar, or run
**AI Commit: Generate Commit Message** from the command palette. The message lands in the commit
box, where you can edit it before committing. Nothing is committed for you.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `aiCommit.provider` | `claude` | `claude` or `codex` |
| `aiCommit.claudePath` / `codexPath` | `claude` / `codex` | Absolute path if the CLI is not found |
| `aiCommit.claudeModel` | `sonnet` | Model alias for `claude --model`. Empty uses your default |
| `aiCommit.codexModel` | `` | Model for `codex exec -m` |
| `aiCommit.codexArgs` | `[]` | Extra `codex exec` flags |
| `aiCommit.language` | `english` | `english` or `dutch`. Type and scope stay English |
| `aiCommit.includeBody` | `false` | Add 1 to 4 bullet lines under the subject |
| `aiCommit.promptTemplate` | `` | Replace the prompt. `{{rules}} {{branch}} {{source}} {{stat}} {{patch}}` |
| `aiCommit.diffSource` | `stagedThenAll` | Or `staged` to never look at unstaged work |
| `aiCommit.maxDiffChars` | `40000` | Patch cap |
| `aiCommit.excludeGlobs` | lockfiles, node_modules, dist, min | Paths kept out of the patch body |
| `aiCommit.timeoutSeconds` | `90` | Kill the CLI after this long |

Output format follows Conventional Commits: `type(scope): description`, imperative, max 72
characters, no trailing period.

## Develop

```bash
npm install
npm run compile     # or npm run watch
```

Press F5 for an Extension Development Host window. `npm run package` builds a `.vsix`;
install it with `code --install-extension vscode-ai-commit-0.1.0.vsix`.

Every log line (the full prompt and the raw CLI reply) goes to the **AI Commit Message** output
channel, which is what the "Show log" button on an error opens.

## Codex status

The Claude path is tested. The Codex path is written against `codex exec --json` but was not run,
because the Codex CLI is not installed on this machine. If it misbehaves, check the output channel
and adjust `aiCommit.codexArgs`.
