import { randomBytes } from "node:crypto";
import { copyFile, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type Digest, digest } from "./digest";
import { GROUPS } from "./page/calc";
import { CATALOGUE } from "./page/catalogue";
import { en } from "./page/i18n/en";
import { add, boardOf, type Layout, parseLayout, type Span, withBoard } from "./page/layout";
import { preset } from "./page/presets";
import { WIDGET_API } from "./page/widget-api";
import { DASHBOARD_VERSION } from "./prompts";
import { writeAtomically } from "./tools";

/**
 * The dashboard page file: the server writes it from the built-in template (or from a page that Claude
 * wrote) and fills its blocks. The page keeps its state in marked blocks (data, layout, custom widgets,
 * extra languages); nothing else changes on an update, so the user's layout, widgets and texts stay.
 */

export const DASHBOARD_FILE = "garmin-dashboard.html";
const MAX_NOTES = 5;

export type Block = "data" | "layout" | "widgets" | "i18n";
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
}

export interface WriteResult {
  path: string;
  /** created: no page before; updated: only the data changed; replaced: a new page; upgraded: a newer template. */
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
  return m ? JSON.parse(m[1]) : undefined;
}

/**
 * The page with the block set to `value`. `<` is written as \u003c, so no value can close the script,
 * and `/` as \u002f, so no value can hold marker text and end its block early.
 */
export function writeBlock(page: string, block: Block, value: unknown): string {
  const json = JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("/", "\\u002f");
  return page.replace(
    marker(block),
    () => `/* garmin-${block}:start */${json}/* garmin-${block}:end */`,
  );
}

/** A new layout rev: a browser edit made on another layout never applies to this one. */
const newRev = () => randomBytes(6).toString("hex");

/** The template version of a page; 0 for a page that Claude wrote. */
export const templateVersion = (page: string) => Number(TEMPLATE_VERSION.exec(page)?.[1] ?? 0);

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`,
  );

export class DashboardWriter {
  /** Writes run one at a time, so two calls never mix their pages. */
  #queue: Promise<unknown> = Promise.resolve();

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

  async #write({ weeks, notes = [], layout, page, path }: WriteOptions): Promise<WriteResult> {
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
    const target = this.#target(path);
    const old = await readExisting(target);

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
    } else if (templateVersion(old) > 0 && templateVersion(old) < templateVersion(template)) {
      // a newer template: the user's state lives in the blocks, so it moves over as it is
      next = writeBlock(template, "layout", readBlock(old, "layout") ?? null);
      next = writeBlock(next, "widgets", readBlock(old, "widgets") ?? []);
      next = writeBlock(next, "i18n", readBlock(old, "i18n") ?? {});
      kind = "upgraded";
    } else {
      next = old;
      kind = "updated";
    }

    const data = JSON.parse(await this.getData(weeks)) as Record<string, unknown>;
    next = writeBlock(next, "data", {
      ...data,
      v: DASHBOARD_VERSION,
      notes: notes.map(escapeHtml),
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
      notes: notes.length,
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
    if (readBlock(old, "layout") === undefined) {
      throw new Error(
        "This page has no widget layout: it is a page that Claude wrote, not the template",
      );
    }
    let page = old;
    let layout = parseLayout(readBlock(page, "layout"));
    let widgets = (readBlock(page, "widgets") as CustomWidget[] | undefined) ?? [];
    const texts =
      (readBlock(page, "i18n") as Record<string, Record<string, string>> | undefined) ?? {};
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
      if (!BOARDS.includes(p.board))
        throw new Error(`Unknown board ${p.board}: use one of ${BOARDS.join(", ")}`);
      if (!known.has(p.widget)) throw new Error(`Unknown widget ${p.widget}`);
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

    const changed =
      layoutChanged ||
      o.widgets !== undefined ||
      o.removeWidgets !== undefined ||
      o.languages !== undefined;
    if (changed) {
      if (layoutChanged) layout = { ...layout, rev: newRev() };
      page = writeBlock(page, "layout", layout);
      page = writeBlock(page, "widgets", widgets);
      if (o.languages !== undefined) page = writeBlock(page, "i18n", texts);
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
      catalogue: CATALOGUE.map((c) => ({
        id: c.id,
        title: en[c.title],
        ...(c.types ? { types: c.types } : {}),
        span: c.span,
        about: c.about,
      })),
      widgetApi: WIDGET_API,
      ...(o.englishTexts ? { englishTexts: en } : {}),
    };
  }

  /** The page file: relative paths sit in the data dir; only .html files. */
  #target(path: string | undefined): string {
    const target = resolve(this.dataDir, path ?? DASHBOARD_FILE);
    if (!/\.html$/i.test(target)) {
      throw new Error(`The dashboard must be an .html file: ${target}`);
    }
    return target;
  }
}

const BOARDS: string[] = ["all", ...GROUPS];
const TYPES = new Set<string>(["all", ...GROUPS]);
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
    if (!(key in en)) problems.push(`unknown text ${key}`);
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
      }),
    },
    async (a) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await writer.write(a)) }],
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
                .describe("all, run, strength, walk, hike, bike, swim, racket or other"),
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
