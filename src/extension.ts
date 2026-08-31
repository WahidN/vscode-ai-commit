import * as path from 'path';
import * as vscode from 'vscode';
import { collectDiff, DiffOptions } from './git';
import { buildPrompt, StyleOptions, SYSTEM_PROMPT } from './prompt';
import { generateMessage, ProviderId, ProviderOptions } from './providers';

/** Minimal shape of the built-in vscode.git extension API that we use. */
interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}
interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository(listener: () => void): vscode.Disposable;
}

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('AI Commit Message');
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('aiCommit.generate', (sourceControl?: vscode.SourceControl) =>
      generate(sourceControl)
    )
  );
}

export function deactivate() {
  // Nothing to clean up: no long running processes are kept.
}

async function generate(sourceControl?: vscode.SourceControl) {
  try {
    const repo = await resolveRepository(sourceControl);
    if (!repo) return;

    const config = vscode.workspace.getConfiguration('aiCommit');
    const diffOptions: DiffOptions = {
      diffSource: config.get<'staged' | 'stagedThenAll'>('diffSource', 'stagedThenAll'),
      maxDiffChars: config.get<number>('maxDiffChars', 40000),
      excludeGlobs: config.get<string[]>('excludeGlobs', [])
    };

    const diff = await collectDiff(repo.rootUri.fsPath, diffOptions);
    if (!diff.patch && !diff.stat) {
      vscode.window.showInformationMessage('AI Commit: no changes to describe. Stage something first.');
      return;
    }

    const style: StyleOptions = {
      language: config.get<'english' | 'dutch'>('language', 'english'),
      includeBody: config.get<boolean>('includeBody', false),
      template: config.get<string>('promptTemplate', '')
    };
    const prompt = buildPrompt(diff, style);

    const provider = config.get<ProviderId>('provider', 'claude');
    const providerOptions: ProviderOptions = {
      provider,
      claudePath: config.get<string>('claudePath', 'claude'),
      codexPath: config.get<string>('codexPath', 'codex'),
      claudeModel: config.get<string>('claudeModel', 'sonnet'),
      codexModel: config.get<string>('codexModel', ''),
      codexArgs: config.get<string[]>('codexArgs', []),
      timeoutMs: config.get<number>('timeoutSeconds', 90) * 1000,
      log: (line) => line && output.appendLine(line)
    };

    output.appendLine(`\n--- ${new Date().toISOString()} ${path.basename(repo.rootUri.fsPath)} (${provider}) ---`);
    output.appendLine(prompt);

    const message = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl, title: 'Generating commit message' },
      () => generateMessage(prompt, SYSTEM_PROMPT, providerOptions)
    );

    output.appendLine(`--- message ---\n${message}`);
    repo.inputBox.value = message;
    await vscode.commands.executeCommand('workbench.view.scm');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.appendLine(`ERROR: ${message}`);
    const choice = await vscode.window.showErrorMessage(`AI Commit: ${message}`, 'Show log');
    if (choice === 'Show log') output.show(true);
  }
}

async function resolveRepository(sourceControl?: vscode.SourceControl): Promise<GitRepository | undefined> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!extension) throw new Error('the built-in Git extension is disabled.');
  const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);

  if (api.repositories.length === 0) throw new Error('no Git repository open in this window.');

  // Clicking the toolbar button hands us the source control it belongs to.
  const clicked = sourceControl?.rootUri?.toString();
  if (clicked) {
    const match = api.repositories.find((r) => r.rootUri.toString() === clicked);
    if (match) return match;
  }

  if (api.repositories.length === 1) return api.repositories[0];

  // Fall back to the repository that owns the active file, deepest root first.
  const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (activePath) {
    const owning = api.repositories
      .filter((r) => activePath.startsWith(r.rootUri.fsPath))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length);
    if (owning[0]) return owning[0];
  }

  const picked = await vscode.window.showQuickPick(
    api.repositories.map((repo) => ({
      label: path.basename(repo.rootUri.fsPath),
      description: repo.rootUri.fsPath,
      repo
    })),
    { placeHolder: 'Which repository?' }
  );
  return picked?.repo;
}
