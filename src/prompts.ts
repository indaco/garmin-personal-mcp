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
  const reviewPrompt = load("run-review.md");
  const readinessPrompt = load("race-readiness.md");
  const strengthPrompt = load("strength-review.md");

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
              title: en.title,
              headline: en.headline,
              builtIn: Object.keys(BUILT_IN)
                .map((code) => `${languageName(code)} (${code})`)
                .join(", "),
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
          languageNames: new Intl.ListFormat("en").format([
            "English",
            ...Object.keys(BUILT_IN).map(languageName),
          ]),
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

  const reviewDescription =
    "Review a run as a coach: planned workout against the laps, rep fade, HR drift, recovery";
  server.registerPrompt(
    "run-review",
    {
      description: reviewDescription,
      argsSchema: z.object({
        activity: z
          .string()
          .describe("An activity id, or words of its name; empty = the latest run")
          .optional(),
      }),
    },
    (args) => {
      const find = findActivity(arg(args.activity), "run", "runs", "a type that ends in `running`");
      return result(reviewDescription, render(reviewPrompt, { today: localToday(), find }));
    },
  );

  const strengthDescription =
    "Review a strength session as a coach: planned sets against done, top sets, rest, recovery";
  server.registerPrompt(
    "strength-review",
    {
      description: strengthDescription,
      argsSchema: z.object({
        activity: z
          .string()
          .describe("An activity id, or words of its name; empty = the latest strength session")
          .optional(),
      }),
    },
    (args) => {
      const find = findActivity(
        arg(args.activity),
        "strength session",
        "strength sessions",
        "a type that contains `strength`",
      );
      return result(strengthDescription, render(strengthPrompt, { today: localToday(), find }));
    },
  );

  const readinessDescription =
    "Check if you are ready for a race: training block, taper, predicted time, recovery, race plan";
  server.registerPrompt(
    "race-readiness",
    {
      description: readinessDescription,
      argsSchema: z.object({
        date: z.string().describe("The race date, yyyy-MM-dd").optional(),
        distance: z.string().describe("5k, 10k, half, marathon, or a distance in km").optional(),
        goal: z.string().describe("Your goal time, e.g. 1:45:00; empty = no goal").optional(),
      }),
    },
    (args) => {
      // Claude Code passes arguments by position: read the date and the time by their shape from any slot
      const words = [args.date, args.distance, args.goal].map(arg).join(" ").split(/\s+/);
      const date = words.find((w) => /^\d{4}-\d{2}-\d{2}$/.test(w)) ?? "";
      const goal = words.find((w) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(w)) ?? "";
      const distance = words.filter((w) => w && w !== date && w !== goal).join(" ");
      return result(
        readinessDescription,
        render(readinessPrompt, {
          today: localToday(),
          startDate: addDays(localToday(), -7 * 12),
          race: `${distance || "distance not given"} on ${date || "a date not given"}${goal ? `, goal time ${goal}` : ""}`,
          missing:
            date && distance
              ? ""
              : "The race date or distance is missing: ask me for it before you call a tool.\n",
          goalLine: goal
            ? `Compare it with my goal time of ${goal}: the gap, and whether the goal is realistic.`
            : "I have no goal time: give the prediction only.",
          planFrom: goal
            ? "from the goal time when it is realistic, else from the prediction"
            : "from the prediction",
        }),
      );
    },
  );
}

/**
 * The step that finds the activity of a review: by id, by words of its name (the slash command can pass
 * only the first word, so the name may be cut), or the latest one of its kind.
 */
function findActivity(activity: string, one: string, many: string, type: string): string {
  if (/^\d+$/.test(activity))
    return `The ${one} is the activity with \`activityId\` = ${activity}.`;
  return activity
    ? `Call \`listActivities\` with \`names\` = ${JSON.stringify([activity])} and \`limit\` = 100, and keep the ${many} (${type}). My words can be only the start of the name: when the ${many} have more than one name, list the 5 most recent with date and name and ask me which one. Then take the most recent ${one} of that name.`
    : // 100 activities answer about 55,000 characters, over a client's tool output limit: page by 20
      `Call \`listActivities\` and take the most recent ${one} (${type}). When none of them is one, call it again with \`endDate\` = the day of the oldest activity in the list, until you find one.`;
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
