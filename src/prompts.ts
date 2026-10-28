import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { addDays, localToday } from "./dates";

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
            "preset (default): the built-in widgets; blank: an empty grid; freeform: Claude designs the whole page",
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
      }),
    },
    (args) =>
      result(
        updateDescription,
        render(update, {
          today: localToday(),
          weeksArgument:
            arg(args.weeks) === ""
              ? "no `weeks` (the page keeps its weeks)"
              : `\`weeks\` = ${weeks(args.weeks)}`,
        }),
      ),
  );

  const widgetDescription = "Make a new widget for the training dashboard from your idea";
  server.registerPrompt(
    "dashboard-widget",
    {
      description: widgetDescription,
      argsSchema: z.object({
        idea: z.string().describe("What the widget shows, e.g. my longest ride each month"),
      }),
    },
    (args) => result(widgetDescription, render(widgetPrompt, { idea: arg(args.idea) })),
  );

  const languageDescription =
    "Add a language to the training dashboard (Claude translates its texts)";
  server.registerPrompt(
    "dashboard-language",
    {
      description: languageDescription,
      argsSchema: z.object({
        language: z
          .string()
          .describe("The language, e.g. German; empty = the language of this chat")
          .optional(),
      }),
    },
    (args) =>
      result(
        languageDescription,
        render(languagePrompt, {
          language: arg(args.language) || "my language (the language of this chat)",
        }),
      ),
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

/** weeks clamped to 1..52; the default when empty or not a whole number. */
function weeks(v: string | undefined): number {
  const s = arg(v);
  if (!/^[+-]?\d+$/.test(s)) {
    return DEFAULT_WEEKS;
  }
  return Math.min(Math.max(Number(s), 1), MAX_WEEKS);
}
