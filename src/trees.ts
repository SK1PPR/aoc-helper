import * as vscode from 'vscode';
import { AocClient, StarMap } from './api';
import { Board } from './leaderboardPanel';
import { FIRST_YEAR, DayRef, daysInYear, errorMessage, formatDuration, isUnlocked, latestYear, unlockTime } from './util';

const STAR_COLOR = new vscode.ThemeColor('charts.yellow');

class YearNode extends vscode.TreeItem {
  constructor(
    readonly year: number,
    expanded: boolean,
    stars: StarMap | undefined,
  ) {
    super(String(year), expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `year-${year}`;
    this.iconPath = new vscode.ThemeIcon('calendar');
    this.description = stars ? starSummary(year, stars) : undefined;
  }
}

class DayNode extends vscode.TreeItem implements DayRef {
  constructor(
    readonly year: number,
    readonly day: number,
    stars: number,
    title: string | undefined,
  ) {
    super(`Day ${day}`, vscode.TreeItemCollapsibleState.None);
    this.id = `day-${year}-${day}`;
    if (!isUnlocked(year, day)) {
      this.contextValue = 'dayLocked';
      this.iconPath = new vscode.ThemeIcon('lock');
      this.description = `unlocks in ${formatDuration(unlockTime(year, day) - Date.now())}`;
      return;
    }
    this.contextValue = 'day';
    this.description = [title, stars ? '★'.repeat(stars) : ''].filter(Boolean).join('  ');
    this.iconPath =
      stars === 2
        ? new vscode.ThemeIcon('star-full', STAR_COLOR)
        : stars === 1
          ? new vscode.ThemeIcon('star-half', STAR_COLOR)
          : new vscode.ThemeIcon('star-empty');
    this.tooltip = `${year} Day ${day}${title ? `: ${title}` : ''} — ${stars}/2 stars`;
    this.command = { command: 'aoc.openPuzzle', title: 'Open Puzzle', arguments: [{ year, day }] };
  }
}

function starSummary(year: number, stars: StarMap): string {
  const total = Object.values(stars).reduce((a, b) => a + b, 0);
  return `${total}/${daysInYear(year) * 2} ★`;
}

export class PuzzleTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly api: AocClient) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: vscode.TreeItem): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!node) {
      // Empty while signed out so the welcome view with the sign-in button shows.
      if (!(await this.api.getSession())) {
        return [];
      }
      const latest = latestYear();
      const years: vscode.TreeItem[] = [];
      for (let y = latest; y >= FIRST_YEAR; y--) {
        years.push(new YearNode(y, y === latest, this.api.cachedStars(y)));
      }
      return years;
    }
    if (!(node instanceof YearNode)) {
      return [];
    }
    let stars: StarMap;
    try {
      stars = await this.api.getStars(node.year);
    } catch (e) {
      const item = new vscode.TreeItem(errorMessage(e));
      item.iconPath = new vscode.ThemeIcon('error');
      item.tooltip = errorMessage(e);
      return [item];
    }
    const summary = starSummary(node.year, stars);
    if (node.description !== summary) {
      node.description = summary;
      this.changed.fire(node);
    }
    const titles = this.api.titles();
    return Array.from(
      { length: daysInYear(node.year) },
      (_, i) => new DayNode(node.year, i + 1, stars[i + 1] ?? 0, titles[`${node.year}-${i + 1}`]),
    );
  }
}

export class BoardNode extends vscode.TreeItem {
  constructor(
    readonly board: Board,
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = board.kind === 'private' ? 'privateLeaderboard' : 'globalLeaderboard';
    this.iconPath = new vscode.ThemeIcon(board.kind === 'private' ? 'organization' : 'globe');
    this.command = { command: 'aoc.openLeaderboard', title: 'Open Leaderboard', arguments: [board] };
  }
}

/** Accepts either the numeric ID or a join code ("123456-abcdef"). */
export function privateLeaderboardIds(): string[] {
  return vscode.workspace
    .getConfiguration('aoc')
    .get<string[]>('privateLeaderboards', [])
    .map((s) => String(s).trim().split('-')[0])
    .filter((s) => /^\d+$/.test(s));
}

export class LeaderboardTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly state: vscode.Memento) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  async rememberOwner(id: string, name: string): Promise<void> {
    const names = this.state.get<Record<string, string>>('leaderboardNames') ?? {};
    if (names[id] !== name) {
      await this.state.update('leaderboardNames', { ...names, [id]: name });
      this.refresh();
    }
  }

  getTreeItem(node: vscode.TreeItem): vscode.TreeItem {
    return node;
  }

  getChildren(node?: vscode.TreeItem): vscode.TreeItem[] {
    if (node) {
      return [];
    }
    const names = this.state.get<Record<string, string>>('leaderboardNames') ?? {};
    const items: vscode.TreeItem[] = privateLeaderboardIds().map((id) => {
      const item = new BoardNode({ kind: 'private', id }, names[id] ? `${names[id]}'s leaderboard` : `Private #${id}`);
      item.description = `#${id}`;
      return item;
    });
    if (!items.length) {
      const add = new vscode.TreeItem('Add a private leaderboard…');
      add.iconPath = new vscode.ThemeIcon('add');
      add.command = { command: 'aoc.addLeaderboard', title: 'Add Private Leaderboard' };
      items.push(add);
    }
    const global = new BoardNode({ kind: 'global' }, 'Global leaderboard');
    global.description = '2015–2024';
    items.push(global);
    return items;
  }
}
