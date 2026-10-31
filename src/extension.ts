import * as vscode from 'vscode';
import * as path from 'path';
import { AocClient } from './api';
import { Countdown } from './countdown';
import { Board, LeaderboardPanel } from './leaderboardPanel';
import { PuzzlePanel } from './puzzlePanel';
import { BoardNode, LeaderboardTree, PuzzleTree } from './trees';
import { DayFiles, isPlaceholderAnswer, parseAnswers, runSolution } from './workspace';
import {
  DayRef,
  FIRST_YEAR,
  daysInYear,
  errorMessage,
  formatMs,
  isUnlocked,
  latestYear,
  refLabel,
  sameRef,
  unlockTime,
} from './util';

export function activate(ctx: vscode.ExtensionContext): void {
  const api = new AocClient(ctx.secrets, ctx.globalState);
  const files = new DayFiles(api);
  const out = vscode.window.createOutputChannel('Advent of Code');
  const log = (msg: string) => out.appendLine(msg);
  const puzzles = new PuzzleTree(api);
  const boards = new LeaderboardTree(ctx.globalState);
  // Answers parsed from the last run on the real input, keyed by "year-day".
  const lastAnswers = new Map<string, (string | undefined)[]>();
  const key = (ref: DayRef) => `${ref.year}-${ref.day}`;

  const updateSignedIn = async () =>
    vscode.commands.executeCommand('setContext', 'aoc.signedIn', !!(await api.getSession()));
  const updateDayContext = () => {
    const doc = vscode.window.activeTextEditor?.document;
    void vscode.commands.executeCommand('setContext', 'aoc.inDay', !!(doc && files.refFromUri(doc.uri)));
  };

  const command = (id: string, fn: (...args: any[]) => unknown) =>
    ctx.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (e) {
          void vscode.window.showErrorMessage(errorMessage(e));
        }
      }),
    );

  async function pickDay(): Promise<DayRef | undefined> {
    const years: string[] = [];
    for (let y = latestYear(); y >= FIRST_YEAR; y--) {
      years.push(String(y));
    }
    const year = await vscode.window.showQuickPick(years, { title: 'Advent of Code', placeHolder: 'Year' });
    if (!year) {
      return undefined;
    }
    const titles = api.titles();
    const days: (vscode.QuickPickItem & { day: number })[] = [];
    for (let d = 1; d <= daysInYear(Number(year)); d++) {
      if (isUnlocked(Number(year), d)) {
        days.push({ label: `Day ${d}`, description: titles[`${year}-${d}`], day: d });
      }
    }
    const day = await vscode.window.showQuickPick(days, { title: `Advent of Code ${year}`, placeHolder: 'Day' });
    return day && { year: Number(year), day: day.day };
  }

  /** Day from an explicit argument, the active editor, the open puzzle, or a picker. */
  async function resolveRef(arg: unknown): Promise<DayRef | undefined> {
    const a = arg as Partial<DayRef> | undefined;
    if (a && typeof a.year === 'number' && typeof a.day === 'number') {
      return { year: a.year, day: a.day };
    }
    const doc = vscode.window.activeTextEditor?.document;
    const fromEditor = doc && files.refFromUri(doc.uri);
    if (fromEditor) {
      return fromEditor;
    }
    if (PuzzlePanel.current?.ref && PuzzlePanel.current.visible) {
      return PuzzlePanel.current.ref;
    }
    return pickDay();
  }

  async function refreshAfterSolve(ref: DayRef): Promise<void> {
    puzzles.refresh();
    if (sameRef(PuzzlePanel.current?.ref, ref)) {
      await PuzzlePanel.current!.load(ref, true);
    }
  }

  async function submit(ref: DayRef, level?: number, answer?: string): Promise<void> {
    const puzzle = await api.getPuzzle(ref).catch(() => undefined);
    const solved = puzzle ? (puzzle.complete ? 2 : puzzle.answers.length) : 0;
    level ??= Math.min(solved + 1, 2);
    if (solved >= level) {
      const known = puzzle?.answers[level - 1];
      void vscode.window.showInformationMessage(`You've already solved part ${level}${known ? ` (${known})` : ''}.`);
      return;
    }
    if (answer === undefined) {
      const guess = lastAnswers.get(key(ref))?.[level - 1];
      answer = await vscode.window.showInputBox({
        title: `Submit ${refLabel(ref)} · Part ${level}`,
        prompt: 'Your answer',
        value: isPlaceholderAnswer(guess) ? '' : guess,
        ignoreFocusOut: true,
      });
    }
    answer = answer?.trim();
    if (!answer) {
      return;
    }
    const previous = api.previousAttempt(ref, level, answer);
    if (previous) {
      void vscode.window.showWarningMessage(`You already submitted "${answer}" for part ${level}: ${previous}`);
      return;
    }
    const submitted = answer;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Submitting "${submitted}" for ${refLabel(ref)} part ${level}…` },
      () => api.submit(ref, level!, submitted),
    );
    switch (result.status) {
      case 'correct':
        void vscode.window.showInformationMessage(`⭐ ${result.message}`);
        await refreshAfterSolve(ref);
        break;
      case 'incorrect':
        void vscode.window.showErrorMessage(result.message);
        break;
      case 'wait':
        void vscode.window.showWarningMessage(result.message);
        break;
      default:
        void vscode.window.showInformationMessage(result.message);
        await refreshAfterSolve(ref);
    }
  }

  async function run(arg: unknown, kind: 'samples' | 'input'): Promise<void> {
    const ref = await resolveRef(arg);
    if (!ref) {
      return;
    }
    const solution = await files.findSolution(ref);
    if (!solution) {
      const create = await vscode.window.showWarningMessage(`No solution file for ${refLabel(ref)} yet.`, 'Create Solution');
      if (create) {
        await vscode.commands.executeCommand('aoc.openSolution', ref);
      }
      return;
    }
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === solution.uri.toString());
    if (doc?.isDirty) {
      await doc.save();
    }

    let inputs: vscode.Uri[];
    if (kind === 'input') {
      inputs = [await files.ensureInput(ref)];
    } else {
      inputs = await files.sampleUris(ref);
      if (!inputs.length) {
        const puzzle = await api.getPuzzle(ref).catch(() => undefined);
        if (puzzle) {
          await files.ensureSample(ref, puzzle);
        }
        inputs = await files.sampleUris(ref);
      }
      if (!inputs.length) {
        const dir = vscode.workspace.asRelativePath(files.dir(ref));
        void vscode.window.showWarningMessage(
          `No samples found. Create ${dir}/sample.txt, or hover a code block in the puzzle and click "Save as sample".`,
        );
        return;
      }
    }

    out.clear();
    out.show(true);
    const timeoutMs = vscode.workspace.getConfiguration('aoc').get<number>('runTimeoutSeconds', 60) * 1000;
    let answers: (string | undefined)[] | undefined;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Running ${refLabel(ref)} on ${kind}`, cancellable: true },
      async (_progress, token) => {
        for (const input of inputs) {
          if (token.isCancellationRequested) {
            break;
          }
          out.appendLine(`▶ ${path.basename(solution.uri.fsPath)} ← ${path.basename(input.fsPath)}`);
          const r = await runSolution(ref, solution, input, out, token, timeoutMs);
          const status = r.stopped ? 'stopped' : `exit code ${r.exitCode}`;
          out.appendLine(`${r.endsWithNewline ? '' : '\n'}■ ${status} · ${formatMs(r.ms)}\n`);
          if (kind === 'input' && r.exitCode === 0) {
            answers = parseAnswers(r.stdout);
          }
        }
      },
    );
    if (answers?.length) {
      lastAnswers.set(key(ref), answers);
      await offerSubmit(ref, answers);
    }
  }

  async function offerSubmit(ref: DayRef, answers: (string | undefined)[]): Promise<void> {
    const puzzle = api.cachedPuzzle(ref);
    const solved = puzzle ? (puzzle.complete ? 2 : puzzle.answers.length) : 0;
    const summary = answers
      .map((a, i) => (a === undefined ? undefined : `Part ${i + 1}: ${a}`))
      .filter(Boolean)
      .join('  ·  ');
    const level = solved + 1;
    const candidate = answers[level - 1];
    const action = level <= 2 && !isPlaceholderAnswer(candidate) ? `Submit Part ${level}` : undefined;
    const pick = await vscode.window.showInformationMessage(`${refLabel(ref)} → ${summary}`, ...(action ? [action] : []));
    if (pick) {
      await submit(ref, level, candidate);
    }
  }

  command('aoc.signIn', async () => {
    const value = await vscode.window.showInputBox({
      title: 'Advent of Code: Sign In',
      prompt: 'Paste the value of the "session" cookie from adventofcode.com (browser DevTools → Application/Storage → Cookies).',
      password: true,
      ignoreFocusOut: true,
    });
    const session = value?.trim().replace(/^session=/, '');
    if (!session) {
      return;
    }
    const user = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Checking session…' },
      () => api.getUser(session),
    );
    if (!user) {
      throw new Error("That session cookie didn't work. Make sure you're logged in and copied the whole value.");
    }
    await api.setSession(session);
    await updateSignedIn();
    puzzles.refresh();
    boards.refresh();
    const contactMissing = !vscode.workspace.getConfiguration('aoc').get<string>('contact', '').trim();
    const pick = await vscode.window.showInformationMessage(
      `Signed in to Advent of Code as ${user}.` +
        (contactMissing ? ' AoC asks automated tools to include contact info in their User-Agent — consider setting aoc.contact.' : ''),
      ...(contactMissing ? ['Set Contact'] : []),
    );
    if (pick) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'aoc.contact');
    }
  });

  command('aoc.signOut', async () => {
    await api.setSession(undefined);
    await updateSignedIn();
    puzzles.refresh();
    boards.refresh();
    void vscode.window.showInformationMessage('Signed out of Advent of Code.');
  });

  command('aoc.refresh', async () => {
    await api.invalidateStars();
    puzzles.refresh();
    boards.refresh();
  });

  command('aoc.openPuzzle', async (arg?: unknown) => {
    const ref = arg ? await resolveRef(arg) : await pickDay();
    if (ref) {
      await PuzzlePanel.show(api, files, ref, log);
    }
  });

  command('aoc.openToday', async () => {
    const now = Date.now();
    const year = latestYear(now);
    let day = 0;
    for (let d = 1; d <= daysInYear(year); d++) {
      if (isUnlocked(year, d, now)) {
        day = d;
      }
    }
    // During the event, jump straight to the newest puzzle; otherwise let the user choose.
    const ref = day && now - unlockTime(year, day) < 36 * 3600_000 ? { year, day } : await pickDay();
    if (ref) {
      await PuzzlePanel.show(api, files, ref, log);
    }
  });

  command('aoc.fetchInput', async (arg?: unknown) => {
    const ref = await resolveRef(arg);
    if (ref) {
      const uri = await files.ensureInput(ref);
      await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: true });
    }
  });

  command('aoc.openSolution', async (arg?: unknown) => {
    const ref = await resolveRef(arg);
    if (!ref) {
      return;
    }
    const uri = await files.ensureSolution(ref);
    if (await api.getSession()) {
      await files.ensureInput(ref).catch((e) => log(`Couldn't download input: ${errorMessage(e)}`));
      const puzzle = await api.getPuzzle(ref).catch(() => undefined);
      if (puzzle) {
        await files.ensureSample(ref, puzzle);
      }
    }
    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: false });
  });

  command('aoc.runSamples', (arg?: unknown) => run(arg, 'samples'));
  command('aoc.runInput', (arg?: unknown) => run(arg, 'input'));

  command('aoc.submit', async (arg?: unknown, level?: number) => {
    const ref = await resolveRef(arg);
    if (ref) {
      await submit(ref, typeof level === 'number' ? level : undefined);
    }
  });

  command('aoc.openInBrowser', async (arg?: unknown) => {
    const ref = await resolveRef(arg);
    if (ref) {
      await vscode.env.openExternal(vscode.Uri.parse(`https://adventofcode.com/${ref.year}/day/${ref.day}`));
    }
  });

  command('aoc.openLeaderboard', (board: Board) => {
    LeaderboardPanel.show(api, board, (id, name) => void boards.rememberOwner(id, name));
  });

  command('aoc.addLeaderboard', async () => {
    const value = await vscode.window.showInputBox({
      title: 'Add Private Leaderboard',
      prompt: 'Leaderboard ID (the number in its URL, e.g. /leaderboard/private/view/123456) or a join code',
      validateInput: (v) => (/^\s*\d+(-[0-9a-f]+)?\s*$/i.test(v) ? undefined : 'Expected a number like 123456 or a join code like 123456-abc123'),
      ignoreFocusOut: true,
    });
    const id = value?.trim().split('-')[0];
    if (!id) {
      return;
    }
    const config = vscode.workspace.getConfiguration('aoc');
    const current = config.get<string[]>('privateLeaderboards', []);
    if (!current.some((s) => String(s).split('-')[0] === id)) {
      await config.update('privateLeaderboards', [...current, id], vscode.ConfigurationTarget.Global);
    }
    LeaderboardPanel.show(api, { kind: 'private', id }, (bid, name) => void boards.rememberOwner(bid, name));
  });

  command('aoc.removeLeaderboard', async (node?: BoardNode) => {
    if (node?.board.kind !== 'private') {
      return;
    }
    const id = node.board.id;
    const config = vscode.workspace.getConfiguration('aoc');
    const remaining = config.get<string[]>('privateLeaderboards', []).filter((s) => String(s).split('-')[0] !== id);
    await config.update('privateLeaderboards', remaining, vscode.ConfigurationTarget.Global);
  });

  ctx.subscriptions.push(
    out,
    vscode.window.registerTreeDataProvider('aoc.puzzles', puzzles),
    vscode.window.registerTreeDataProvider('aoc.leaderboards', boards),
    vscode.window.onDidChangeActiveTextEditor(updateDayContext),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aoc.privateLeaderboards')) {
        boards.refresh();
      }
      if (e.affectsConfiguration('aoc.folderTemplate')) {
        updateDayContext();
      }
    }),
    ctx.secrets.onDidChange(() => void updateSignedIn()),
    new Countdown(async (ref) => {
      puzzles.refresh();
      const pick = await vscode.window.showInformationMessage(`🎄 ${refLabel(ref)} is unlocked!`, 'Open Puzzle');
      if (pick) {
        await PuzzlePanel.show(api, files, ref, log);
      }
    }),
  );

  void updateSignedIn();
  updateDayContext();
}

export function deactivate(): void {}
