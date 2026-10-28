import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { addDays, localToday } from "./dates";
import { BUILT_IN } from "./page/i18n/built-in";
import { en } from "./page/i18n/en";
import { THEMES } from "./page/theme";

/**
 * MCP prompts: ready-made instructions the client shows in its prompt menu (e.g. Claude Desktop "+").
 * The texts live in prompts/*.md and use {{placeholder}} markers, filled by plain string replacement.
 */

const DEFAULT_WEEKS = 12;
const MAX_WEEKS = 52;
/** Version of the dashboard data contract, written into each page as `v`. */
export const DASHBOARD_VERSION = 3;

/** prompts/ sits next to dist/ in the package and next to src/ in the repo. */
const load = (name: string) => readFileSync(new URL(`../prompts/${name}`, import.meta.url), "utf8");

export function registerPrompts(server: McpServer): void {
  const build = load("training-dashboard.md");
  const freeform = load("training-dashboard-freeform.md");
  const update = load("training-dashboard-update.md");
  const widgetPrompt = load("dashboard-widget.md");
  const languagePrompt = load("dashboard-language.md");
  const setupPrompt = load("dashboard-setup.md");

  const dashboardDescription =
    "Build a personal training + recovery dashboard (volume, load, HRV, sleep) from Garmin data";
  server.registerPrompt(
    "training-dashboard",
    {
      description: dashboardDescription,
      argsSchema: z.object({
        weeks: z.string().describe(`Number of weeks to cover, default ${DEFAULT_WEEKS}`).optional(),
        layout: z
          .string()
          .describe(
            "preset (default): the built-in widgets; blank: an empty grid; freeform: the assistant designs the whole page",
          )
          .optional(),
      }),
    },
    (args) => {
      const w = weeks(args.weeks);
      // Claude Code passes arguments by position: a layout given alone arrives in weeks
      const layout = layoutOf(arg(args.layout) === "" ? args.weeks : args.layout);
      const text =
        layout === "freeform"
          ? renderDashboard(freeform, w)
          : render(renderDashboard(build, w), {
              layout,
              layoutNote:
                layout === "blank"
                  ? '\nThe page is an empty grid: tell me to add widgets with "Edit layout" and "Add widget".'
                  : "",
            });
      return result(dashboardDescription, text);
    },
  );

  const updateDescription =
    "Update the training dashboard with the new Garmin data; it keeps the layout, widgets and languages";
  server.registerPrompt(
    "training-dashboard-update",
    {
      description: updateDescription,
      argsSchema: z.object({
        weeks: z
          .string()
          .describe("Weeks to cover; empty = keep the weeks of the dashboard")
          .optional(),
        path: PATH_ARG,
      }),
    },
    (args) => {
      // Claude Code passes arguments by position: the file given alone arrives in weeks
      const path = pathOf(args.path, args.weeks);
      const keepWeeks = arg(args.weeks) === "" || /\.html$/i.test(arg(args.weeks));
      return result(
        updateDescription,
        render(update, {
          today: localToday(),
          weeksArgument: keepWeeks
            ? "no `weeks` (the page keeps its weeks)"
            : `\`weeks\` = ${weeks(args.weeks)}`,
          pathArgument: pathPart(path),
          pathWith: pathWith(path),
        }),
      );
    },
  );

  const widgetDescription = "Make a new widget for the training dashboard from your idea";
  server.registerPrompt(
    "dashboard-widget",
    {
      description: widgetDescription,
      argsSchema: z.object({
        idea: z.string().describe("What the widget shows, e.g. my longest ride each month"),
        path: PATH_ARG,
      }),
    },
    (args) => {
      // Claude Code splits the text by position: join the slots, a last word ending in .html is the file
      const words = [arg(args.idea), arg(args.path)].filter(Boolean).join(" ");
      const m = /^(.*?)\s*(\S+\.html)$/i.exec(words);
      const named = arg(args.path);
      const keepNamed = !m && named !== "" && !/\s/.test(named);
      const path = m ? m[2] : keepNamed ? named : "";
      const idea = m ? m[1] : keepNamed ? arg(args.idea) : words;
      return result(
        widgetDescription,
        render(widgetPrompt, { idea, pathArgument: pathPart(path), pathWith: pathWith(path) }),
      );
    },
  );

  const setupDescription =
    "Set up a dashboard: title, sports, the data it shows (e.g. for a coach), languages, themes, file";
  server.registerPrompt(
    "dashboard-setup",
    {
      description: setupDescription,
      argsSchema: z.object({
        weeks: z.string().describe(`Number of weeks to cover, default ${DEFAULT_WEEKS}`).optional(),
      }),
    },
    (args) =>
      result(
        setupDescription,
        render(setupPrompt, {
          weeks: String(weeks(args.weeks)),
          today: localToday(),
          title: en.title,
          headline: en.headline,
          languages: ["en", ...Object.keys(BUILT_IN)].join(", "),
          languageNames: ["English", ...Object.keys(BUILT_IN).map(languageName)].join(" and "),
          themes: THEMES.map((t) => t.id).join(", "),
        }),
      ),
  );

  const languageDescription =
    "Add a language to the training dashboard (the assistant translates its texts)";
  server.registerPrompt(
    "dashboard-language",
    {
      description: languageDescription,
      argsSchema: z.object({
        language: z
          .string()
          .describe("The language, e.g. German; empty = the language of this chat")
          .optional(),
        path: PATH_ARG,
      }),
    },
    (args) => {
      // Claude Code passes arguments by position: the file given alone arrives in language
      const path = pathOf(args.path, args.language);
      const language = /\.html$/i.test(arg(args.language)) ? "" : arg(args.language);
      return result(
        languageDescription,
        render(languagePrompt, {
          language: language || "my language (the language of this chat)",
          pathArgument: pathPart(path),
          pathWith: pathWith(path),
        }),
      );
    },
  );
}

function renderDashboard(template: string, w: number): string {
  const today = localToday();
  const start = addDays(today, -7 * w);
  return render(template, {
    dashboardVersion: String(DASHBOARD_VERSION),
    weeks: String(w),
    today,
    startDate: start,
    // one extra week: the dashboard shows whole Monday-Sunday weeks, one more than asked when today is mid-week
    prevStartDate: addDays(start, -7 * (w + 1)),
    prevEndDate: addDays(start, -1),
  });
}

function result(description: string, text: string) {
  return {
    description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
}

function render(template: string, values: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  return text;
}

/** A language code by its English name, e.g. Italian for it. */
const languageName = (code: string) =>
  new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;

/** The argument without whitespace or control characters at either end; "" when missing. */
function arg(v: string | undefined): string {
  // oxlint-disable-next-line no-control-regex -- the control characters are what is stripped
  return (v ?? "").replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "");
}

/** The layout argument: preset (the default), blank or freeform. */
function layoutOf(v: string | undefined): "preset" | "blank" | "freeform" {
  const s = arg(v).toLowerCase();
  return s === "blank" || s === "freeform" ? s : "preset";
}

const PATH_ARG = z
  .string()
  .describe("The dashboard file, e.g. garmin-dashboard-coach.html; empty = the default page")
  .optional();

/**
 * The page file: the `path` argument as given, else a positional argument ending in .html
 * (Claude Code passes arguments by position, so a file given alone arrives in the first slot).
 */
function pathOf(path: string | undefined, positional: string | undefined): string {
  return arg(path) || (/\.html$/i.test(arg(positional)) ? arg(positional) : "");
}

/** The text that adds the page file after a "with ..." clause. */
function pathPart(path: string): string {
  return path ? ` and \`path\` = "${path}"` : "";
}

/** The text that adds the page file as its own "with ..." clause. */
function pathWith(path: string): string {
  return path ? ` with \`path\` = "${path}"` : "";
}

/** weeks clamped to 1..52; the default when empty or not a whole number. */
function weeks(v: string | undefined): number {
  const s = arg(v);
  if (!/^[+-]?\d+$/.test(s)) {
    return DEFAULT_WEEKS;
  }
  return Math.min(Math.max(Number(s), 1), MAX_WEEKS);
}
