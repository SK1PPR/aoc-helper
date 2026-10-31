import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { AocClient, Puzzle } from './api';
import { TEMPLATES } from './templates';
import { DayRef, decodeEntities, pad2, stripTags } from './util';

export interface LanguageConfig {
  extension: string;
  run: string;
  template?: string;
}

export interface Solution {
  uri: vscode.Uri;
  language: LanguageConfig;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  stopped: boolean;
  endsWithNewline: boolean;
}

function config() {
  return vscode.workspace.getConfiguration('aoc');
}

function languages(): Record<string, LanguageConfig> {
  return config().get<Record<string, LanguageConfig>>('languages', {});
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

/** Files for each day live in a folder derived from `aoc.folderTemplate`. */
export class DayFiles {
  constructor(private readonly api: AocClient) {}

  root(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('Open a folder first — puzzle inputs and solutions are stored in the workspace.');
    }
    return folder.uri;
  }

  dir(ref: DayRef): vscode.Uri {
    const rel = this.template()
      .replace(/\$\{year\}/g, String(ref.year))
      .replace(/\$\{dd\}/g, pad2(ref.day))
      .replace(/\$\{day\}/g, String(ref.day));
    return vscode.Uri.joinPath(this.root(), ...rel.split('/'));
  }

  /** The day a file belongs to, if it sits inside a day folder. */
  refFromUri(uri: vscode.Uri): DayRef | undefined {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root || uri.scheme !== 'file') {
      return undefined;
    }
    const rel = path.relative(root.uri.fsPath, uri.fsPath).split(path.sep).join('/');
    const groups: ('year' | 'day')[] = [];
    const pattern = this.template()
      .split(/(\$\{(?:year|dd|day)\})/)
      .map((part) => {
        switch (part) {
          case '${year}':
            groups.push('year');
            return '(\\d{4})';
          case '${dd}':
            groups.push('day');
            return '(\\d{2})';
          case '${day}':
            groups.push('day');
            return '(\\d{1,2})';
          default:
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
      })
      .join('');
    const match = new RegExp(`^${pattern}(?:/|$)`).exec(rel);
    if (!match) {
      return undefined;
    }
    const ref: Partial<DayRef> = {};
    groups.forEach((g, i) => (ref[g] = Number(match[i + 1])));
    return ref.year && ref.day ? (ref as DayRef) : undefined;
  }

  inputUri(ref: DayRef): vscode.Uri {
    return vscode.Uri.joinPath(this.dir(ref), 'input.txt');
  }

  /** Downloads the input once; it never changes, so later calls use the local file. */
  async ensureInput(ref: DayRef): Promise<vscode.Uri> {
    const uri = this.inputUri(ref);
    if (!(await exists(uri))) {
      await writeText(uri, await this.api.getInput(ref));
    }
    return uri;
  }

  async sampleUris(ref: DayRef): Promise<vscode.Uri[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.dir(ref));
      return entries
        .filter(([name, type]) => type === vscode.FileType.File && /^sample.*\.txt$/i.test(name))
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => vscode.Uri.joinPath(this.dir(ref), name));
    } catch {
      return [];
    }
  }

  /** Writes the first code block of part one to sample.txt, unless samples already exist. */
  async ensureSample(ref: DayRef, puzzle: Puzzle): Promise<void> {
    if ((await this.sampleUris(ref)).length) {
      return;
    }
    const block = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(puzzle.parts[0] ?? '');
    if (block) {
      await writeText(vscode.Uri.joinPath(this.dir(ref), 'sample.txt'), decodeEntities(stripTags(block[1])));
    }
  }

  async addSample(ref: DayRef, text: string): Promise<vscode.Uri> {
    const taken = new Set((await this.sampleUris(ref)).map((u) => path.basename(u.fsPath)));
    let name = 'sample.txt';
    for (let n = 2; taken.has(name); n++) {
      name = `sample${n}.txt`;
    }
    const uri = vscode.Uri.joinPath(this.dir(ref), name);
    await writeText(uri, text);
    return uri;
  }

  /** Existing solution file, preferring the configured language. */
  async findSolution(ref: DayRef): Promise<Solution | undefined> {
    const langs = languages();
    const preferred = config().get<string>('language', 'python');
    const ids = [preferred, ...Object.keys(langs).filter((id) => id !== preferred)];
    for (const id of ids) {
      const language = langs[id];
      if (!language) {
        continue;
      }
      const uri = vscode.Uri.joinPath(this.dir(ref), `solution.${language.extension}`);
      if (await exists(uri)) {
        return { uri, language };
      }
    }
    return undefined;
  }

  async ensureSolution(ref: DayRef): Promise<vscode.Uri> {
    const found = await this.findSolution(ref);
    if (found) {
      return found.uri;
    }
    const id = config().get<string>('language', 'python');
    const language = languages()[id];
    if (!language) {
      throw new Error(`Language "${id}" is not defined in aoc.languages.`);
    }
    let template = TEMPLATES[id] ?? '';
    if (language.template) {
      const templateUri = path.isAbsolute(language.template)
        ? vscode.Uri.file(language.template)
        : vscode.Uri.joinPath(this.root(), language.template);
      template = Buffer.from(await vscode.workspace.fs.readFile(templateUri)).toString('utf8');
    }
    const uri = vscode.Uri.joinPath(this.dir(ref), `solution.${language.extension}`);
    await writeText(uri, template.replace(/\{\{year\}\}/g, String(ref.year)).replace(/\{\{day\}\}/g, String(ref.day)));
    return uri;
  }

  private template(): string {
    return config().get<string>('folderTemplate', 'aoc/${year}/day${dd}').replace(/^\/+|\/+$/g, '');
  }
}

/** Runs the solution's command with the input file as argument and on stdin, streaming output. */
export function runSolution(
  ref: DayRef,
  solution: Solution,
  input: vscode.Uri,
  out: vscode.OutputChannel,
  token: vscode.CancellationToken,
  timeoutMs: number,
): Promise<RunResult> {
  const cwd = path.dirname(solution.uri.fsPath);
  const vars: Record<string, string> = {
    file: solution.uri.fsPath,
    input: input.fsPath,
    dir: cwd,
    year: String(ref.year),
    day: String(ref.day),
  };
  const command = solution.language.run.replace(/\$\{(\w+)\}/g, (m, key: string) => vars[key] ?? m);
  const posix = process.platform !== 'win32';

  return new Promise((resolve) => {
    const start = Date.now();
    // On POSIX, run in its own process group so compile-and-run chains can be killed as a whole.
    const child = spawn(command, { cwd, shell: true, detached: posix });
    let stdout = '';
    let stderr = '';
    let last = '\n';
    let stopped = false;

    const write = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const text = chunk.toString();
      if (target === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
      if (text) {
        last = text[text.length - 1];
      }
      out.append(text);
    };
    child.stdout.on('data', (c: Buffer) => write(c, 'stdout'));
    child.stderr.on('data', (c: Buffer) => write(c, 'stderr'));
    child.stdin.on('error', () => undefined);
    createReadStream(input.fsPath)
      .on('error', () => child.stdin.end())
      .pipe(child.stdin);

    const stop = () => {
      stopped = true;
      try {
        if (posix && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill();
        }
      } catch {
        // already exited
      }
    };
    const timer = setTimeout(stop, timeoutMs);
    const cancel = token.onCancellationRequested(stop);

    child.on('error', (err) => {
      stderr += String(err);
      out.appendLine(String(err));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      cancel.dispose();
      resolve({ exitCode, stdout, stderr, ms: Date.now() - start, stopped, endsWithNewline: last === '\n' });
    });
  });
}

/**
 * Answers from a solution's output: "Part 1: x" / "Part 2: y" lines if present,
 * otherwise the last two non-empty lines.
 */
export function parseAnswers(stdout: string): (string | undefined)[] {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const answers: (string | undefined)[] = [];
  for (const line of lines) {
    const m = /^part\s*([12])\s*[:=]\s*(.+)$/i.exec(line);
    if (m) {
      answers[Number(m[1]) - 1] = m[2].trim();
    }
  }
  if (answers.length) {
    return answers;
  }
  return lines.slice(-2);
}

export function isPlaceholderAnswer(answer: string | undefined): boolean {
  return !answer || /^(none|null|undefined|nil|todo)$/i.test(answer);
}
