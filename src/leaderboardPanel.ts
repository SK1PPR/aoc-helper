import * as vscode from 'vscode';
import { AocClient, PrivateLeaderboard, PrivateMember } from './api';
import { webviewHtml } from './webview';
import {
  FIRST_YEAR,
  daysInYear,
  errorMessage,
  escapeHtml,
  formatDuration,
  hasGlobalLeaderboard,
  latestYear,
  unlockTime,
} from './util';

export type Board = { kind: 'global' } | { kind: 'private'; id: string };

const LAST_GLOBAL_YEAR = 2024;

const CSS = `
  h2 { font-size: 1.2em; margin: 14px 0 2px; }
  h3 { font-size: 1.05em; margin-top: 22px; }
  table { border-collapse: collapse; font-family: var(--vscode-editor-font-family); }
  th { text-align: left; font-weight: normal; color: var(--vscode-descriptionForeground); }
  td, th { padding: 2px 10px 2px 0; white-space: nowrap; }
  td.num, th.num { text-align: right; }
  tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  .grid span { display: inline-block; width: 1.25em; text-align: center; }
  th.grid span { font-size: 0.75em; }
`;

export class LeaderboardPanel {
  static current: LeaderboardPanel | undefined;

  private board: Board;
  private year: number;
  private view = 0; // 0 = overall, otherwise a day number
  private readonly disposables: vscode.Disposable[] = [];

  static show(api: AocClient, board: Board, onOwner: (id: string, name: string) => void): void {
    if (LeaderboardPanel.current) {
      LeaderboardPanel.current.panel.reveal();
      LeaderboardPanel.current.setBoard(board);
      return;
    }
    const panel = vscode.window.createWebviewPanel('aoc.leaderboard', 'Leaderboard', vscode.ViewColumn.Active, {
      enableScripts: true,
      enableFindWidget: true,
      localResourceRoots: [],
    });
    LeaderboardPanel.current = new LeaderboardPanel(panel, api, board, onOwner);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly api: AocClient,
    board: Board,
    private readonly onOwner: (id: string, name: string) => void,
  ) {
    this.board = board;
    this.year = this.defaultYear(board);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    void this.render();
  }

  private setBoard(board: Board): void {
    this.board = board;
    if (board.kind === 'global' && !hasGlobalLeaderboard(this.year)) {
      this.year = this.defaultYear(board);
    }
    this.view = Math.min(this.view, daysInYear(this.year));
    void this.render();
  }

  private defaultYear(board: Board): number {
    const latest = latestYear();
    return board.kind === 'global' ? Math.min(latest, LAST_GLOBAL_YEAR) : latest;
  }

  private onMessage(msg: { cmd?: string; value?: number }): void {
    if (msg.cmd === 'year' && msg.value) {
      this.year = msg.value;
      this.view = Math.min(this.view, daysInYear(this.year));
    } else if (msg.cmd === 'view' && msg.value !== undefined) {
      this.view = msg.value;
    } else if (msg.cmd !== 'refresh') {
      return;
    }
    void this.render();
  }

  private async render(): Promise<void> {
    const controls = this.controls();
    this.panel.title = this.board.kind === 'global' ? `Global Leaderboard ${this.year}` : `Leaderboard ${this.year}`;
    this.panel.webview.html = webviewHtml(this.panel.webview, controls + '<p class="muted">Loading…</p>', CSS);
    let body: string;
    try {
      body = this.board.kind === 'global' ? await this.globalBody() : await this.privateBody(this.board.id);
    } catch (e) {
      body = `<p class="error">${escapeHtml(errorMessage(e))}</p>`;
    }
    this.panel.webview.html = webviewHtml(this.panel.webview, controls + body, CSS);
  }

  private controls(): string {
    const lastYear = this.board.kind === 'global' ? Math.min(latestYear(), LAST_GLOBAL_YEAR) : latestYear();
    const years: string[] = [];
    for (let y = lastYear; y >= FIRST_YEAR; y--) {
      years.push(`<option value="${y}"${y === this.year ? ' selected' : ''}>${y}</option>`);
    }
    const views = [`<option value="0"${this.view === 0 ? ' selected' : ''}>Overall</option>`];
    for (let d = 1; d <= daysInYear(this.year); d++) {
      if (Date.now() >= unlockTime(this.year, d)) {
        views.push(`<option value="${d}"${d === this.view ? ' selected' : ''}>Day ${d}</option>`);
      }
    }
    return `<header>
      <select data-cmd="year" title="Event year">${years.join('')}</select>
      <select data-cmd="view" title="Overall or a single day">${views.join('')}</select>
      <span class="spacer"></span>
      <button data-cmd="refresh" title="Refresh">⟳</button>
    </header>`;
  }

  private async privateBody(id: string): Promise<string> {
    const { data, fetchedAt } = await this.api.getPrivateLeaderboard(this.year, id);
    const owner = data.members[String(data.owner_id)];
    const ownerName = owner?.name ?? `anonymous user #${data.owner_id}`;
    this.onOwner(id, ownerName);
    const members = Object.values(data.members);
    const minutes = Math.floor((Date.now() - fetchedAt) / 60_000);
    const intro = `<h2>${escapeHtml(ownerName)}'s private leaderboard · ${this.year}</h2>
      <p class="muted">${members.length} members · updated ${minutes ? `${minutes} min ago` : 'just now'} · Advent of Code asks tools to refresh at most every 15 minutes</p>`;
    return intro + (this.view === 0 ? this.privateOverall(members) : this.privateDay(data, this.view));
  }

  private privateOverall(members: PrivateMember[]): string {
    const days = daysInYear(this.year);
    const sorted = [...members].sort(
      (a, b) => b.local_score - a.local_score || b.stars - a.stars || a.last_star_ts - b.last_star_ts,
    );
    const dayHeader = Array.from({ length: days }, (_, i) => `<span>${i + 1}</span>`).join('');
    const rows = sorted.map((m, i) => {
      const cells = Array.from({ length: days }, (_, d) => {
        const day = d + 1;
        const c = m.completion_day_level[String(day)];
        const cls = c?.['2'] ? 'gold' : c?.['1'] ? 'silver' : 'none';
        const tip = c ? `Day ${day}: ${this.partTimes(day, c).join(' · ')}` : `Day ${day}`;
        return `<span class="${cls}" title="${escapeHtml(tip)}">★</span>`;
      }).join('');
      return `<tr><td class="num">${i + 1})</td><td class="num">${m.local_score}</td><td class="grid">${cells}</td>
        <td>${escapeHtml(memberName(m))}</td><td class="num muted">${m.stars}★</td></tr>`;
    });
    return `<table><thead><tr><th class="num">#</th><th class="num">Score</th><th class="grid">${dayHeader}</th><th>Name</th><th class="num">Stars</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table>`;
  }

  private privateDay(data: PrivateLeaderboard, day: number): string {
    const members = Object.values(data.members);
    const key = String(day);
    // Local scoring: the first of N members to get a star earns N points, the next N-1, and so on.
    const points = new Map<number, number>();
    for (const part of ['1', '2']) {
      members
        .filter((m) => m.completion_day_level[key]?.[part])
        .sort((a, b) => a.completion_day_level[key][part].get_star_ts - b.completion_day_level[key][part].get_star_ts)
        .forEach((m, i) => points.set(m.id, (points.get(m.id) ?? 0) + members.length - i));
    }
    const ts = (m: PrivateMember, part: string) => m.completion_day_level[key]?.[part]?.get_star_ts ?? Infinity;
    const solvers = members
      .filter((m) => m.completion_day_level[key])
      .sort((a, b) => ts(a, '2') - ts(b, '2') || ts(a, '1') - ts(b, '1'));
    if (!solvers.length) {
      return '<p class="muted">Nobody on this leaderboard has a star for this day yet.</p>';
    }
    const rows = solvers.map((m, i) => {
      const [p1, p2] = this.partTimes(day, m.completion_day_level[key], false);
      return `<tr><td class="num">${i + 1})</td><td>${escapeHtml(memberName(m))}</td>
        <td class="num silver">${p1}</td><td class="num gold">${p2}</td><td class="num">${points.get(m.id) ?? 0}</td></tr>`;
    });
    return `<table><thead><tr><th class="num">#</th><th>Name</th><th class="num">Part 1</th><th class="num">Part 2</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table>
      <p class="muted">Times are measured from when the puzzle unlocked.</p>`;
  }

  private partTimes(day: number, c: Record<string, { get_star_ts: number }>, labelled = true): string[] {
    const unlock = unlockTime(this.year, day);
    return ['1', '2'].map((part) => {
      const t = c[part] ? formatDuration(c[part].get_star_ts * 1000 - unlock) : '—';
      return labelled ? `part ${part} ${t}` : t;
    });
  }

  private async globalBody(): Promise<string> {
    if (!hasGlobalLeaderboard(this.year)) {
      return '<p class="muted">Advent of Code no longer has a global leaderboard (discontinued in 2025). Use a private leaderboard instead.</p>';
    }
    const { data } = await this.api.getGlobalLeaderboard(this.year, this.view || undefined);
    return data.sections
      .map((section) => {
        if (!section.entries.length) {
          return `<h3>${escapeHtml(section.heading)}</h3><p class="muted">No entries.</p>`;
        }
        const rows = section.entries.map(
          (e) => `<tr><td class="num">${e.position ? `${e.position})` : ''}</td>
            <td class="num">${escapeHtml(e.score !== undefined ? String(e.score) : e.time ?? '')}</td><td>${escapeHtml(e.name)}</td></tr>`,
        );
        return `<h3>${escapeHtml(section.heading)}</h3><table><tbody>${rows.join('')}</tbody></table>`;
      })
      .join('');
  }

  private dispose(): void {
    LeaderboardPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}

function memberName(m: PrivateMember): string {
  return m.name ?? `(anonymous user #${m.id})`;
}
