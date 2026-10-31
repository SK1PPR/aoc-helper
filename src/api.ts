import * as vscode from 'vscode';
import { DayRef, decodeEntities, htmlText, sleep } from './util';

const BASE = 'https://adventofcode.com';
const SESSION_KEY = 'aoc.session';
const MIN_INTERVAL_MS = 1000;
// AoC asks tools not to poll leaderboards more than once every 15 minutes.
const LEADERBOARD_TTL_MS = 15 * 60_000;
const STARS_TTL_MS = 15 * 60_000;
const PARTIAL_PUZZLE_TTL_MS = 5 * 60_000;

export class AocError extends Error {}

export interface Puzzle extends DayRef {
  title: string;
  /** Inner HTML of each `<article class="day-desc">`; part two only appears once part one is solved. */
  parts: string[];
  answers: string[];
  complete: boolean;
}

export type StarMap = Record<number, number>;

export type SubmitStatus = 'correct' | 'incorrect' | 'wait' | 'wrongLevel' | 'unknown';

export interface SubmitResult {
  status: SubmitStatus;
  message: string;
}

export interface StarTime {
  get_star_ts: number;
  star_index: number;
}

export interface PrivateMember {
  id: number;
  name: string | null;
  stars: number;
  local_score: number;
  global_score: number;
  last_star_ts: number;
  completion_day_level: Record<string, Record<string, StarTime>>;
}

export interface PrivateLeaderboard {
  event: string;
  owner_id: number;
  members: Record<string, PrivateMember>;
}

export interface GlobalEntry {
  position?: number;
  score?: number;
  time?: string;
  name: string;
}

export interface GlobalLeaderboard {
  sections: { heading: string; entries: GlobalEntry[] }[];
}

export interface Fetched<T> {
  data: T;
  fetchedAt: number;
}

interface Entry<T> {
  at: number;
  value: T;
}

interface Response {
  status: number;
  text: string;
  location?: string;
}

export class AocClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly state: vscode.Memento,
  ) {}

  async getSession(): Promise<string | undefined> {
    return (await this.secrets.get(SESSION_KEY)) || process.env.AOC_SESSION || undefined;
  }

  async setSession(session: string | undefined): Promise<void> {
    if (session) {
      await this.secrets.store(SESSION_KEY, session);
    } else {
      await this.secrets.delete(SESSION_KEY);
    }
    await Promise.all(this.state.keys().filter((k) => k.startsWith('cache:')).map((k) => this.state.update(k, undefined)));
  }

  /** Display name from the site header, or undefined when the session isn't valid. */
  async getUser(session?: string): Promise<string | undefined> {
    let res = await this.request('/', { session });
    if (res.status >= 300 && res.status < 400 && res.location) {
      res = await this.request(new URL(res.location, BASE).pathname, { session });
    }
    const match = /<div class="user">([\s\S]*?)<\/div>/.exec(res.text);
    return match ? htmlText(match[1]) : undefined;
  }

  async getPuzzle(ref: DayRef, force = false): Promise<Puzzle> {
    const key = `puzzle:${ref.year}-${ref.day}`;
    const cached = this.entry<Puzzle>(key);
    if (!force && cached && (cached.value.complete || Date.now() - cached.at < PARTIAL_PUZZLE_TTL_MS)) {
      return cached.value;
    }
    const res = await this.request(`/${ref.year}/day/${ref.day}`);
    if (res.status === 404) {
      throw new AocError(`Day ${ref.day} of ${ref.year} isn't available yet.`);
    }
    if (res.status !== 200) {
      this.fail(res, 'Loading the puzzle');
    }
    const puzzle = parsePuzzle(ref, res.text);
    await this.put(key, puzzle);
    await this.state.update('titles', { ...this.titles(), [`${ref.year}-${ref.day}`]: puzzle.title });
    return puzzle;
  }

  cachedPuzzle(ref: DayRef): Puzzle | undefined {
    return this.entry<Puzzle>(`puzzle:${ref.year}-${ref.day}`)?.value;
  }

  titles(): Record<string, string> {
    return this.state.get<Record<string, string>>('titles') ?? {};
  }

  async getInput(ref: DayRef): Promise<string> {
    const res = await this.request(`/${ref.year}/day/${ref.day}/input`, { auth: true });
    if (res.status !== 200) {
      this.fail(res, 'Downloading the input');
    }
    return res.text;
  }

  /** Stars per day (0–2) parsed from the year's calendar page. */
  async getStars(year: number): Promise<StarMap> {
    const key = `stars:${year}`;
    const cached = this.entry<StarMap>(key);
    if (cached && Date.now() - cached.at < STARS_TTL_MS) {
      return cached.value;
    }
    const res = await this.request(`/${year}`, { auth: true });
    if (res.status !== 200) {
      this.fail(res, 'Loading the calendar');
    }
    const stars: StarMap = {};
    for (const [tag] of res.text.matchAll(/<a\b[^>]*>/g)) {
      const day = /calendar-day(\d+)/.exec(tag) ?? /href="\/\d+\/day\/(\d+)"/.exec(tag);
      if (!day) {
        continue;
      }
      let n = 0;
      if (/calendar-verycomplete|aria-label="[^"]*two stars/.test(tag)) {
        n = 2;
      } else if (/calendar-complete|aria-label="[^"]*one star/.test(tag)) {
        n = 1;
      }
      const d = Number(day[1]);
      stars[d] = Math.max(stars[d] ?? 0, n);
    }
    await this.put(key, stars);
    return stars;
  }

  cachedStars(year: number): StarMap | undefined {
    return this.entry<StarMap>(`stars:${year}`)?.value;
  }

  async invalidateStars(): Promise<void> {
    await Promise.all(this.state.keys().filter((k) => k.startsWith('cache:stars:')).map((k) => this.state.update(k, undefined)));
  }

  async getPrivateLeaderboard(year: number, id: string): Promise<Fetched<PrivateLeaderboard>> {
    const key = `lb:${year}:${id}`;
    const cached = this.entry<PrivateLeaderboard>(key);
    if (cached && Date.now() - cached.at < LEADERBOARD_TTL_MS) {
      return { data: cached.value, fetchedAt: cached.at };
    }
    const res = await this.request(`/${year}/leaderboard/private/view/${encodeURIComponent(id)}.json`, { auth: true });
    if (res.status >= 300 && res.status < 400) {
      throw new AocError(`You don't have access to private leaderboard ${id} for ${year}, or your session has expired.`);
    }
    if (res.status !== 200) {
      this.fail(res, 'Loading the leaderboard');
    }
    let data: PrivateLeaderboard;
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new AocError('Unexpected leaderboard response — your session may have expired.');
    }
    await this.put(key, data);
    return { data, fetchedAt: Date.now() };
  }

  /** Overall top 100, or per-day lists when `day` is given. Only exists for 2015–2024. */
  async getGlobalLeaderboard(year: number, day?: number): Promise<Fetched<GlobalLeaderboard>> {
    const key = `glb:${year}:${day ?? 0}`;
    const cached = this.entry<GlobalLeaderboard>(key);
    if (cached && Date.now() - cached.at < LEADERBOARD_TTL_MS) {
      return { data: cached.value, fetchedAt: cached.at };
    }
    const res = await this.request(day ? `/${year}/leaderboard/day/${day}` : `/${year}/leaderboard`);
    if (res.status !== 200) {
      this.fail(res, 'Loading the global leaderboard');
    }
    const data = parseGlobalLeaderboard(res.text, !!day);
    await this.put(key, data);
    return { data, fetchedAt: Date.now() };
  }

  async submit(ref: DayRef, level: number, answer: string): Promise<SubmitResult> {
    const body = new URLSearchParams({ level: String(level), answer }).toString();
    const res = await this.request(`/${ref.year}/day/${ref.day}/answer`, { method: 'POST', body, auth: true });
    if (res.status !== 200) {
      this.fail(res, 'Submitting the answer');
    }
    const article = /<article>([\s\S]*?)<\/article>/.exec(res.text);
    const message = article
      ? htmlText(article[1]).replace(/\s*\[(Return to|Continue to)[^\]]*\]/g, '').trim()
      : 'Unexpected response from adventofcode.com.';

    let status: SubmitStatus = 'unknown';
    if (/That's the right answer/i.test(message)) {
      status = 'correct';
    } else if (/That's not the right answer/i.test(message)) {
      status = 'incorrect';
    } else if (/You gave an answer too recently/i.test(message)) {
      status = 'wait';
    } else if (/You don't seem to be solving the right level/i.test(message)) {
      status = 'wrongLevel';
    }

    if (status === 'correct' || status === 'wrongLevel') {
      await this.state.update(`cache:puzzle:${ref.year}-${ref.day}`, undefined);
      await this.state.update(`cache:stars:${ref.year}`, undefined);
    }
    if (status === 'incorrect') {
      const key = attemptsKey(ref, level);
      await this.state.update(key, { ...this.state.get<Record<string, string>>(key), [answer]: message });
    }
    return { status, message };
  }

  /** Response message for an answer that was already rejected, so it isn't sent twice. */
  previousAttempt(ref: DayRef, level: number, answer: string): string | undefined {
    return this.state.get<Record<string, string>>(attemptsKey(ref, level))?.[answer];
  }

  private entry<T>(key: string): Entry<T> | undefined {
    return this.state.get<Entry<T>>(`cache:${key}`);
  }

  private put<T>(key: string, value: T): Thenable<void> {
    return this.state.update(`cache:${key}`, { at: Date.now(), value });
  }

  private userAgent(): string {
    const contact = vscode.workspace.getConfiguration('aoc').get<string>('contact', '').trim();
    return `vscode-advent-of-code/0.1.0${contact ? ` (${contact})` : ''}`;
  }

  /** Requests are serialized and spaced out to stay polite to the AoC servers. */
  private request(
    path: string,
    opts: { method?: 'GET' | 'POST'; body?: string; session?: string; auth?: boolean } = {},
  ): Promise<Response> {
    const run = this.queue.then(async (): Promise<Response> => {
      const session = opts.session ?? (await this.getSession());
      if (!session && opts.auth) {
        throw new AocError('Not signed in. Run "Advent of Code: Sign In" and paste your session cookie.');
      }
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        const headers: Record<string, string> = { 'User-Agent': this.userAgent() };
        if (session) {
          headers.Cookie = `session=${session}`;
        }
        if (opts.body !== undefined) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        const res = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body: opts.body, redirect: 'manual' });
        return { status: res.status, text: await res.text(), location: res.headers.get('location') ?? undefined };
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private fail(res: Response, what: string): never {
    const detail = htmlText(res.text).slice(0, 200);
    throw new AocError(`${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
  }
}

function attemptsKey(ref: DayRef, level: number): string {
  return `attempts:${ref.year}-${ref.day}-${level}`;
}

function parsePuzzle(ref: DayRef, html: string): Puzzle {
  const parts = [...html.matchAll(/<article class="day-desc">([\s\S]*?)<\/article>/g)].map((m) => m[1]);
  const answers = [...html.matchAll(/Your puzzle answer was <code>([\s\S]*?)<\/code>/g)].map((m) => decodeEntities(m[1]));
  const title = /<h2>--- Day \d+: ([\s\S]*?) ---<\/h2>/.exec(html);
  return {
    ...ref,
    title: title ? decodeEntities(title[1]) : `Day ${ref.day}`,
    parts,
    answers,
    complete: answers.length >= 2 || /Both parts of this puzzle are complete/.test(html),
  };
}

function parseGlobalLeaderboard(html: string, daily: boolean): GlobalLeaderboard {
  const parseEntries = (chunk: string): GlobalEntry[] =>
    chunk
      .split(/<div class="leaderboard-entry"[^>]*>/)
      .slice(1)
      .map((raw) => {
        const entry = raw.split('</div>')[0];
        const position = /leaderboard-position">\s*(\d+)\)/.exec(entry);
        const score = /leaderboard-totalscore">\s*(\d+)/.exec(entry);
        const time = /leaderboard-time">([^<]*)</.exec(entry);
        const name = htmlText(
          entry
            .replace(/<span class="leaderboard-(position|totalscore|time)">[\s\S]*?<\/span>/g, '')
            .replace(/<a[^>]*class="(supporter|sponsor)-badge"[^>]*>[\s\S]*?<\/a>/g, '')
            .replace(/<span class="(supporter|sponsor)-badge"[^>]*>[\s\S]*?<\/span>/g, ''),
        ).replace(/\(AoC\+\+\)|\(Sponsor\)/g, '').trim();
        return {
          position: position ? Number(position[1]) : undefined,
          score: score ? Number(score[1]) : undefined,
          time: time ? htmlText(time[1]) : undefined,
          name,
        };
      });

  if (!daily) {
    return { sections: [{ heading: 'Top 100 overall', entries: parseEntries(html) }] };
  }
  const split = html.indexOf('leaderboard-daydesc-first');
  const both = split >= 0 ? html.slice(0, split) : html;
  const first = split >= 0 ? html.slice(split) : '';
  return {
    sections: [
      { heading: 'First 100 to get both stars', entries: parseEntries(both) },
      { heading: 'First 100 to get the first star', entries: parseEntries(first) },
    ],
  };
}
