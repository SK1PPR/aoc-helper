export interface DayRef {
  year: number;
  day: number;
}

export const FIRST_YEAR = 2015;

/** Since 2025 the event runs for 12 days instead of 25. */
export function daysInYear(year: number): number {
  return year >= 2025 ? 12 : 25;
}

/** The global leaderboard was discontinued starting with the 2025 event. */
export function hasGlobalLeaderboard(year: number): boolean {
  return year < 2025;
}

/** Puzzles unlock at midnight US Eastern (UTC-5). */
export function unlockTime(year: number, day: number): number {
  return Date.UTC(year, 11, day, 5);
}

export function isUnlocked(year: number, day: number, now = Date.now()): boolean {
  return now >= unlockTime(year, day);
}

/** Most recent event that has at least one unlocked puzzle. */
export function latestYear(now = Date.now()): number {
  const year = new Date(now).getUTCFullYear();
  return isUnlocked(year, 1, now) ? year : year - 1;
}

export function nextUnlock(now = Date.now()): DayRef {
  const year = new Date(now).getUTCFullYear();
  for (const y of [year, year + 1]) {
    for (let day = 1; day <= daysInYear(y); day++) {
      if (unlockTime(y, day) > now) {
        return { year: y, day };
      }
    }
  }
  return { year: year + 1, day: 1 };
}

export function sameRef(a: DayRef | undefined, b: DayRef | undefined): boolean {
  return !!a && !!b && a.year === b.year && a.day === b.day;
}

export function refLabel(ref: DayRef): string {
  return `${ref.year} Day ${ref.day}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const hms = `${pad2(Math.floor((s % 86400) / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  return days ? `${days}d ${hms}` : hms;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function htmlText(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
