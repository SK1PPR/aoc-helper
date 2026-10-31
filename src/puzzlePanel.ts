import * as vscode from 'vscode';
import { AocClient, Puzzle } from './api';
import { DayFiles } from './workspace';
import { webviewHtml } from './webview';
import { DayRef, errorMessage, escapeHtml, sameRef } from './util';

const COMMANDS: Record<string, string> = {
  browser: 'aoc.openInBrowser',
  input: 'aoc.fetchInput',
  solution: 'aoc.openSolution',
  runSamples: 'aoc.runSamples',
  runInput: 'aoc.runInput',
  submit: 'aoc.submit',
};

const CSS = `
  article h2 { font-size: 1.15em; margin-top: 1.4em; }
  em { font-style: normal; font-weight: 700; color: var(--vscode-editor-foreground); }
  em.star { color: var(--vscode-charts-yellow); }
  span[title] { cursor: help; }
  .stars { font-size: 1.2em; letter-spacing: 2px; margin-right: 6px; }
  .answer code { color: var(--vscode-charts-yellow); }
  .pre-wrap { position: relative; }
  .save-sample { position: absolute; top: 6px; right: 6px; opacity: 0; font-size: 0.85em; transition: opacity .1s; }
  .pre-wrap:hover .save-sample { opacity: 1; }
`;

// Puts a "Save as sample" button on every example block.
const SCRIPT = `
  for (const pre of document.querySelectorAll('article pre')) {
    const wrap = document.createElement('div');
    wrap.className = 'pre-wrap';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'save-sample';
    btn.textContent = 'Save as sample';
    btn.title = 'Save this block as a sample input for the day';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ cmd: 'saveSample', text: pre.textContent });
    });
    wrap.appendChild(btn);
  }
`;

export class PuzzlePanel {
  static current: PuzzlePanel | undefined;

  ref: DayRef | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static async show(api: AocClient, files: DayFiles, ref: DayRef, log: (msg: string) => void): Promise<void> {
    if (PuzzlePanel.current) {
      PuzzlePanel.current.panel.reveal(undefined, false);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'aoc.puzzle',
        'Advent of Code',
        vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
        { enableScripts: true, enableFindWidget: true, localResourceRoots: [] },
      );
      PuzzlePanel.current = new PuzzlePanel(panel, api, files, log);
    }
    await PuzzlePanel.current.load(ref);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly api: AocClient,
    private readonly files: DayFiles,
    private readonly log: (msg: string) => void,
  ) {
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  async load(ref: DayRef, force = false): Promise<void> {
    if (!sameRef(this.ref, ref)) {
      this.panel.title = `AoC ${ref.year} · Day ${ref.day}`;
      this.panel.webview.html = webviewHtml(this.panel.webview, '<p class="muted">Loading puzzle…</p>');
    }
    this.ref = ref;
    try {
      const puzzle = await this.api.getPuzzle(ref, force);
      if (!sameRef(this.ref, ref)) {
        return;
      }
      const signedIn = !!(await this.api.getSession());
      this.panel.title = `${ref.day}: ${puzzle.title}`;
      this.panel.webview.html = this.render(puzzle, signedIn);
      void this.prepareFiles(ref, puzzle, signedIn);
    } catch (e) {
      this.panel.webview.html = webviewHtml(
        this.panel.webview,
        `<p class="error">${escapeHtml(errorMessage(e))}</p><button data-cmd="refresh">Retry</button>`,
      );
    }
  }

  private async prepareFiles(ref: DayRef, puzzle: Puzzle, signedIn: boolean): Promise<void> {
    if (!signedIn || !vscode.workspace.workspaceFolders?.length || !vscode.workspace.getConfiguration('aoc').get('autoFetchInput', true)) {
      return;
    }
    try {
      await this.files.ensureInput(ref);
      await this.files.ensureSample(ref, puzzle);
    } catch (e) {
      this.log(`Couldn't prepare files for ${ref.year} day ${ref.day}: ${errorMessage(e)}`);
    }
  }

  private async onMessage(msg: { cmd?: string; level?: number; text?: string }): Promise<void> {
    const ref = this.ref;
    if (!ref) {
      return;
    }
    if (msg.cmd === 'refresh') {
      return this.load(ref, true);
    }
    if (msg.cmd === 'saveSample' && typeof msg.text === 'string') {
      try {
        const uri = await this.files.addSample(ref, msg.text);
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: false });
      } catch (e) {
        void vscode.window.showErrorMessage(errorMessage(e));
      }
      return;
    }
    const command = msg.cmd && COMMANDS[msg.cmd];
    if (command) {
      await vscode.commands.executeCommand(command, ref, msg.level);
    }
  }

  private render(p: Puzzle, signedIn: boolean): string {
    const solved = p.complete ? 2 : p.answers.length;
    const pageUrl = `https://adventofcode.com/${p.year}/day/${p.day}`;
    // Make the puzzle's relative links (inputs, other days, wiki pages) absolute.
    const absolutize = (html: string) =>
      html.replace(/\b(href|src)="([^"]*)"/g, (_m, attr: string, url: string) => {
        try {
          return `${attr}="${escapeHtml(new URL(url, pageUrl).href)}"`;
        } catch {
          return `${attr}="${url}"`;
        }
      });

    const parts = p.parts
      .map(
        (part, i) =>
          `<article>${absolutize(part)}</article>` +
          (p.answers[i] ? `<p class="answer">Your puzzle answer was <code>${escapeHtml(p.answers[i])}</code>.</p>` : ''),
      )
      .join('');

    const submit =
      signedIn && solved < 2
        ? `<button class="primary" data-cmd="submit" data-level="${solved + 1}">Submit Part ${solved + 1}</button>`
        : '';
    const header = `<header>
      <span class="stars gold" title="${solved}/2 stars">${'★'.repeat(solved)}<span class="none">${'★'.repeat(2 - solved)}</span></span>
      <button data-cmd="solution">Open Solution</button>
      <button data-cmd="input">Input</button>
      <button data-cmd="runSamples">▶ Samples</button>
      <button data-cmd="runInput">▶ Input</button>
      ${submit}
      <span class="spacer"></span>
      <button data-cmd="refresh" title="Reload puzzle">⟳</button>
      <button data-cmd="browser" title="Open on adventofcode.com">↗</button>
    </header>`;
    const notes = [
      signedIn ? '' : '<p class="muted">Sign in to see part two, download your input and submit answers.</p>',
      p.complete ? '<p class="answer gold">Both parts of this puzzle are complete! ★★</p>' : '',
    ].join('');

    return webviewHtml(this.panel.webview, header + parts + notes, CSS, SCRIPT);
  }

  private dispose(): void {
    PuzzlePanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
