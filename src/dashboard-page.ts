import { copyFile, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type Digest, digest } from "./digest";
import { DASHBOARD_VERSION } from "./prompts";
import { writeAtomically } from "./tools";

/**
 * The dashboard page file: the server writes it from the built-in template (or from a page that Claude
 * wrote) and fills its blocks. The page keeps its state in three marked blocks; nothing else changes on an
 * update, so the user's layout, custom widgets and any other change stay.
 */

export const DASHBOARD_FILE = "garmin-dashboard.html";
const MAX_NOTES = 5;

export type Block = "data" | "layout" | "widgets";
const marker = (b: Block) =>
  new RegExp(`/\\*\\s*garmin-${b}:start\\s*\\*/([\\s\\S]*?)/\\*\\s*garmin-${b}:end\\s*\\*/`);
const TEMPLATE_VERSION = /<meta name="garmin-template" content="(\d+)">/;

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
}

/** The JSON value of a block; undefined when the page has no such block. */
export function readBlock(page: string, block: Block): unknown {
  const m = marker(block).exec(page);
  return m ? JSON.parse(m[1]) : undefined;
}

/** The page with the block set to `value`. `<` is written as <, so no value can close the script. */
export function writeBlock(page: string, block: Block, value: unknown): string {
  const json = JSON.stringify(value).replaceAll("<", "\\u003c");
  return page.replace(
    marker(block),
    () => `/* garmin-${block}:start */${json}/* garmin-${block}:end */`,
  );
}

const templateVersion = (page: string) => Number(TEMPLATE_VERSION.exec(page)?.[1] ?? 0);

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
      next = writeBlock(template, "layout", { rev: "", base: layout ?? "preset", boards: {} });
      kind = old === undefined ? "created" : "replaced";
    } else if (templateVersion(old) > 0 && templateVersion(old) < templateVersion(template)) {
      // a newer template: the user's state lives in the blocks, so it moves over as it is
      next = writeBlock(template, "layout", readBlock(old, "layout") ?? null);
      next = writeBlock(next, "widgets", readBlock(old, "widgets") ?? []);
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

/** Registers writeDashboard. */
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
}
