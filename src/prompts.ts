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
/** Version of the dashboard build text. Bump it when the page that it describes changes: updates then rebuild older pages. */
export const DASHBOARD_VERSION = 3;

/** prompts/ sits next to dist/ in the package and next to src/ in the repo. */
const load = (name: string) => readFileSync(new URL(`../prompts/${name}`, import.meta.url), "utf8");

export function registerPrompts(server: McpServer): void {
  const build = load("training-dashboard.md");
  const update = load("training-dashboard-update.md");

  const dashboardDescription =
    "Build a personal training + recovery dashboard (volume, load, HRV, sleep) from Garmin data";
  server.registerPrompt(
    "training-dashboard",
    {
      description: dashboardDescription,
      argsSchema: z.object({
        weeks: z.string().describe(`Number of weeks to cover, default ${DEFAULT_WEEKS}`).optional(),
      }),
    },
    (args) => result(dashboardDescription, renderDashboard(build, weeks(args.weeks))),
  );

  const updateDescription =
    "Update an existing training dashboard with the Garmin data since its last build " +
    "(builds a new one when there is none)";
  server.registerPrompt(
    "training-dashboard-update",
    {
      description: updateDescription,
      argsSchema: z.object({
        weeks: z
          .string()
          .describe("Weeks to cover; empty = keep the weeks of the existing dashboard")
          .optional(),
      }),
    },
    (args) => {
      const given = arg(args.weeks) !== "";
      const w = weeks(args.weeks);
      // the build text becomes sections B1-B3, so its numbers do not clash with the update's own sections
      const buildText = renderDashboard(build, w)
        .replace(/^### /gm, "#### ")
        .replace(/^## (\d+)\. /gm, "### B$1. ");
      return result(
        updateDescription,
        render(update, {
          today: localToday(),
          weeks: given
            ? String(w)
            : `the \`weeks\` value of the data block (${DEFAULT_WEEKS} if it has none)`,
          dashboardVersion: String(DASHBOARD_VERSION),
          build: buildText,
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

/** The argument without whitespace or control characters at either end; "" when missing. */
function arg(v: string | undefined): string {
  // oxlint-disable-next-line no-control-regex -- the control characters are what is stripped
  return (v ?? "").replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "");
}

/** weeks clamped to 1..52; the default when empty or not a whole number. */
function weeks(v: string | undefined): number {
  const s = arg(v);
  if (!/^[+-]?\d+$/.test(s)) {
    return DEFAULT_WEEKS;
  }
  return Math.min(Math.max(Number(s), 1), MAX_WEEKS);
}
