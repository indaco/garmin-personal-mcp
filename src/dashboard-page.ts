import { randomBytes } from "node:crypto";
import { copyFile, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { weeksCovered } from "./dashboard";
import { type Digest, digest, syncGaps } from "./digest";
import { Profile } from "@garmin/fitsdk";
import { type Activity, GROUPS, groupOf, tabsFor } from "./analytics/calc";
import { CATALOGUE, inPage } from "./page/catalogue";
import { ABOUT } from "./page/catalogue-about";
import { BUILT_IN } from "./page/i18n/built-in";
import { type Catalogue, en } from "./page/i18n/en";
import {
  add,
  boardOf,
  type Layout,
  parseLayout,
  type Span,
  withBoard,
  withPresetWidgets,
} from "./page/layout";
import { baseline, preset } from "./page/presets";
import { DATA_ITEMS, type Settings } from "./page/settings";
import { THEMES } from "./page/theme";
import { WIDGET_API } from "./page/widget-api";
import { version } from "../package.json";
import { log } from "./log";
import { DASHBOARD_VERSION } from "./prompts";
import { MODEL_ONLY, writeAtomically } from "./tools";

/**
 * The dashboard page file: the server writes it from the built-in template (or from a page that Claude
 * wrote) and fills its blocks. The page keeps its state in marked blocks (data, layout, custom widgets,
 * extra languages, settings); nothing else changes on an update, so the user's layout, widgets and texts
 * stay. The built-in languages block is written again on each update, so it has the server's texts.
 */

export const DASHBOARD_FILE = "garmin-dashboard.html";
/** The user's custom widgets, in the data dir: every page from the template gets them. */
export const LIBRARY_FILE = "widgets.json";
/** The dashboard page as an MCP App: hosts that show apps render it for showDashboard. */
export const VIEW_URI = "ui://garmin-personal/dashboard.html";
const VIEW_MIME = "text/html;profile=mcp-app";
const MAX_NOTES = 5;
const REUSE_MS = 15 * 60_000;

export type Block = "data" | "layout" | "widgets" | "i18n" | "settings" | "languages" | "refresh";
const marker = (b: Block) =>
  new RegExp(`/\\*\\s*garmin-${b}:start\\s*\\*/([\\s\\S]*?)/\\*\\s*garmin-${b}:end\\s*\\*/`);
// the formatter writes the tag as <meta ... content="..." />
const PAGE_CODE_TAG = /<meta name="garmin-template" content="([^"]*)"\s*\/?>/;
const PAGE_CODE_ID = /^[0-9a-f]{16}$/;

export interface WriteOptions {
  weeks?: number;
  notes?: string[];
  layout?: "preset" | "blank";
  page?: string;
  path?: string;
  /** Replaces the settings of the page; without it, the page keeps its own. */
  settings?: Settings;
  /** Refuse to make a new page: for the scheduled `refresh` command, not a tool argument. */
  onlyExisting?: boolean;
}

export interface PreviewResult {
  path: string;
  /** The activities of each board in the period, before the `sports` setting. */
  boards: Record<string, number>;
  digest: Digest;
  /** The settings of the page, or the given ones: a new build can ask whether to keep them. */
  settings: Settings;
}

/** The page blocks that the dashboard in the chat starts with (`window.GARMIN` and `GARMIN_SETTINGS`). */
export interface ViewBlocks {
  data: unknown;
  layout: unknown;
  widgets: unknown;
  languages: unknown;
  i18n: unknown;
  settings: Settings;
}

export interface ViewResult {
  path: string;
  digest: Digest;
  blocks: ViewBlocks;
}

interface WriteResultBase {
  path: string;
  backup?: string;
  notes: number;
  digest: Digest;
  /** The languages of the page's Language menu, e.g. ["en", "it"]. */
  pageLanguages: string[];
  /** The settings that the page keeps. */
  settings: Settings;
  /** The texts that each language of the page still misses (they show in English). */
  languages?: Record<string, { missing: string[] }>;
  /** The language of the Garmin profile when the page has no texts in it, e.g. ru: the page shows English. */
  missingProfileLanguage?: string;
  /** The custom widgets that have no texts in some languages of the page, with those languages. */
  missingWidgetTexts?: Record<string, string[]>;
  /** The preset widgets that this write gave to edited boards and that the page shows, board -> widget ids. */
  addedWidgets?: Record<string, string[]>;
  /** Library entries that the server cannot use; they stay in widgets.json and the update goes on without them. */
  skippedWidgets?: { id: string; problem: string }[];
}

/**
 * created: no page before; updated: the data changed (and new preset widgets, if any); replaced: a new page or new settings;
 * upgraded: the page code differs from the template, and the result names the server versions.
 */
export type WriteResult = WriteResultBase &
  (
    | { page: "created" | "updated" | "replaced" }
    | {
        page: "upgraded";
        /** The server version that wrote the page before; "n/a" when the page does not say. */
        previousServer: string;
        server: string;
      }
  );

export interface CustomWidget {
  id: string;
  title: string;
  code: string;
  span?: number;
  types?: string[];
  /** Texts by language code and key, e.g. { en: { title, best }, it: { title, best } }. */
  texts?: Record<string, Record<string, string>>;
}

export interface EditOptions {
  /** A whole layout, as the page's "Copy layout" gives it. */
  layout?: unknown;
  /** Widgets to add at the end of a board. */
  place?: { board: string; widget: string; type?: string; span?: number }[];
  /** Custom widgets to add, or to replace by id. */
  widgets?: CustomWidget[];
  removeWidgets?: string[];
  /** Custom widgets to remove from the library and from this page. */
  forgetWidgets?: string[];
  /** Texts of custom widgets by widget id, language and key: added to the texts they have. */
  widgetTexts?: Record<string, Record<string, Record<string, string>>>;
  /** Texts of a language by key: added to the texts the page has. */
  languages?: Record<string, Record<string, string>>;
  /** Codes of languages that languages added, to remove. */
  removeLanguages?: string[];
  englishTexts?: boolean;
  path?: string;
}

export interface EditResult {
  path: string;
  changed: boolean;
  /** The old page, kept when a whole layout replaced the boards. */
  backup?: string;
  layout: Layout;
  customWidgets: {
    id: string;
    title: string;
    span: number;
    types?: string[];
    texts?: Record<string, Record<string, string>>;
    library: boolean;
  }[];
  /** The languages of the page's Language menu: a custom widget gives its texts in each of them. */
  pageLanguages: string[];
  languages: Record<string, { missing: string[] }>;
  catalogue: {
    id: string;
    title: string;
    types?: readonly string[];
    span: number;
    about: string;
  }[];
  widgetApi: string;
  englishTexts?: typeof en;
  /** Library entries that the server cannot use; they stay in widgets.json and the update goes on without them. */
  skippedWidgets?: { id: string; problem: string }[];
}

/** A block value that JSON.stringify cannot write: JSON.parse reads any depth, JSON.stringify overflows the stack. */
export class UnwritableBlockError extends Error {
  readonly block: Block;

  constructor(block: Block, options: ErrorOptions) {
    super(`The garmin-${block} block of the page is too deeply nested to write back`, options);
    this.block = block;
  }
}

/** A block of the page that is not valid JSON or has the wrong shape; only a hand edit makes one. */
export class BadBlockError extends Error {}

/** The JSON text of a block value. A depth check before the write fails at one depth, so the real write is caught. */
function jsonOf(block: Block, value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space);
  } catch (e) {
    throw new UnwritableBlockError(block, { cause: e });
  }
}

/** The JSON value of a block; undefined when the page has no such block. */
export function readBlock(page: string, block: Block): unknown {
  const m = marker(block).exec(page);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    throw new BadBlockError(`The garmin-${block} block of the page is not valid JSON`);
  }
}

/** The custom widgets of a page block. */
function widgetsOf(page: string): CustomWidget[] {
  const v = readBlock(page, "widgets") ?? [];
  if (!Array.isArray(v))
    throw new BadBlockError("The garmin-widgets block of the page is not a list");
  return v as CustomWidget[];
}

/** The added languages of a page block. */
function textsOf(page: string): Record<string, Record<string, string>> {
  const v = readBlock(page, "i18n") ?? {};
  const ok =
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v as object).every((t) => t !== null && typeof t === "object");
  if (!ok) throw new BadBlockError("The garmin-i18n block of the page is not a list of languages");
  return v as Record<string, Record<string, string>>;
}

/**
 * The page with the block set to `value`. `<` is written as \u003c, so no value can close the script,
 * and `*` as \u002a, so no value can hold marker text (a marker needs a slash next to an asterisk)
 * and end its block early. A `/` stays as it is: the data has many (`5:07/km`), and `*` is rare.
 * Throws `UnwritableBlockError` for a value too deep to write.
 */
export function writeBlock(page: string, block: Block, value: unknown): string {
  const json = jsonOf(block, value).replaceAll("<", "\\u003c").replaceAll("*", "\\u002a");
  return page.replace(
    marker(block),
    () => `/* garmin-${block}:start */${json}/* garmin-${block}:end */`,
  );
}

/**
 * Gives each edited board of a page from the template the preset widgets that it has not met, and
 * saves the record. The rev stays. A layout block that cannot be read leaves the page as it is: it
 * must never stop a data update.
 */
function withNewPresetWidgets(
  page: string,
  settings: Settings,
  tabs: ReadonlySet<string>,
): { page: string; added: Record<string, string[]>; names: Record<string, string[]> } {
  let layout: ReturnType<typeof parseLayout>;
  try {
    const saved = readBlock(page, "layout");
    if (saved === undefined || saved === null) return { page, added: {}, names: {} };
    layout = parseLayout(saved);
  } catch {
    // an unreadable layout block is the user's to fix with editDashboard; the data update goes on
    return { page, added: {}, names: {} };
  }
  const merged = withPresetWidgets(layout, preset, baseline);
  if (!merged.changed) return { page, added: {}, names: {} };
  // the page keeps a widget that it withholds, but the user is told only of the ones it shows, on the boards it shows
  const shown = new Set(CATALOGUE.filter((c) => inPage(c, settings)).map((c) => c.id));
  // the ids (longRuns-2) go to the assistant, the widget names (longRuns) to the page record
  const shownIds = Object.entries(merged.added).flatMap(([board, list]) => {
    if (!tabs.has(board)) return [];
    const kept = list.flatMap((id) => {
      const widget = merged.layout.boards[board]?.find((i) => i.id === id)?.widget;
      return widget !== undefined && shown.has(widget) ? [{ id, widget }] : [];
    });
    return kept.length > 0 ? [[board, kept] as const] : [];
  });
  const added = Object.fromEntries(shownIds.map(([b, l]) => [b, l.map((k) => k.id)]));
  const names = Object.fromEntries(shownIds.map(([b, l]) => [b, l.map((k) => k.widget)]));
  return { page: writeBlock(page, "layout", merged.layout), added, names };
}

/** A new layout rev: a browser edit made on another layout never applies to this one. */
const newRev = () => randomBytes(6).toString("hex");

/** The weeks of the page's data; undefined when it has none. */
function weeksOf(page: string | undefined): number | undefined {
  if (page === undefined) return undefined;
  try {
    const w = (readBlock(page, "data") as { weeks?: unknown } | null)?.weeks;
    return typeof w === "number" && Number.isInteger(w) ? w : undefined;
  } catch {
    return undefined;
  }
}

/** The server version in a page's data block; "n/a" unless it is x.y.z (the page file is editable). */
function serverOf(page: string): string {
  try {
    const v = (readBlock(page, "data") as { server?: unknown } | null)?.server;
    return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : "n/a";
  } catch {
    return "n/a";
  }
}

/** Where a page's code comes from. `id` is undefined when the tag holds no valid id, e.g. an old number. */
export type PageCode = { from: "assistant" } | { from: "template"; id: string | undefined };

/** The page code of a page: no tag means the assistant wrote it. */
export function pageCode(page: string): PageCode {
  const value = PAGE_CODE_TAG.exec(page)?.[1];
  if (value === undefined) return { from: "assistant" };
  return { from: "template", id: PAGE_CODE_ID.test(value) ? value : undefined };
}

/** True when a page from the template has other page code than the template, in any direction. */
export function needsNewCode(old: PageCode, template: PageCode): boolean {
  switch (old.from) {
    case "assistant":
      return false;
    case "template":
      return old.id === undefined || template.from !== "template" || old.id !== template.id;
  }
}

/** The template with the user's state of `old`, a page from the template: layout, custom widgets and added languages. */
function carryUserBlocks(template: string, old: string): string {
  let page = writeBlock(template, "layout", readBlock(old, "layout") ?? null);
  page = writeBlock(page, "widgets", readBlock(old, "widgets") ?? []);
  return writeBlock(page, "i18n", readBlock(old, "i18n") ?? {});
}

/** `next` with the `refresh` block of `old`; null when it cannot be read or written: it must never stop a write. */
function carryRefresh(next: string, old: string): string {
  try {
    return writeBlock(next, "refresh", readBlock(old, "refresh") ?? null);
  } catch {
    // the block is editable: invalid JSON, or a value too deep to write back
    return writeBlock(next, "refresh", null);
  }
}

const VERSION = /^\d+\.\d+\.\d+$/;

/** True when `a` is an older x.y.z than `b`; false when either is not x.y.z. */
export const olderThan = (a: string, b: string): boolean =>
  VERSION.test(a) && VERSION.test(b) && a.localeCompare(b, "en", { numeric: true }) < 0;

/** `next` with the `i18n` block of `old`; {} when it cannot be read or written: a new layout is the way out of a broken page. */
function carryLanguages(next: string, old: string): string {
  try {
    return writeBlock(next, "i18n", textsOf(old));
  } catch {
    return writeBlock(next, "i18n", {});
  }
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`,
  );

type Json = Record<string, unknown>;
const listOf = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

/** The settings of a page; none for no page or a page without them. The lists that keep data out must be lists. */
function settingsOf(page: string | undefined): Settings {
  const s = page === undefined ? undefined : readBlock(page, "settings");
  if (!s || typeof s !== "object") return {};
  for (const key of ["exclude", "sports"] as const) {
    const v = (s as Settings)[key] as unknown;
    if (
      v !== undefined &&
      v !== null &&
      !(Array.isArray(v) && v.every((x) => typeof x === "string"))
    ) {
      throw new Error(`The garmin-settings block of the page has a bad ${key}`);
    }
  }
  return s as Settings;
}

/** The settings block of the page cannot be read: only new settings, or a new file, help. */
function unreadable(e: unknown, target: string): Error {
  return new Error(`${(e as Error).message} in ${target}: give new settings, or delete the file`, {
    cause: e,
  });
}

/** The number of items for each key. */
function countBy(items: Json[], key: (a: Activity) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of items) out[key(a as Activity)] = (out[key(a as Activity)] ?? 0) + 1;
  return out;
}

/** A page that leaves out the recovery data asks Garmin for no more of it. */
const wantsHistory = (s: Settings): boolean =>
  s.recoveryHistory === true && !s.exclude?.includes("recovery");

/** The data without what the settings leave out: what the page holds and what the digest quotes. */
export function filterData(data: Json, s: Settings): Json {
  const out: Json = { ...data };
  const no = new Set(s.exclude);
  const keep = (items: unknown) =>
    listOf(items)
      .filter((a) => !s.sports || s.sports.includes(groupOf(a as Activity)))
      .map((a) => {
        // an error text can hold a local path: it stays out of a page that can be shared
        const { detailError: _error, ...kept } = a;
        if (!no.has("names")) return kept;
        const { name: _, ...rest } = kept;
        return rest;
      });
  for (const key of ["activities", "previousActivities"]) {
    if (key in data) out[key] = keep(data[key]);
  }
  if (no.has("recovery")) {
    out.hrv = [];
    out.recovery = [];
  }
  if (no.has("fitnessAge")) delete out.fitnessAge;
  if (no.has("zones")) delete out.zones;
  return out;
}

/** The built-in languages that the settings choose, by code; without a choice, the one of the profile locale. */
export function languagesOf(s: Settings, locale: unknown): Record<string, Catalogue> {
  const own = typeof locale === "string" ? [locale, locale.slice(0, 2)] : [];
  const keep: (string | undefined)[] = s.languages ?? [own.find((code) => code in BUILT_IN)];
  return Object.fromEntries(Object.entries(BUILT_IN).filter(([code]) => keep.includes(code)));
}

/**
 * A page from the template with the settings: its settings block, its title, and the CSS of the chosen
 * themes. Only rules for one theme alone go: a rule that lists more selectors is kept as it is.
 */
export function styled(page: string, s: Settings): string {
  let next = writeBlock(page, "settings", Object.keys(s).length > 0 ? s : null);
  if (s.title)
    next = next.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(s.title!)}</title>`);
  const themes = s.themes;
  if (themes) {
    next = next.replace(/<style>[\s\S]*?<\/style>/, (css) =>
      css.replace(/(?<=[{}>]):root\[data-theme="(\w+)"\]\{[^}]*\}/g, (rule, id: string) =>
        themes.includes(id) ? rule : "",
      ),
    );
  }
  return next;
}

/**
 * The page with the built-in languages and the data that the settings keep, and the escaped notes.
 * `due`: the next automatic refresh, so the page can tell when it missed one.
 */
export function withData(
  page: string,
  data: Json,
  s: Settings,
  notes: readonly string[],
  due?: string,
): string {
  const next = writeBlock(page, "languages", languagesOf(s, data.locale));
  const kept = s.exclude?.includes("notes") ? [] : notes;
  return writeBlock(next, "data", {
    ...filterData(data, s),
    v: DASHBOARD_VERSION,
    server: version,
    updated: new Date().toISOString(),
    ...(due ? { due } : {}),
    notes: kept.map(escapeHtml),
  });
}

/**
 * Sets (or with undefined removes) `due` in the data of a saved page, with no Garmin call: for a
 * schedule that changes or stops. A missing or foreign file is left as it is. A page that cannot be
 * written is left as it is.
 */
export async function patchDue(path: string, due: string | undefined): Promise<void> {
  let page: string | undefined;
  let data: unknown;
  try {
    page = await readExisting(path);
    data = page === undefined ? undefined : readBlock(page, "data");
  } catch {
    return;
  }
  if (page === undefined || data === null || typeof data !== "object") return;
  const { due: was, ...rest } = data as Json;
  if (was === due) return;
  // best-effort: a stale due clears at the page's next write, and a page must never stop a schedule from changing
  try {
    await writeAtomically(path, writeBlock(page, "data", due ? { ...rest, due } : rest));
  } catch (e) {
    log("WARN", `Cannot update the next refresh time of ${path}: ${(e as Error).message}`);
  }
}

/** Settings that the page can use; throws with what is wrong. */
export function checkSettings(s: Settings): Settings {
  const problems: string[] = [];
  const text = (key: "title" | "headline", max: number) => {
    const v = s[key];
    if (v !== undefined && (typeof v !== "string" || !v.trim() || v.length > max))
      problems.push(`${key}: 1 to ${max} characters`);
  };
  // an empty list of sports, languages or themes leaves a page with nothing
  const names = (key: keyof Settings, known: readonly string[], empty = false) => {
    const v = s[key];
    if (v === undefined) return;
    if (!Array.isArray(v) || (v.length === 0 && !empty))
      problems.push(`${key}: a list with at least one name`);
    else {
      const bad = v.filter((x) => !known.includes(x));
      if (bad.length > 0) problems.push(`${key}: unknown ${bad.join(", ")}`);
    }
  };
  const unknown = Object.keys(s).filter(
    (k) =>
      ![
        "title",
        "headline",
        "sports",
        "exclude",
        "languages",
        "language",
        "themes",
        "theme",
        "workouts",
        "recoveryHistory",
        "shared",
      ].includes(k),
  );
  if (unknown.length > 0) problems.push(`unknown settings ${unknown.join(", ")}`);
  text("title", 80);
  text("headline", 120);
  names(
    "sports",
    [...TYPES].filter((t) => t !== "all" && t !== "recovery"),
  );
  names("exclude", DATA_ITEMS, true);
  names("languages", ["en", ...Object.keys(BUILT_IN)]);
  const themeIds = THEMES.map((t) => t.id);
  names("themes", themeIds);
  if (s.language !== undefined && !/^(auto|[a-z]{2,3}(-[A-Z]{2})?)$/.test(String(s.language)))
    problems.push("language: auto or a code such as en, it or pt-BR");
  if (s.theme !== undefined && !(s.themes ?? themeIds).includes(s.theme))
    problems.push(`theme: one of ${(s.themes ?? themeIds).join(", ")}`);
  if (s.workouts !== undefined && typeof s.workouts !== "boolean")
    problems.push("workouts: true or false");
  if (s.recoveryHistory !== undefined && typeof s.recoveryHistory !== "boolean")
    problems.push("recoveryHistory: true or false");
  if (s.shared !== undefined && typeof s.shared !== "boolean")
    problems.push("shared: true or false");
  if (problems.length > 0) throw new Error(`Settings: ${problems.join("; ")}`);
  return {
    ...s,
    ...(s.title ? { title: s.title.trim() } : {}),
    ...(s.headline ? { headline: s.headline.trim() } : {}),
  };
}

export class DashboardWriter {
  /** Writes run one at a time, so two calls never mix their pages. */
  #queue: Promise<unknown> = Promise.resolve();
  /** The data of the last call: a second call soon after (to add the notes) uses the same snapshot. */
  #last:
    | {
        weeks: number;
        workouts: boolean;
        history: boolean;
        at: number;
        json: string;
        failed: boolean;
      }
    | undefined;
  /** The last page of a build (a write that made or kept the .bak): a replace of it within REUSE_MS keeps the .bak. */
  #wrote: { target: string; page: string; at: number } | undefined;
  /** The library entries that the last read of the library could not use. They stay in the file when it is saved. */
  #skipped: SkippedWidget[] = [];

  constructor(
    private readonly getData: (
      weeks?: number,
      workouts?: boolean,
      recoveryHistory?: boolean,
    ) => Promise<string>,
    private readonly dataDir: string,
    readonly template: () => Promise<string>,
    /** The next automatic refresh of a page; undefined when it has no schedule. */
    private readonly schedule: { due(path: string): Promise<string | undefined> } = {
      due: async () => undefined,
    },
  ) {}

  write(options: WriteOptions): Promise<WriteResult> {
    const run = this.#queue.then(() => this.#write(options));
    this.#queue = run.catch(() => {});
    return run.catch(this.#unwritable(options.path));
  }

  /**
   * What a write would show, and the activities of each board, so the user can choose the sports;
   * writes no page file, but updates the data cache.
   */
  preview(options: Pick<WriteOptions, "weeks" | "path" | "settings">): Promise<PreviewResult> {
    const run = this.#queue.then(async () => {
      const target = this.#target(options.path);
      const old = await readExisting(target);
      let settings: Settings;
      try {
        settings = options.settings ? checkSettings(options.settings) : settingsOf(old);
      } catch (e) {
        throw options.settings ? e : unreadable(e, target);
      }
      const data = JSON.parse(
        await this.#data(
          options.weeks ?? weeksOf(old),
          settings.workouts === true,
          wantsHistory(settings),
        ),
      ) as Json;
      return {
        path: target,
        boards: countBy(listOf(data.activities), groupOf),
        digest: digest(filterData(data, settings)),
        settings,
      };
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  /** The template; a build without a page code id would refresh each page on each write, so it stops here. */
  async #template(): Promise<string> {
    const html = await this.template();
    const code = pageCode(html);
    if (code.from !== "template" || code.id === undefined) {
      throw new Error("the page template has no page code id: build the server again");
    }
    return html;
  }

  /**
   * The blocks of the page with new data, for the dashboard in the chat (an MCP App); writes no
   * page file, but updates the data cache.
   */
  view(options: Pick<WriteOptions, "weeks" | "path">): Promise<ViewResult> {
    const run = this.#queue.then(async () => {
      const target = this.#target(options.path);
      const old = await readExisting(target);
      let settings: Settings;
      try {
        settings = settingsOf(old);
      } catch (e) {
        throw unreadable(e, target);
      }
      // the user's state moves into the template as on an upgrade; a page that Claude wrote has none
      let page = await this.#template();
      if (old !== undefined && pageCode(old).from === "template") {
        page = carryUserBlocks(page, old);
      } else {
        // a fixed rev: a layout edited in the chat stays for the next view
        page = writeBlock(page, "layout", { rev: "preset", base: "preset", boards: {} });
      }
      page = await this.#withLibrary(page, old);
      const raw = JSON.parse(
        await this.#data(
          options.weeks ?? weeksOf(old),
          settings.workouts === true,
          wantsHistory(settings),
        ),
      ) as Json;
      page = withData(page, raw, settings, []);
      return {
        path: target,
        digest: digest(filterData(raw, settings)),
        blocks: {
          data: readBlock(page, "data"),
          layout: readBlock(page, "layout"),
          widgets: readBlock(page, "widgets"),
          languages: readBlock(page, "languages"),
          i18n: readBlock(page, "i18n"),
          settings,
        },
      };
    });
    this.#queue = run.catch(() => {});
    return run.catch(this.#unwritable(options.path));
  }

  async #write(options: WriteOptions, again = false): Promise<WriteResult> {
    this.#skipped = []; // not every write reads the library
    const { weeks, notes = [], layout, page, path, settings, onlyExisting } = options;
    if (layout && page) {
      throw new Error(
        "Give either `layout` (a page from the template) or `page` (your own page), not both",
      );
    }
    if (page !== undefined && !marker("data").test(page)) {
      throw new Error("`page` has no /* garmin-data:start */ ... /* garmin-data:end */ block");
    }
    if (notes.length > MAX_NOTES) {
      throw new Error(`At most ${MAX_NOTES} notes`);
    }
    const asked = settings === undefined ? undefined : checkSettings(settings);
    const target = this.#target(path);
    const old = await readExisting(target);
    if (onlyExisting && old === undefined) {
      throw new Error(`${target} does not exist: make it first with the training-dashboard prompt`);
    }
    let oldSettings: Settings;
    let broken = false;
    try {
      oldSettings = settingsOf(old);
    } catch (e) {
      // without readable settings, a shared page could get data it must not have: only new settings help
      if (asked === undefined) throw unreadable(e, target);
      oldSettings = {};
      broken = true;
    }
    const own = asked ?? oldSettings;

    // read before withData gives the page the version of this server
    const previousServer = old === undefined ? "n/a" : serverOf(old);
    const template = await this.#template();
    const templateCode = pageCode(template);
    const oldCode = old === undefined ? undefined : pageCode(old);
    let next: string;
    let kind: WriteResult["page"];
    if (page !== undefined) {
      next = page;
      kind = "replaced";
    } else if (layout || old === undefined) {
      next = writeBlock(template, "layout", {
        rev: newRev(),
        base: layout ?? "preset",
        boards: {},
      });
      // a new layout starts the boards again; the languages that the user added stay
      if (old !== undefined && oldCode?.from === "template") {
        next = carryLanguages(next, old);
      }
      kind = old === undefined ? "created" : "replaced";
    } else if (
      old !== undefined &&
      oldCode?.from === "template" &&
      (needsNewCode(oldCode, templateCode) || !same(own, oldSettings) || broken)
    ) {
      // other page code or new settings: the user's state lives in the blocks, so it moves over as it is
      next = carryUserBlocks(template, old);
      kind = needsNewCode(oldCode, templateCode) ? "upgraded" : "replaced";
      // new settings alone do not change what the last refresh did
      if (kind === "replaced") next = carryRefresh(next, old);
    } else {
      next = old;
      kind = "updated";
    }
    if (Object.keys(own).length > 0 && !marker("settings").test(next)) {
      // the data filter must hold on the next update too, so the page must keep its settings
      throw new Error(
        "Settings need a page from the template; this page has no garmin-settings block",
      );
    }
    const raw = JSON.parse(
      await this.#data(
        weeks ?? weeksOf(old),
        own.workouts === true,
        wantsHistory(own),
        again || notes.length > 0,
      ),
    ) as Json;
    let addedWidgets: Record<string, string[]> = {};
    let addedNames: Record<string, string[]> = {};
    // only a page from the template has a layout block that the server owns
    if (page === undefined && pageCode(next).from === "template") {
      ({
        page: next,
        added: addedWidgets,
        names: addedNames,
      } = withNewPresetWidgets(
        next,
        own,
        new Set(tabsFor(listOf(raw.activities) as Activity[], own)),
      ));
      // a page that a newer server wrote is not "new in this version" with older page code
      if (
        kind === "upgraded" &&
        templateCode.from === "template" &&
        templateCode.id !== undefined &&
        !olderThan(version, previousServer)
      ) {
        const record = {
          from: previousServer,
          server: version,
          code: templateCode.id,
          widgets: addedNames,
        };
        next = writeBlock(next, "refresh", record);
      }
    }
    if (page === undefined && next !== old) next = styled(next, own);
    // a page that Claude wrote keeps its settings in its block too, so its updates filter the same way
    if (
      (page !== undefined || (asked !== undefined && pageCode(next).from === "assistant")) &&
      marker("settings").test(next)
    ) {
      next = writeBlock(next, "settings", Object.keys(own).length > 0 ? own : null);
    }
    // before the library: a refusal changes no file
    if (hasLanguages(next)) textsOf(next);
    if (page === undefined) {
      try {
        next = await this.#withLibrary(next, old);
      } catch (e) {
        // a new layout is the way out: widgets of the old page that cannot be written do not start the library
        if (!layout || !(e instanceof UnwritableBlockError || e instanceof BadBlockError)) throw e;
        next = await this.#withLibrary(next, undefined);
      }
    }
    next = withData(next, raw, own, notes, await this.schedule.due(target));
    // first, so that a damaged block stops the call before the page changes
    const report = {
      notes: own.exclude?.includes("notes") ? 0 : notes.length,
      digest: digest(filterData(raw, own)),
      pageLanguages: pageLanguages(next, own),
      settings: own,
      ...(hasLanguages(next) ? { languages: missingTexts(next) } : {}),
      ...(page === undefined && missingLanguage(next, raw.locale)
        ? { missingProfileLanguage: raw.locale as string }
        : {}),
      ...(page === undefined ? withMissing(widgetGaps(next, pageLanguages(next, own))) : {}),
    };

    // another process (a scheduled refresh, a second client) can write the page while this one waits for Garmin
    // shortcut: a write in the milliseconds between this read and writeAtomically is still lost; a lock file would close it
    if ((await readExisting(target)) !== old) {
      if (again)
        throw new Error(`${target} changed twice while it was being updated: run the update again`);
      return this.#write(options, true);
    }
    const sameBuild = old !== undefined && this.#inBuild(target, old);
    let backup: string | undefined;
    if (old !== undefined && kind !== "updated" && !sameBuild) {
      backup = `${target}.bak`;
      await copyFile(target, backup);
    }
    // a page for another person can be in a shared folder; the others stay private
    await writeAtomically(target, next, own.shared === true ? 0o644 : 0o600);
    // the .bak keeps the page from before the build: only a write that made it, or kept it, starts the window
    this.#wrote =
      backup !== undefined || sameBuild ? { target, page: next, at: Date.now() } : undefined;
    return {
      path: target,
      ...(kind === "upgraded" ? { page: kind, previousServer, server: version } : { page: kind }),
      ...(backup ? { backup } : {}),
      ...(Object.keys(addedWidgets).length > 0 ? { addedWidgets } : {}),
      ...report,
      ...this.#skippedReport(),
    };
  }

  /** Changes the layout, the custom widgets or the languages of a page from the template; no options only reads. */
  edit(options: EditOptions): Promise<EditResult> {
    const run = this.#queue.then(() => this.#edit(options));
    this.#queue = run.catch(() => {});
    return run.catch(this.#unwritable(options.path));
  }

  /** The second write of a build (notes, a typed title, a new layout) must not overwrite the page from before the build. */
  #inBuild(target: string, old: string): boolean {
    return (
      this.#wrote?.target === target &&
      this.#wrote.page === old &&
      Date.now() - this.#wrote.at < REUSE_MS
    );
  }

  async #edit(o: EditOptions): Promise<EditResult> {
    const target = this.#target(o.path);
    const old = await readExisting(target);
    if (old === undefined) {
      throw new Error(`${target} does not exist: call writeDashboard first`);
    }
    let page = old;
    let layout: ReturnType<typeof parseLayout>;
    let widgets: CustomWidget[];
    let library: CustomWidget[];
    let texts: Record<string, Record<string, string>>;
    let settings: Settings;
    try {
      const saved = readBlock(old, "layout");
      if (saved === undefined) {
        throw new Error(
          "This page has no widget layout: it is a page that the assistant wrote, not the template",
        );
      }
      layout = parseLayout(saved);
      widgets = widgetsOf(old);
      texts = textsOf(old);
    } catch (e) {
      // a damaged block: #unwritable names the file and the way out
      if (e instanceof BadBlockError) throw e;
      throw new Error(`${(e as Error).message} in ${target}`, { cause: e });
    }
    try {
      settings = settingsOf(old);
    } catch (e) {
      throw unreadable(e, target);
    }
    library = await this.#library(widgets);
    widgets = merged(widgets, library);
    let layoutChanged = false;

    if (o.layout !== undefined) {
      layout = parseLayout(o.layout);
      layoutChanged = true;
    }
    for (const w of o.widgets ?? []) {
      const clean = checkWidget(w);
      this.#skipped = this.#skipped.filter((s) => s.id !== clean.id);
      widgets = [...widgets.filter((x) => x.id !== clean.id), clean];
      library = [...library.filter((x) => x.id !== clean.id), clean];
    }
    for (const [id, byLang] of Object.entries(o.widgetTexts ?? {})) {
      const w = widgets.find((x) => x.id === id);
      if (!w) throw new Error(`Unknown custom widget ${id}`);
      const own = { ...w.texts };
      for (const [lang, entries] of Object.entries(byLang)) {
        own[lang] = { ...own[lang], ...entries };
      }
      const clean = checkWidget({ ...w, texts: own });
      widgets = widgets.map((x) => (x.id === id ? clean : x));
      library = library.map((x) => (x.id === id ? clean : x));
    }
    const forget = new Set(o.forgetWidgets);
    library = library.filter((x) => !forget.has(x.id));
    this.#skipped = this.#skipped.filter((s) => !forget.has(s.id));
    for (const id of [...(o.removeWidgets ?? []), ...forget]) {
      widgets = widgets.filter((x) => x.id !== id);
      // a built-in widget of the same id stays on its boards: only the custom widget goes
      if (CATALOGUE.some((c) => c.id === id)) continue;
      for (const [board, list] of Object.entries(layout.boards)) {
        if (list.some((i) => i.widget === id)) {
          layout = withBoard(
            layout,
            board,
            list.filter((i) => i.widget !== id),
            preset,
          );
          layoutChanged = true;
        }
      }
    }
    const known = new Set([...CATALOGUE.map((c) => c.id), ...widgets.map((w) => w.id)]);
    for (const p of o.place ?? []) {
      if (!TYPES.has(p.board))
        throw new Error(
          `Unknown board ${p.board}: use all, recovery, ${GROUPS.join(", ")} or another SDK sport name`,
        );
      if (!known.has(p.widget)) throw new Error(`Unknown widget ${p.widget}`);
      if (p.type !== undefined && !TYPES.has(p.type)) throw new Error(`Unknown type ${p.type}`);
      const board = boardOf(layout, p.board, preset);
      layout = withBoard(
        layout,
        p.board,
        add(board, p.widget, { type: p.type, span: spanOf(p.span) }),
        preset,
      );
      layoutChanged = true;
    }
    for (const [lang, entries] of Object.entries(o.languages ?? {})) {
      texts[lang] = { ...texts[lang], ...checkTexts(lang, entries) };
    }
    for (const lang of o.removeLanguages ?? []) {
      if (!Object.hasOwn(texts, lang)) {
        throw new Error(
          `The page has no added texts for ${lang}: built-in languages are chosen with writeDashboard settings.languages`,
        );
      }
      delete texts[lang];
    }

    const changed =
      layoutChanged ||
      o.widgets !== undefined ||
      o.removeWidgets !== undefined ||
      o.forgetWidgets !== undefined ||
      o.widgetTexts !== undefined ||
      o.languages !== undefined ||
      o.removeLanguages !== undefined;
    // the page is built before the library is saved: a block that cannot be written back changes no file
    if (changed) {
      if (layoutChanged) layout = { ...layout, rev: newRev() };
      page = writeBlock(page, "layout", layout);
      page = writeBlock(page, "widgets", widgets);
      if (o.languages !== undefined || o.removeLanguages !== undefined) {
        page = writeBlock(page, "i18n", texts);
      }
    }
    // before the library is saved: a copy that fails changes no file
    let backup: string | undefined;
    if (o.layout !== undefined && !this.#inBuild(target, old)) {
      backup = `${target}.bak`;
      await copyFile(target, backup);
    }
    if (o.widgets !== undefined || o.forgetWidgets !== undefined || o.widgetTexts !== undefined) {
      await this.#saveLibrary(library);
    }
    if (changed) await writeAtomically(target, page);
    return {
      path: target,
      changed,
      ...(backup ? { backup } : {}),
      layout,
      customWidgets: widgets.map((w) => ({
        id: w.id,
        title: w.title,
        span: spanOf(w.span),
        ...(w.types ? { types: w.types } : {}),
        ...(w.texts ? { texts: w.texts } : {}),
        library: library.some((l) => l.id === w.id),
      })),
      pageLanguages: pageLanguages(page, settings),
      languages: missingTexts(page),
      // a widget whose data the page leaves out, or that the page has not turned on, shows nothing there
      catalogue: CATALOGUE.filter((c) => inPage(c, settings)).map((c) => ({
        id: c.id,
        title: en[c.title],
        ...(c.types ? { types: c.types } : {}),
        span: c.span,
        about: ABOUT[c.id],
      })),
      widgetApi: WIDGET_API,
      ...(o.englishTexts ? { englishTexts: en } : {}),
      ...this.#skippedReport(),
    };
  }

  /**
   * The widget library. Without a library file, the first page that has custom widgets starts it, so
   * the widgets made before the library existed join it.
   */
  async #library(seed: CustomWidget[]): Promise<CustomWidget[]> {
    const file = resolve(this.dataDir, LIBRARY_FILE);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // these entries are in the page, not in the file, so saving must not add them
      this.#skipped = [];
      const { bad } = sortWidgets(seed);
      // the entries as they are: a page block that cannot be written back must still refuse the write
      const good = seed.filter((w) => !bad.some((b) => b.raw === w));
      if (good.length > 0) await this.#saveLibrary(good);
      return good;
    }
    // an unreadable library stops the call: writing over it would lose the user's widgets
    let list: unknown;
    try {
      list = JSON.parse(text);
      if (!Array.isArray(list)) throw new Error("not a list of widgets");
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}; correct or delete the file`, { cause: e });
    }
    const { good, bad } = sortWidgets(list);
    this.#skipped = bad;
    return good;
  }

  async #saveLibrary(widgets: CustomWidget[]): Promise<void> {
    await writeAtomically(
      resolve(this.dataDir, LIBRARY_FILE),
      `${jsonOf("widgets", [...widgets, ...this.#skipped.map((s) => s.raw)], 2)}\n`,
    );
  }

  #skippedReport() {
    return this.#skipped.length > 0
      ? { skippedWidgets: this.#skipped.map(({ id, problem }) => ({ id, problem })) }
      : {};
  }

  /** Names the page file in the error of a block that cannot be written back; other errors stay as they are. */
  #unwritable(path: string | undefined): (e: unknown) => never {
    return (e) => {
      if (!(e instanceof UnwritableBlockError) && !(e instanceof BadBlockError)) throw e;
      throw new Error(
        `${e.message} in ${this.#target(path)}: correct the block in the file, or give writeDashboard a new layout`,
        { cause: e },
      );
    };
  }

  /** The page with the library in its widgets block; `old` is the page that it replaces, to start the library. */
  async #withLibrary(page: string, old: string | undefined): Promise<string> {
    if (!marker("widgets").test(page)) return page;
    const own = widgetsOf(page);
    const before = old === undefined ? [] : widgetsOf(old);
    return writeBlock(page, "widgets", merged(own, await this.#library(before)));
  }

  /**
   * The data for `weeks`; the same snapshot for 15 minutes, so the notes match the digest they come
   * from. A snapshot with gaps serves only the second write of the same update.
   */
  async #data(
    weeks: number | undefined,
    workouts: boolean,
    history: boolean,
    reuseFailed = false,
  ): Promise<string> {
    const covered = weeksCovered(weeks);
    const last = this.#last;
    if (
      last &&
      last.weeks === covered &&
      last.workouts === workouts &&
      last.history === history &&
      (!last.failed || reuseFailed) &&
      Date.now() - last.at < REUSE_MS
    )
      return last.json;
    const json = await this.getData(weeks, workouts, history);
    const failed = syncGaps((JSON.parse(json) as Json).sync) !== undefined;
    this.#last = { weeks: covered, workouts, history, at: Date.now(), json, failed };
    return json;
  }

  /** The page file: relative paths sit in the data dir; only .html files. */
  #target(path: string | undefined): string {
    return pageTarget(this.dataDir, path);
  }
}

/** The absolute page file: a relative path is inside the data dir; only .html files. */
export function pageTarget(dataDir: string, path: string | undefined): string {
  // ~ is the home folder, as the user types it in a shell
  const target = resolve(dataDir, (path || DASHBOARD_FILE).replace(/^~(?=$|[/\\])/, homedir()));
  if (!/\.html$/i.test(target)) {
    throw new Error(`The dashboard must be an .html file: ${target}`);
  }
  return target;
}

/** The boards: All, Recovery, the type boards, and a board for any other SDK sport. */
const TYPES = new Set<string>([
  "all",
  "recovery",
  ...GROUPS,
  ...Object.values(Profile.types.sport),
]);
const spanOf = (v: unknown): Span => Math.min(3, Math.max(1, Math.round(Number(v) || 1))) as Span;

/** The page's custom widgets and the library; the library version wins on the same id. */
const merged = (own: CustomWidget[], library: CustomWidget[]) => [
  ...own.filter((w) => !library.some((l) => l.id === w.id)),
  ...library,
];

/** A library entry that the server cannot use. It stays in the file, for the user to correct or forget. */
interface SkippedWidget {
  raw: unknown;
  id: string;
  problem: string;
}

/** The entries that can run, and the others. A bad entry must not stop the updates of a page; each goes to the log. */
function sortWidgets(list: unknown[]): { good: CustomWidget[]; bad: SkippedWidget[] } {
  const good: CustomWidget[] = [];
  const bad: SkippedWidget[] = [];
  for (const raw of list) {
    try {
      good.push(checkWidget(raw as CustomWidget));
    } catch (e) {
      const value = (raw as { id?: unknown } | null)?.id;
      const id = typeof value === "string" ? value : "(no id)";
      const problem = (e as Error).message;
      log("WARN", `Skipped widget ${id}: ${problem}`);
      bad.push({ raw, id, problem });
    }
  }
  return { good, bad };
}

/** A custom widget that the page can run; throws with what is wrong. */
function checkWidget(w: CustomWidget): CustomWidget {
  if (CATALOGUE.some((c) => c.id === w.id)) {
    throw new Error(`${w.id} is a built-in widget: give the custom widget another id`);
  }
  if (!/^[a-z][a-zA-Z0-9-]{1,40}$/.test(w.id)) {
    throw new Error(
      `Bad widget id ${JSON.stringify(w.id)}: use letters, digits and -, starting with a lowercase letter`,
    );
  }
  if (!w.title?.trim() || w.title.length > 60)
    throw new Error("A widget title needs 1 to 60 characters");
  if (!w.code?.trim() || w.code.length > 20_000)
    throw new Error("A widget needs code, at most 20000 characters");
  const unknown = (w.types ?? []).filter((t) => !TYPES.has(t));
  if (unknown.length > 0) throw new Error(`Unknown widget types: ${unknown.join(", ")}`);
  const texts = checkWidgetTexts(w);
  return {
    id: w.id,
    title: w.title.trim(),
    code: w.code,
    span: spanOf(w.span),
    ...(w.types?.length ? { types: w.types } : {}),
    ...(texts ? { texts } : {}),
  };
}

/** The texts of a custom widget: language codes, short keys, and the placeholders of the English text. */
function checkWidgetTexts(w: CustomWidget): CustomWidget["texts"] {
  const texts = w.texts;
  if (texts === undefined || Object.keys(texts).length === 0) return undefined;
  if (JSON.stringify(texts).length > 20_000)
    throw new Error(`The texts of ${w.id} are too long: at most 20000 characters`);
  const problems: string[] = [];
  for (const [lang, entries] of Object.entries(texts)) {
    if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) {
      problems.push(`bad language code ${lang}`);
      continue;
    }
    // a hand-edited widgets.json can hold anything here
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      problems.push(`${lang}: texts by key`);
      continue;
    }
    for (const [key, text] of Object.entries(entries)) {
      const english = texts.en?.[key];
      if (!/^[a-zA-Z][\w.-]{0,40}$/.test(key)) problems.push(`bad key ${key}`);
      else if (typeof text !== "string" || !text.trim() || text.length > 500)
        problems.push(`${lang}.${key}: 1 to 500 characters`);
      else if (english !== undefined && placeholders(text) !== placeholders(english))
        problems.push(`${lang}.${key}: keep the placeholders ${placeholders(english) || "(none)"}`);
    }
  }
  if (problems.length > 0) throw new Error(`Texts of ${w.id}: ${problems.join("; ")}`);
  return texts;
}

const placeholders = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].toSorted().join(" ");

/** Texts of a language: known keys only, strings, with the placeholders of the English text. */
function checkTexts(lang: string, entries: Record<string, string>): Record<string, string> {
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) {
    throw new Error(`Bad language code ${lang}: use a code such as de, fr or pt-BR`);
  }
  const problems: string[] = [];
  for (const [key, text] of Object.entries(entries)) {
    if (!Object.hasOwn(en, key)) problems.push(`unknown text ${key}`);
    else if (typeof text !== "string" || !text.trim() || text.length > 500)
      problems.push(`${key}: 1 to 500 characters`);
    else if (placeholders(text) !== placeholders(en[key as keyof typeof en])) {
      problems.push(
        `${key}: keep the placeholders ${placeholders(en[key as keyof typeof en]) || "(none)"}`,
      );
    }
  }
  if (problems.length > 0) throw new Error(`Texts of ${lang}: ${problems.join("; ")}`);
  return entries;
}

function hasLanguages(page: string): boolean {
  const t = readBlock(page, "i18n");
  return !!t && typeof t === "object" && Object.keys(t).length > 0;
}

/** English unless the settings leave it out, then the built-in and the added languages of the page. */
function pageLanguages(page: string, s: Settings): string[] {
  const codes = [
    ...(s.languages && !s.languages.includes("en") ? [] : ["en"]),
    ...Object.keys(readBlock(page, "languages") ?? {}),
    ...Object.keys(readBlock(page, "i18n") ?? {}),
  ];
  return [...new Set(codes)];
}

/**
 * For each custom widget with texts, the page languages it has no texts in. A widget without texts
 * (written before widgets had them) shows fixed text, so there is nothing to add.
 */
function widgetGaps(page: string, languages: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of widgetsOf(page)) {
    if (!w?.texts) continue;
    // the page shows a pt text for pt-BR, as it does for its own texts
    const gaps = languages.filter((code) => !w.texts![code] && !w.texts![code.slice(0, 2)]);
    if (gaps.length > 0) out[w.id] = gaps;
  }
  return out;
}

const withMissing = (gaps: Record<string, string[]>) =>
  Object.keys(gaps).length > 0 ? { missingWidgetTexts: gaps } : {};

/** True when the profile locale is not English, not built in and not added to the page. */
function missingLanguage(page: string, locale: unknown): boolean {
  if (typeof locale !== "string" || !locale) return false;
  // a built-in language that the settings leave out was the user's choice
  const known = ["en", ...Object.keys(BUILT_IN), ...Object.keys(readBlock(page, "i18n") ?? {})];
  return ![locale, locale.slice(0, 2)].some((code) => known.includes(code));
}

/** True for a plain object; an array or null is not one. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** For each language of the page, the keys that neither its custom texts nor its built-in texts have. */
function missingTexts(page: string): Record<string, { missing: string[] }> {
  const t = textsOf(page);
  const built = readBlock(page, "languages");
  return Object.fromEntries(
    Object.entries(t).map(([lang, texts]) => {
      // the page reads both blocks by the exact code: pt-BR does not take the texts of pt
      const own = isObject(built) && isObject(built[lang]) ? built[lang] : {};
      return [lang, { missing: Object.keys(en).filter((k) => !(k in texts) && !(k in own)) }];
    }),
  );
}

/** The page at `target`, or undefined when there is none; refuses a file that is not a dashboard. */
async function readExisting(target: string): Promise<string | undefined> {
  if (!(await stat(target).catch(() => undefined))?.isFile()) {
    return undefined;
  }
  const page = await readFile(target, "utf8");
  if (!marker("data").test(page)) {
    throw new Error(
      `${target} is not a dashboard page (no garmin-data block): it is left as it is`,
    );
  }
  return page;
}

// ------------------------------------------------------------------ MCP registration

/** Registers writeDashboard and editDashboard. */
export function registerDashboardWriter(server: McpServer, writer: DashboardWriter): void {
  server.registerTool(
    "writeDashboard",
    {
      _meta: MODEL_ONLY,
      description: [
        "Writes the training dashboard page (default <data-dir>/garmin-dashboard.html) with the data of the",
        "last `weeks` weeks, and returns its path and a short digest of the data (totals, weekly sums, load,",
        "best efforts, races, long runs, race predictions, strength top sets, readiness, fitness and form,",
        "HRV, recovery, fitness age, sync) for the coach notes. Without HRV and sleep data the digest has",
        "no readiness: give the verdict as n/a.",
        "An existing page keeps all its code, layout and widgets: its data is replaced. A page with",
        'different page code gets the page code of the server and keeps its layout and widgets; the result then has `page: "upgraded"`,',
        "`previousServer` (the server version that wrote the page, n/a when unknown) and `server`. Every page from the template",
        "also gets the custom widgets of the widget library (<data-dir>/widgets.json), not placed on a board.",
        "On a page from the template, an edited board also gets the widgets that a release adds to its preset, one time;",
        "the result lists the ones that the page shows in `addedWidgets` (board -> widget ids).",
        "`layout` writes a new page",
        "from the template: `preset` (the default widgets) or `blank` (empty boards). It keeps the languages",
        "added with editDashboard `languages`. `page` writes your own",
        "page code instead; it must contain /* garmin-data:start */null/* garmin-data:end */. A replaced",
        "page is kept as <file>.bak. The .bak keeps the page from before the build: a write that follows",
        "within 15 minutes (the notes, a new title) does not replace it.",
        "`notes`: at most 5 plain-text coach notes; the server escapes them.",
        "`settings` replace the page's settings (title, headline, sports, data to leave out, languages,",
        "themes); without them the page keeps its own. The page holds only the data, languages and themes",
        "they keep. `pageLanguages` in the result lists the languages of the page's Language menu, and",
        "`settings` the settings that the page keeps. `missingProfileLanguage` is the language of the Garmin",
        "profile when the page has no texts in it (it shows English); editDashboard `languages` adds it.",
        "`missingWidgetTexts` lists the custom widgets that miss texts in a language of the page, with",
        "those languages; editDashboard `widgetTexts` adds them.",
        "`preview: true` writes no page file (it updates the data cache, as getDashboardData does): it",
        "returns the digest, the activities of each board and the `settings` of the page.",
      ].join("\n"),
      inputSchema: z.object({
        weeks: z.number().int().describe("Weeks to cover, default 12, max 52").optional(),
        notes: z
          .array(z.string())
          .max(MAX_NOTES)
          .describe("Coach notes, plain text; without notes the page has none")
          .optional(),
        layout: z
          .enum(["preset", "blank"])
          .describe("Write a new page from the template with this layout")
          .optional(),
        page: z
          .string()
          .describe("Your own page code, with an empty garmin-data block, instead of the template")
          .optional(),
        path: z
          .string()
          .describe("The .html file; relative paths are inside the data dir")
          .optional(),
        settings: z
          .object({
            title: z.string().describe("Replaces the title in every language").optional(),
            headline: z.string().describe("A line under the title").optional(),
            sports: z
              .array(z.string())
              .describe("The boards to keep, e.g. running, cycling; all when not set")
              .optional(),
            exclude: z
              .array(z.enum(DATA_ITEMS))
              .describe("The data to leave out of the page")
              .optional(),
            languages: z
              .array(z.string())
              .describe(
                `Languages to keep: en, ${Object.keys(BUILT_IN).join(", ")}; when not set, English and the language of the Garmin profile`,
              )
              .optional(),
            language: z.string().describe("Default language: auto or a code").optional(),
            themes: z
              .array(z.string())
              .describe(`Themes to keep: ${THEMES.map((t) => t.id).join(", ")}`)
              .optional(),
            theme: z.string().describe("Default theme").optional(),
            workouts: z
              .boolean()
              .describe(
                "Compare the same run workout across weeks (Workout trend widget): the server loads the laps of the last 8 sessions of each repeated run name, and of older ones whose .FIT file is saved; off when not set",
              )
              .optional(),
            recoveryHistory: z
              .boolean()
              .describe(
                "Keep the sleep and resting HR rows of the whole period in the page, not only the last 14 days; off when not set",
              )
              .optional(),
            shared: z
              .boolean()
              .describe(
                "A page for another person, e.g. a coach: a new page file is readable by other users of the computer; off when not set",
              )
              .optional(),
          })
          .describe("The page settings; replaces the page's own")
          .optional(),
        preview: z
          .boolean()
          .describe(
            "Write nothing: return the digest, the activities of each board and the page settings",
          )
          .optional(),
      }),
    },
    async ({ preview, ...a }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await (preview ? writer.preview(a) : writer.write(a))),
        },
      ],
    }),
  );

  server.registerTool(
    "editDashboard",
    {
      _meta: MODEL_ONLY,
      description: [
        "Changes the layout, the custom widgets or the languages of the dashboard page (a page from the",
        "template; call writeDashboard first). Without arguments it only reads: the reply has the layout, the",
        "custom widgets, the missing texts of each language, the catalogue of built-in widgets and `widgetApi`,",
        "the guide to writing a custom widget. `layout` replaces the whole layout (the text of the page's",
        "'Copy layout'); `place` adds widgets at the end of a board; `widgets` adds or replaces custom widgets",
        "by id and saves them in the widget library (<data-dir>/widgets.json), which every page from the",
        "template gets; `removeWidgets` removes them from this page and its boards, `forgetWidgets` also",
        "from the library. `widgetTexts` adds texts to custom widgets by id, language and key, e.g.",
        '{"longest-ride": {"de": {"title": "Längste Fahrt"}}}. `languages` adds page texts by key, e.g.',
        '{"de": {"title": "Training + Erholung"}}: keys and {placeholders} as in `englishTexts: true`; a',
        'text with "|" has a singular and a plural form. Missing texts show in English.',
        "`removeLanguages` removes languages that `languages` added.",
      ].join("\n"),
      inputSchema: z.object({
        layout: z
          .record(z.string(), z.unknown())
          .describe(
            "A whole layout: { base, boards: { all: [{ id, widget, type?, span, hidden?, baseSpan? }] }, seen?: { all: [widget names] } }. `seen` is the record of the preset widgets that each board has met: give it back as you got it.",
          )
          .optional(),
        place: z
          .array(
            z.object({
              board: z
                .string()
                .describe(
                  "all, recovery, running, strengthTraining, walking, hiking, cycling, swimming, racket, generic (Other), or another SDK sport name",
                ),
              widget: z.string().describe("A widget id of the catalogue or a custom widget"),
              type: z
                .string()
                .describe("The type the widget shows, when not the board's")
                .optional(),
              span: z.number().int().describe("Width in columns, 1 to 3").optional(),
            }),
          )
          .optional(),
        widgets: z
          .array(
            z.object({
              id: z.string().describe("Letters, digits and -, e.g. longest-ride"),
              title: z.string(),
              code: z.string().describe("The body of a function (el, ctx): see widgetApi"),
              span: z.number().int().optional(),
              types: z.array(z.string()).describe("Types the widget can show").optional(),
              texts: z
                .record(z.string(), z.record(z.string(), z.string()))
                .describe("Texts by language code and key; title is the title: see widgetApi")
                .optional(),
            }),
          )
          .optional(),
        removeWidgets: z
          .array(z.string())
          .describe("Ids of custom widgets to remove from this page")
          .optional(),
        forgetWidgets: z
          .array(z.string())
          .describe("Ids of custom widgets to remove from the library and from this page")
          .optional(),
        widgetTexts: z
          .record(z.string(), z.record(z.string(), z.record(z.string(), z.string())))
          .describe("Texts of custom widgets by widget id, language code and key")
          .optional(),
        languages: z
          .record(z.string(), z.record(z.string(), z.string()))
          .describe("Texts by language code and key")
          .optional(),
        removeLanguages: z
          .array(z.string())
          .describe("Codes of added languages, e.g. de")
          .optional(),
        englishTexts: z.boolean().describe("Also return the English texts to translate").optional(),
        path: z
          .string()
          .describe("The .html file; relative paths are inside the data dir")
          .optional(),
      }),
    },
    async (a) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await writer.edit(a)) }],
    }),
  );

  server.registerTool(
    "showDashboard",
    {
      description: [
        "Shows the training dashboard in the chat, in assistants that show MCP Apps: the page of `path`",
        "(default <data-dir>/garmin-dashboard.html) with its layout, custom widgets, languages and settings,",
        "or the preset page when there is none, with new data of the last `weeks` weeks. Writes no page file,",
        "but updates the data cache and the saved .FIT files as getDashboardData does, and has no coach",
        "notes. Returns the page path, the digest of the data and the page settings. Other assistants show",
        "only this reply: there, writeDashboard writes the page as a file.",
      ].join("\n"),
      inputSchema: z.object({
        weeks: z
          .number()
          .int()
          .describe("Weeks to cover, default the page's or 12, max 52")
          .optional(),
        path: z
          .string()
          .describe("The .html file; relative paths are inside the data dir")
          .optional(),
      }),
      _meta: { ui: { ...MODEL_ONLY.ui, resourceUri: VIEW_URI } },
    },
    async (a) => {
      const { blocks, ...reply } = await writer.view(a);
      // the blocks are for the page only: hosts keep structuredContent out of the model's context
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ ...reply, settings: blocks.settings }) },
        ],
        structuredContent: { ...blocks },
      };
    },
  );

  server.registerResource(
    "Training dashboard",
    VIEW_URI,
    { mimeType: VIEW_MIME, description: "The dashboard page that showDashboard fills" },
    async () => ({
      contents: [{ uri: VIEW_URI, mimeType: VIEW_MIME, text: await writer.template() }],
    }),
  );
}
