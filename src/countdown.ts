import * as vscode from 'vscode';
import { DayRef, formatDuration, nextUnlock, sameRef, unlockTime } from './util';

const SHOW_WITHIN_MS = 24 * 3600_000;

/** Status bar countdown to the next puzzle, with a notification when it unlocks. */
export class Countdown implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  private readonly timer: NodeJS.Timeout;
  private target: DayRef = nextUnlock();

  constructor(private readonly onUnlock: (ref: DayRef) => void) {
    this.item.command = 'aoc.openToday';
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  private tick(): void {
    const now = Date.now();
    const next = nextUnlock(now);
    if (!sameRef(next, this.target)) {
      const unlocked = this.target;
      this.target = next;
      if (now - unlockTime(unlocked.year, unlocked.day) < 10_000) {
        this.onUnlock(unlocked);
      }
    }
    const remaining = unlockTime(next.year, next.day) - now;
    if (!vscode.workspace.getConfiguration('aoc').get('showCountdown', true) || remaining > SHOW_WITHIN_MS) {
      this.item.hide();
      return;
    }
    this.item.text = `$(star-full) AoC Day ${next.day} in ${formatDuration(remaining)}`;
    this.item.tooltip = `Advent of Code ${next.year} Day ${next.day} unlocks at midnight EST`;
    this.item.show();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
  }
}
