import { randomBytes } from "node:crypto";
import { copyFile, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { weeksCovered } from "./dashboard";
import { type Digest, digest } from "./digest";
import { Profile } from "@garmin/fitsdk";
import { type Activity, GROUPS, groupOf } from "./page/calc";
import { CATALOGUE } from "./page/catalogue";
import { ABOUT } from "./page/catalogue-about";
import { BUILT_IN } from "./page/i18n/built-in";
import { en } from "./page/i18n/en";
import { add, boardOf, type Layout, parseLayout, type Span, withBoard } from "./page/layout";
import { preset } from "./page/presets";
import { DATA_ITEMS, type Settings } from "./page/settings";
import { THEMES } from "./page/theme";
import { WIDGET_API } from "./page/widget-api";
import { DASHBOARD_VERSION } from "./prompts";
import { writeAtomically } from "./tools";

/**
 * The dashboard page file: the server writes it from the built-in template (or from a page that Claude
 * wrote) and fills its blocks. The page keeps its state in marked blocks (data, layout, custom widgets,
 * extra languages, settings); nothing else changes on an update, so the user's layout, widgets and texts
 * stay. The built-in languages block is written again on each update, so it has the server's texts.
 */

export const DASHBOARD_FILE = "garmin-dashboard.html";
const MAX_NOTES = 5;
const REUSE_MS = 15 * 60_000;

export type Block = "data" | "layout" | "widgets" | "i18n" | "settings" | "languages";
const marker = (b: Block) =>
  new RegExp(`/\\*\\s*garmin-${b}:start\\s*\\*/([\\s\\S]*?)/\\*\\s*garmin-${b}:end\\s*\\*/`);
// the formatter writes the tag as <meta ... content="3" />
const TEMPLATE_VERSION = /<meta name="garmin-template" content="(\d+)"\s*\/?>/;

export interface WriteOptions {
  weeks?: number;
  notes?: string[];
  layout?: "preset" | "blank";
  page?: string;
  path?: string;
  /** Replaces the settings of the page; without it, the page keeps its own. */
  settings?: Settings;
}

export interface PreviewResult {
  path: string;
  /** The activities of each board in the period, before the `sports` setting. */
  boards: Record<string, number>;
  digest: Digest;
}

export interface WriteResult {
  path: string;
  /** created: no page before; updated: only the data changed; replaced: a new page or new settings; upgraded: a newer template. */
  page: "created" | "updated" | "replaced" | "upgraded";
  backup?: string;
  notes: number;
  digest: Digest;
  /** The texts that each language of the page still misses (they show in English). */
  languages?: Record<string, { missing: string[] }>;
}

export interface CustomWidget {
  id: string;
  title: string;
  code: string;
  span?: number;
  types?: string[];
}

export interface EditOptions {
  /** A whole layout, as the page's "Copy layout" gives it. */
  layout?: unknown;
  /** Widgets to add at the end of a board. */
  place?: { board: string; widget: string; type?: string; span?: number }[];
  /** Custom widgets to add, or to replace by id. */
  widgets?: CustomWidget[];
  removeWidgets?: string[];
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
  layout: Layout;
  customWidgets: { id: string; title: string; span: number; types?: string[] }[];
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
}

/** The JSON value of a block; undefined when the page has no such block. */
export function readBlock(page: string, block: Block): unknown {
  const m = marker(block).exec(page);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    throw new Error(`The garmin-${block} block of the page is not valid JSON`);
  }
}

/**
 * The page with the block set to `value`. `<` is written as \u003c, so no value can close the script,
 * and `*` as \u002a, so no value can hold marker text (a marker needs a slash next to an asterisk)
 * and end its block early. A `/` stays as it is: the data has many (`5:07/km`), and `*` is rare.
 */
export function writeBlock(page: string, block: Block, value: unknown): string {
  const json = JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("*", "\\u002a");
  return page.replace(
    marker(block),
    () => `/* garmin-${block}:start */${json}/* garmin-${block}:end */`,
  );
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

/** The template version of a page; 0 for a page that Claude wrote. */
export const templateVersion = (page: string) => Number(TEMPLATE_VERSION.exec(page)?.[1] ?? 0);

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`,
  );

type Json = Record<string, unknown>;
const listOf = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

/** The settings of a page; none for no page or a page without them. */
function settingsOf(page: string | undefined): Settings {
  const s = page === undefined ? undefined : readBlock(page, "settings");
  return s && typeof s === "object" ? (s as Settings) : {};
}

/** The number of items for each key. */
function countBy(items: Json[], key: (a: Activity) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of items) out[key(a as Activity)] = (out[key(a as Activity)] ?? 0) + 1;
  return out;
}

/** The data without what the settings leave out: what the page holds and what the digest quotes. */
export function filterData(data: Json, s: Settings): Json {
  const out: Json = { ...data };
  const no = new Set(s.exclude);
  const keep = (items: unknown) =>
    listOf(items)
      .filter((a) => !s.sports || s.sports.includes(groupOf(a as Activity)))
      .map((a) => {
        if (!no.has("names")) return a;
        const { name: _, ...rest } = a;
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

/** The built-in languages that the settings choose, by code. */
const languagesOf = (s: Settings) =>
  Object.fromEntries(
    Object.entries(BUILT_IN).filter(([code]) => !s.languages || s.languages.includes(code)),
  );

/**
 * A page from the template with the settings: its settings block, its title, and the CSS of the chosen
 * themes. Only rules for one theme alone go: a rule that lists more selectors is kept as it is.
 */
function styled(page: string, s: Settings): string {
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
  #last: { weeks: number; at: number; json: string } | undefined;

  constructor(
    private readonly getData: (weeks?: number) => Promise<string>,
    private readonly dataDir: string,
    private readonly template: () => Promise<string>,
  ) {}

  write(options: WriteOptions): Promise<WriteResult> {
    const run = this.#queue.then(() => this.#write(options));
    this.#queue = run.catch(() => {});
    return run;
  }

  /** What a write would show, and the activities of each board, so the user can choose the sports; writes nothing. */
  preview(options: Pick<WriteOptions, "weeks" | "path" | "settings">): Promise<PreviewResult> {
    const run = this.#queue.then(async () => {
      const target = this.#target(options.path);
      const old = await readExisting(target);
      const settings = options.settings ? checkSettings(options.settings) : settingsOf(old);
      const data = JSON.parse(await this.#data(options.weeks ?? weeksOf(old))) as Json;
      return {
        path: target,
        boards: countBy(listOf(data.activities), groupOf),
        digest: digest(filterData(data, settings)),
      };
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #write({
    weeks,
    notes = [],
    layout,
    page,
    path,
    settings,
  }: WriteOptions): Promise<WriteResult> {
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
    let oldSettings: Settings;
    let unreadable = false;
    try {
      oldSettings = settingsOf(old);
    } catch (e) {
      // without readable settings, a shared page could get data it must not have: only new settings help
      if (asked === undefined) {
        throw new Error(
          `${(e as Error).message} in ${target}: give new settings, or delete the file`,
          { cause: e },
        );
      }
      oldSettings = {};
      unreadable = true;
    }
    const own = asked ?? oldSettings;

    const template = await this.template();
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
      kind = old === undefined ? "created" : "replaced";
    } else if (
      templateVersion(old) > 0 &&
      (templateVersion(old) < templateVersion(template) || !same(own, oldSettings) || unreadable)
    ) {
      // a newer template or new settings: the user's state lives in the blocks, so it moves over as it is
      next = writeBlock(template, "layout", readBlock(old, "layout") ?? null);
      next = writeBlock(next, "widgets", readBlock(old, "widgets") ?? []);
      next = writeBlock(next, "i18n", readBlock(old, "i18n") ?? {});
      kind = templateVersion(old) < templateVersion(template) ? "upgraded" : "replaced";
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
    if (page === undefined && next !== old) next = styled(next, own);
    next = writeBlock(next, "languages", languagesOf(own));

    const data = filterData(JSON.parse(await this.#data(weeks ?? weeksOf(old))) as Json, own);
    const kept = own.exclude?.includes("notes") ? [] : notes;
    next = writeBlock(next, "data", {
      ...data,
      v: DASHBOARD_VERSION,
      notes: kept.map(escapeHtml),
    });

    let backup: string | undefined;
    if (old !== undefined && kind !== "updated") {
      backup = `${target}.bak`;
      await copyFile(target, backup);
    }
    await writeAtomically(target, next);
    return {
      path: target,
      page: kind,
      ...(backup ? { backup } : {}),
      notes: kept.length,
      digest: digest(data),
      ...(hasLanguages(next) ? { languages: missingTexts(next) } : {}),
    };
  }

  /** Changes the layout, the custom widgets or the languages of a page from the template; no options only reads. */
  edit(options: EditOptions): Promise<EditResult> {
    const run = this.#queue.then(() => this.#edit(options));
    this.#queue = run.catch(() => {});
    return run;
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
    let texts: Record<string, Record<string, string>>;
    let settings: Settings;
    try {
      const saved = readBlock(old, "layout");
      if (saved === undefined) {
        throw new Error(
          "This page has no widget layout: it is a page that Claude wrote, not the template",
        );
      }
      layout = parseLayout(saved);
      widgets = (readBlock(old, "widgets") as CustomWidget[] | undefined) ?? [];
      texts = (readBlock(old, "i18n") as Record<string, Record<string, string>> | undefined) ?? {};
      settings = settingsOf(old);
    } catch (e) {
      throw new Error(`${(e as Error).message} in ${target}`, { cause: e });
    }
    let layoutChanged = false;

    if (o.layout !== undefined) {
      layout = parseLayout(o.layout);
      layoutChanged = true;
    }
    for (const w of o.widgets ?? []) {
      const clean = checkWidget(w);
      widgets = [...widgets.filter((x) => x.id !== clean.id), clean];
    }
    for (const id of o.removeWidgets ?? []) {
      widgets = widgets.filter((x) => x.id !== id);
      for (const [board, list] of Object.entries(layout.boards)) {
        if (list.some((i) => i.widget === id)) {
          layout = withBoard(
            layout,
            board,
            list.filter((i) => i.widget !== id),
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
      o.languages !== undefined ||
      o.removeLanguages !== undefined;
    if (changed) {
      if (layoutChanged) layout = { ...layout, rev: newRev() };
      page = writeBlock(page, "layout", layout);
      page = writeBlock(page, "widgets", widgets);
      if (o.languages !== undefined || o.removeLanguages !== undefined) {
        page = writeBlock(page, "i18n", texts);
      }
      await writeAtomically(target, page);
    }
    return {
      path: target,
      changed,
      layout,
      customWidgets: widgets.map(({ id, title, span, types }) => ({
        id,
        title,
        span: span ?? 1,
        ...(types ? { types } : {}),
      })),
      languages: missingTexts(page),
      // a widget whose data the page leaves out shows nothing there
      catalogue: CATALOGUE.filter((c) => !c.needs || !settings.exclude?.includes(c.needs)).map(
        (c) => ({
          id: c.id,
          title: en[c.title],
          ...(c.types ? { types: c.types } : {}),
          span: c.span,
          about: ABOUT[c.id],
        }),
      ),
      widgetApi: WIDGET_API,
      ...(o.englishTexts ? { englishTexts: en } : {}),
    };
  }

  /** The data for `weeks`; the same snapshot for 15 minutes, so the notes match the digest they come from. */
  async #data(weeks: number | undefined): Promise<string> {
    const covered = weeksCovered(weeks);
    const last = this.#last;
    if (last && last.weeks === covered && Date.now() - last.at < REUSE_MS) return last.json;
    const json = await this.getData(weeks);
    this.#last = { weeks: covered, at: Date.now(), json };
    return json;
  }

  /** The page file: relative paths sit in the data dir; only .html files. */
  #target(path: string | undefined): string {
    // ~ is the home folder, as the user types it in a shell
    const target = resolve(
      this.dataDir,
      (path ?? DASHBOARD_FILE).replace(/^~(?=$|[/\\])/, homedir()),
    );
    if (!/\.html$/i.test(target)) {
      throw new Error(`The dashboard must be an .html file: ${target}`);
    }
    return target;
  }
}

/** The boards: All, Recovery, the type boards, and a board for any other SDK sport. */
const TYPES = new Set<string>([
  "all",
  "recovery",
  ...GROUPS,
  ...Object.values(Profile.types.sport),
]);
const spanOf = (v: unknown): Span => Math.min(3, Math.max(1, Math.round(Number(v) || 1))) as Span;

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
  return {
    id: w.id,
    title: w.title.trim(),
    code: w.code,
    span: spanOf(w.span),
    ...(w.types?.length ? { types: w.types } : {}),
  };
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

/** For each language of the page, the keys that it does not translate. */
function missingTexts(page: string): Record<string, { missing: string[] }> {
  const t = (readBlock(page, "i18n") as Record<string, Record<string, string>> | undefined) ?? {};
  return Object.fromEntries(
    Object.entries(t).map(([lang, texts]) => [
      lang,
      { missing: Object.keys(en).filter((k) => !(k in texts)) },
    ]),
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
      description: [
        "Writes the training dashboard page (default <data-dir>/garmin-dashboard.html) with the data of the",
        "last `weeks` weeks, and returns its path and a short digest of the data (totals, weekly sums, load,",
        "best efforts, races, strength top sets, HRV, recovery, fitness age, sync) for the coach notes.",
        "An existing page keeps all its code, layout and widgets: only its data is replaced. A page from an",
        "older template gets the new template and keeps its layout and widgets. `layout` writes a new page",
        "from the template: `preset` (the default widgets) or `blank` (empty boards). `page` writes your own",
        "page code instead; it must contain /* garmin-data:start */null/* garmin-data:end */. A replaced",
        "page is kept as <file>.bak. `notes`: at most 5 plain-text coach notes; the server escapes them.",
        "`settings` replace the page's settings (title, headline, sports, data to leave out, languages,",
        "themes); without them the page keeps its own. The page holds only the data, languages and themes",
        "they keep. `preview: true` writes nothing: it returns the digest and the activities of each board.",
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
              .describe(`Languages to keep: en, ${Object.keys(BUILT_IN).join(", ")}`)
              .optional(),
            language: z.string().describe("Default language: auto or a code").optional(),
            themes: z
              .array(z.string())
              .describe(`Themes to keep: ${THEMES.map((t) => t.id).join(", ")}`)
              .optional(),
            theme: z.string().describe("Default theme").optional(),
          })
          .describe("The page settings; replaces the page's own")
          .optional(),
        preview: z
          .boolean()
          .describe("Write nothing: return the digest and the activities of each board")
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
      description: [
        "Changes the layout, the custom widgets or the languages of the dashboard page (a page from the",
        "template; call writeDashboard first). Without arguments it only reads: the reply has the layout, the",
        "custom widgets, the missing texts of each language, the catalogue of built-in widgets and `widgetApi`,",
        "the guide to writing a custom widget. `layout` replaces the whole layout (the text of the page's",
        "'Copy layout'); `place` adds widgets at the end of a board; `widgets` adds or replaces custom widgets",
        "by id; `removeWidgets` removes them, also from the boards. `languages` adds texts by key, e.g.",
        '{"de": {"title": "Training + Erholung"}}: keys and {placeholders} as in `englishTexts: true`; a',
        'text with "|" has a singular and a plural form. Missing texts show in English.',
        "`removeLanguages` removes languages that `languages` added.",
      ].join("\n"),
      inputSchema: z.object({
        layout: z
          .record(z.string(), z.unknown())
          .describe(
            "A whole layout: { base, boards: { all: [{ id, widget, type?, span, hidden? }] } }",
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
            }),
          )
          .optional(),
        removeWidgets: z.array(z.string()).describe("Ids of custom widgets").optional(),
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
}
