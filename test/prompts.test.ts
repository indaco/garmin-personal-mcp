import { readFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/page/i18n/en";
import { createServer } from "../src/server";
import promptList from "./fixtures/prompt-list.json";

vi.mock("../src/log", () => ({ log: vi.fn() }));

let client: Client;

beforeAll(async () => {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    baseUrl: "https://api.test",
    apiKeyFile: "/none",
    dataDir: "/none",
  });
  client = new Client({ name: "test", version: "1" });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
});

beforeEach(() => {
  // Wednesday 28 Oct 2026, noon local time
  vi.useFakeTimers({ now: new Date(2026, 9, 28, 12), toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function render(name: string, args: Record<string, string> = {}): Promise<string> {
  const result = await client.getPrompt({ name, arguments: args });
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].role).toBe("user");
  const content = result.messages[0].content;
  if (content.type !== "text") throw new Error(`unexpected content ${content.type}`);
  return content.text;
}

const template = (name: string) =>
  readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");

/** What the reference prompt list and this server must agree on for each prompt. */
const shape = (p: { name: string; description?: string; arguments?: unknown[] }) => ({
  name: p.name,
  description: p.description,
  arguments: p.arguments,
});

describe("prompts", () => {
  it("builds from the template with the preset layout by default, or a blank one", async () => {
    const preset = await render("training-dashboard", { weeks: "12" });
    expect(preset).toContain('`layout` = "preset"');
    expect(preset).not.toContain("empty grid");
    const blank = await render("training-dashboard", { layout: " Blank " });
    expect(blank).toContain('`layout` = "blank"');
    expect(blank).toContain("empty grid");
    expect(await render("training-dashboard", { layout: "fancy" })).toContain(
      '`layout` = "preset"',
    );
    expect(preset).toContain("German (de)");
    expect(preset.includes("{{") || blank.includes("{{")).toBe(false);
  });

  it("asks for a title and a headline on a preset or blank page, and keeps the other settings", async () => {
    for (const layout of ["preset", "blank"]) {
      const text = await render("training-dashboard", { layout });
      expect(text).toContain(`else "${en.title}"`);
      expect(text).toContain(`else "${en.headline}"`);
      expect(text).toContain(
        "`settings` = the `settings` of the\n   last result with `title` and `headline`",
      );
    }
    expect(await render("training-dashboard", { layout: "freeform" })).not.toContain(
      "Keep the title",
    );
  });

  it("asks for a language with at most 4 options and names the other languages", async () => {
    const text = await render("training-dashboard");
    // AskUserQuestion takes 2 to 4 options, and the built-in languages are 5
    expect(text).toContain("at most 4 options in all");
    expect(text).toContain("offer at most 3 languages. Name the other built-in languages");
  });

  it("asks to keep the saved settings of a preset or blank page, or to use the defaults", async () => {
    for (const layout of ["preset", "blank"]) {
      const text = await render("training-dashboard", { weeks: "8", layout });
      expect(text).toContain("1. Call `writeDashboard` with `preview` = true and `weeks` = 8.");
      expect(text).toContain("only when `settings` has more than `title` and `headline`");
      expect(text).toContain('"Keep these settings" (default)');
      expect(text).toContain(
        '"Use the defaults: all sports, all data, English and\n     the language of my Garmin profile, all themes, opens in midnight, no workout comparison"',
      );
      expect(text).toContain('"all sports, keep the rest"');
      expect(text).toContain("name each item that it excludes. Say that the defaults add them to");
      expect(text).toContain(
        "If I typed my own choice, give `settings` = `settings` changed as I said.",
      );
      expect(text).toContain('"Keep the title" (default: the `title` of `settings`');
      expect(text).toContain('"Keep the headline" (default: the `headline`\n     of `settings`');
      expect(text).toContain(`\`weeks\` = 8 and \`layout\` = "${layout}". If I chose the`);
      expect(text).toContain("also give `settings` = only the `title` and `headline`");
      // the steps after the questions follow in order
      expect(text.match(/^\d\. /gm)).toEqual(["1. ", "2. ", "3. ", "4. ", "5. ", "6. "]);
      expect(text.includes("{{")).toBe(false);
    }
    expect(await render("training-dashboard", { layout: "freeform" })).not.toContain(
      "Keep these settings",
    );
  });

  it("takes a layout given as the only argument, as Claude Code passes it in weeks", async () => {
    const freeformText = await render("training-dashboard", { weeks: "freeform" });
    expect(freeformText).toContain("You design the page; the server puts the data into it.");
    expect(freeformText).toContain("last **12 weeks**");
    expect(await render("training-dashboard", { weeks: " Blank " })).toContain(
      '`layout` = "blank"',
    );
    expect(await render("training-dashboard", { weeks: "blank", layout: "preset" })).toContain(
      '`layout` = "preset"',
    );
  });

  it("lets Claude design the whole page with the freeform layout, with the data from the server", async () => {
    const text = await render("training-dashboard", { layout: "freeform", weeks: "8" });
    expect(text).toContain("You design the page; the server puts the data into it.");
    expect(text).toContain("`page` = the page code");
    expect(text).toContain("last **8 weeks**");
    expect(text.includes("{{")).toBe(false);
  });

  it("updates with the weeks given, or the weeks of the page", async () => {
    expect(await render("training-dashboard-update", { weeks: "8" })).toContain("`weeks` = 8,");
    const keep = await render("training-dashboard-update", { weeks: " " });
    expect(keep).toContain("no `weeks` (the page keeps its weeks)");
    expect(keep).toContain("2026-10-28");
    expect(keep.includes("{{")).toBe(false);
  });

  it("updates the page file given as path, or as the only positional argument", async () => {
    const withPath = await render("training-dashboard-update", { weeks: "8", path: "coach.html" });
    expect(withPath).toContain('`weeks` = 8 and `path` = "coach.html", without `layout`');
    expect(withPath).toContain('the same `weeks` and `path` = "coach.html" and the `notes`');
    expect(withPath).toContain('call `editDashboard` with `path` = "coach.html" to save them');
    expect(withPath.includes("{{")).toBe(false);
    const plain = await render("training-dashboard-update", {});
    expect(plain).not.toContain("`path`");
    expect(plain).not.toMatch(/\S {2}\S/);
    expect(plain).toContain("call `editDashboard` to save them");
    const positional = await render("training-dashboard-update", { weeks: "coach.html" });
    expect(positional).toContain('`path` = "coach.html"');
    expect(positional).toContain("no `weeks` (the page keeps its weeks)");
    const upper = await render("training-dashboard-update", { weeks: "6", path: "Coach.HTML" });
    expect(upper).toContain('`path` = "Coach.HTML"');
  });

  it("passes on a path without .html, so the tool can refuse it", async () => {
    const text = await render("training-dashboard-update", { path: "coach" });
    expect(text).toContain('`path` = "coach"');
    expect(text).toContain("no `weeks` (the page keeps its weeks)");
  });

  it("treats a positional value without .html as weeks, not as a path", async () => {
    const text = await render("training-dashboard-update", { weeks: "8" });
    expect(text).not.toContain("`path`");
    expect(text).toContain("`weeks` = 8");
  });

  it("asks Claude to name the failed days and the failed sections", async () => {
    for (const text of [
      await render("training-dashboard"),
      await render("training-dashboard-update"),
      await render("training-dashboard", { layout: "freeform" }),
    ]) {
      expect(text).toContain("failedDates");
      expect(text).toContain("failedSections");
    }
  });

  it("offers the automatic refresh when a page is made, and only mentions it on an update", async () => {
    for (const text of [
      await render("training-dashboard"),
      await render("training-dashboard", { layout: "freeform" }),
      await render("dashboard-setup"),
    ]) {
      expect(text).toContain("ask me once whether to update the page automatically");
      expect(text).toContain("removes the coach notes");
      expect(text).toContain("in my own words, in any language");
      expect(text).toContain("call `scheduleDashboardRefresh` with `cron`");
    }
    const update = await render("training-dashboard-update");
    expect(update).toContain("`scheduleDashboardRefresh` without arguments");
    expect(update).not.toContain("ask me once");
  });

  it("asks the setup questions with the built-in languages and themes, and the weeks", async () => {
    const text = await render("dashboard-setup", { weeks: "8" });
    expect(text).toContain("last **8 weeks** (today is 2026-10-28)");
    expect(text).toContain('"All: English, Italian, German, French, Spanish, and Portuguese"');
    expect(text).toContain("the codes to keep: en, it");
    expect(text).toContain('options "Training + Recovery" (default) and "Type my own"');
    expect(text).toContain("system, midnight, graphite");
    expect(text).toContain("`preview` = true");
    expect(text.includes("{{")).toBe(false);
    expect(await render("dashboard-setup")).toContain("last **12 weeks**");
  });

  it("has the names, descriptions and arguments of the reference prompt list", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map(shape).toSorted((a, b) => a.name.localeCompare(b.name))).toEqual(
      promptList.map(shape),
    );
  });

  it("returns the prompt description with the messages", async () => {
    const result = await client.getPrompt({ name: "training-dashboard", arguments: {} });
    expect(result.description).toBe(
      promptList.find((p) => p.name === "training-dashboard")?.description,
    );
  });

  it("fills the dates of the time window from today", async () => {
    const text = await render("training-dashboard", { weeks: "4", layout: "freeform" });
    expect(text).toBe(
      template("training-dashboard-freeform")
        .replaceAll("{{weeks}}", "4")
        .replaceAll("{{today}}", "2026-10-28")
        .replaceAll("{{startDate}}", "2026-09-30")
        .replaceAll("{{prevStartDate}}", "2026-08-26")
        .replaceAll("{{prevEndDate}}", "2026-09-29"),
    );
  });

  it.each([
    ["", 12],
    ["8", 8],
    [" 8 ", 8],
    ["+8", 8],
    ["0", 1],
    ["-3", 1],
    ["99", 52],
    ["eight", 12],
    ["8.5", 12],
    ["99999999999", 52],
  ])("reads weeks %j as %i", async (weeks, expected) => {
    expect(await render("training-dashboard", { weeks })).toContain(`last **${expected} weeks**`);
  });

  it("trims any whitespace and control characters around an argument", async () => {
    expect(await render("training-dashboard", { weeks: "\u00018\t" })).toContain(
      "last **8 weeks**",
    );
    expect(await render("training-dashboard", { weeks: "\u00a08\u2003" })).toContain(
      "last **8 weeks**",
    );
  });
});

describe("widget and language prompts", () => {
  it("puts the idea into the widget prompt", async () => {
    const text = await render("dashboard-widget", { idea: "  my longest ride each month\n" });
    expect(text).toContain("dashboard: my longest ride each month. Use");
    expect(text).toContain("Never invent");
    expect(text.includes("{{")).toBe(false);
  });

  it("adds the widget to the page file given as path", async () => {
    const text = await render("dashboard-widget", { idea: "my longest ride", path: "coach.html" });
    expect(text).toContain("dashboard: my longest ride. Use");
    expect(text).toContain('with no other arguments and `path` = "coach.html". Read');
    expect(text).toContain('call `writeDashboard` with `path` = "coach.html" first');
    expect(text).toContain('(`all` if no board fits) and `path` = "coach.html".');
    expect(text).toContain('call `editDashboard` again with `path` = "coach.html", at most');
    expect(text.includes("{{")).toBe(false);
  });

  it("takes a last word ending in .html as the page file", async () => {
    const text = await render("dashboard-widget", { idea: "my longest ride coach.html" });
    expect(text).toContain("dashboard: my longest ride. Use");
    expect(text).toContain('`path` = "coach.html"');
  });

  it("rejoins an idea that the slash command split by position", async () => {
    const text = await render("dashboard-widget", { idea: "my", path: "longest ride coach.html" });
    expect(text).toContain("dashboard: my longest ride. Use");
    expect(text).toContain('`path` = "coach.html"');
  });

  it("passes on a named path without .html", async () => {
    const text = await render("dashboard-widget", { idea: "my longest ride", path: "coach" });
    expect(text).toContain("dashboard: my longest ride. Use");
    expect(text).toContain('`path` = "coach"');
  });

  it("leaves out path when no file is given", async () => {
    const text = await render("dashboard-widget", { idea: "my longest ride" });
    expect(text).not.toContain("`path`");
    expect(text.includes("{{")).toBe(false);
  });

  it("asks for the language, or uses the language of the chat", async () => {
    expect(await render("dashboard-language", { language: "German" })).toContain(
      "Add German to my",
    );
    expect(await render("dashboard-language", {})).toContain(
      "Add my language (the language of this chat) to my",
    );
  });

  it("adds the language to the page file given as path, also as the only argument", async () => {
    const text = await render("dashboard-language", { language: "German", path: "coach.html" });
    expect(text).toContain("Add German to my");
    expect(text).toContain('with `englishTexts: true` and `path` = "coach.html"');
    expect(text).toContain('call `writeDashboard` with `path` = "coach.html" first');
    expect(text).toContain('} and `path` = "coach.html".');
    expect(text.includes("{{")).toBe(false);
    const positional = await render("dashboard-language", { language: "coach.html" });
    expect(positional).toContain("Add my language (the language of this chat) to my");
    expect(positional).toContain('`path` = "coach.html"');
    const odd = await render("dashboard-language", { language: "German", path: "coach.htm" });
    expect(odd).toContain('`path` = "coach.htm"');
    expect(odd).toContain("German");
    const plain = await render("dashboard-language", { language: "German" });
    expect(plain).not.toContain("`path`");
    expect(plain).toContain("call `writeDashboard` first");
  });
});

describe("workout comparison", () => {
  it("asks for it in every prompt that makes a page, when runs repeat a name", async () => {
    for (const layout of ["preset", "blank"]) {
      const text = await render("training-dashboard", { layout });
      expect(text).toContain("**Workout comparison**: only when `repeatedRuns` is not empty");
      expect(text).toContain("give `settings` with `workouts` = true");
    }
    const freeform = await render("training-dashboard", { layout: "freeform" });
    expect(freeform).toContain("If\n`repeatedRuns` of its `digest` is not empty");
    expect(freeform).toContain(
      "`window.GARMIN_SETTINGS = /* garmin-settings:start */null/* garmin-settings:end */;`",
    );
    expect(freeform).toContain('give `settings` = { "workouts": true }');
    expect(freeform).toContain("10. **Workout trend**, only when I said yes");
    const setup = await render("dashboard-setup");
    expect(setup).toContain("ask about the **Workout comparison**, only when `repeatedRuns`");
    expect(setup).toContain("`workouts` (true when I said yes to the workout comparison)");
    // an update keeps the choice of the page and asks nothing
    expect(await render("training-dashboard-update")).not.toContain("Workout comparison");
  });
});

describe("coach prompts", () => {
  it.each(["run-review", "strength-review"])(
    "%s shows a night without sleep data as n/a",
    async (name) => {
      const text = (await render(name)).replace(/\s+/g, " ");
      expect(text).toContain(
        'A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".',
      );
    },
  );

  it("reviews a run by id, by name, or the latest run", async () => {
    const byId = await render("run-review", { activity: " 21000000123 " });
    expect(byId).toContain("`activityId` = 21000000123.");
    expect(byId).toContain("Today is\n2026-10-28.");
    expect(byId).toContain('a failed call shows as "n/a"');
    expect(byId.includes("{{")).toBe(false);
    const byName = await render("run-review", { activity: "Riverside" });
    expect(byName).toContain('`names` = ["Riverside"] and `limit` = 100');
    // the slash command can pass only the first word of the name
    expect(byName).toContain(
      "when the runs have more than one name, list the 5 most recent with date and name and ask me which one",
    );
    // 100 activities answer about 55,000 characters, over a client's tool output limit: page by 20
    const latest = await render("run-review");
    expect(latest).toContain(
      "Call `listActivities` and take the most recent run (a type that ends in `running`). When none of them is one, call it again with `endDate` = the day of the oldest activity in the list, until you find one.",
    );
    expect(latest).not.toContain("`limit` = 100");
  });

  it("strength-review says what to compare when a set has no e1RM, no reps or another form", async () => {
    const text = (await render("strength-review")).replace(/\s+/g, " ");
    expect(text).toContain(
      "A set with 0 reps was not done: leave it and its `restSec` out of every count and median.",
    );
    expect(text).toContain(
      'When the top set has more than 12 reps, its e1RM is "n/a" and the change in % is of its weight.',
    );
    expect(text).toContain(
      'When the previous session has the exercise in another form (timed sets against sets with reps, or sets without weight against sets with weight), show its comparison as "n/a".',
    );
    // a search by name in step 1 already holds this session and the previous ones
    expect(text).toContain(
      "3. When step 1 called `listActivities` with `names`, use its rows; otherwise call `listActivities` with `names` = [the session's name] and `limit` = 100",
    );
  });

  it("reviews a strength session by id, by name, or the latest one", async () => {
    const byId = await render("strength-review", { activity: "21000000456" });
    expect(byId).toContain("The strength session is the activity with `activityId` = 21000000456.");
    expect(byId).toContain('a failed call shows as "n/a"');
    expect(byId.includes("{{")).toBe(false);
    const byName = await render("strength-review", { activity: "Upper" });
    expect(byName).toContain(
      'Call `listActivities` with `names` = ["Upper"] and `limit` = 100, and keep the strength sessions (a type that contains `strength`).',
    );
    expect(byName).toContain(
      "when the strength sessions have more than one name, list the 5 most recent",
    );
    expect(await render("strength-review")).toContain(
      "Call `listActivities` and take the most recent strength session (a type that contains `strength`). When none of them is one,",
    );
  });

  it("compares planned sets with done sets and never shows a planned weight", async () => {
    // the sentences as one line: the template wraps them anywhere
    const text = (await render("strength-review")).replace(/\s+/g, " ");
    // Garmin names the planned exercise by its constant, the sets by words
    expect(text).toContain('(`BARBELL_BACK_SQUAT` is "Barbell Back Squat", case ignored)');
    expect(text).toContain("The plan has no weights: do not show a planned weight.");
    expect(text).toContain("A set with 0 reps was not done");
    expect(text).toContain("the previous session when it has that exercise");
    // a step can plan a range of reps as its target, without a duration
    expect(text).toContain("REPS plans `targetValueLow` to `targetValue` reps");
    // a set over 12 reps has no e1RM: it is the top set only when no set has 1 to 12 reps
    expect(text).toContain("the heaviest set of 1 to 12 reps, then the most reps;");
    // a rep target can have no upper value: Garmin sends 0
    expect(text).toContain("when `targetValue` is 0 or under it, at least `targetValueLow` reps");
    // a short rest inside the block is the condition: straight sets with a long rest after them are no group
    expect(text).toContain(
      "a repeat block whose rest inside it is 20 s or less or OPEN, with a longer rest step right after the block",
    );
    expect(text).toContain("compare only the first set of each group");
    // two exercises in one block share the rest step after the second one, inside the block
    expect(text).toContain(
      "Two exercises in one repeat block with one rest step after the second, inside the block, are a superset",
    );
    expect(text).toContain("compare each with the rests after the sets it follows");
    expect(text).toContain("as the warm-up or cool-down, without hit or miss");
    // a rep target with timed sets done: the sets compare, the reps cannot
    expect(text).toContain("When the done sets have no reps (timed sets), judge the sets only");
    expect(text).toContain("The warm-up and cool-down stay out of Sets and Rest.");
    // the time of a timed set follows the lap button: it is no gain or loss
    expect(text).toContain("for a timed one, the longest set in seconds, without a change");
  });

  it("keeps the data that the page settings leave out of the coach notes", async () => {
    const texts = await Promise.all([
      render("training-dashboard"),
      render("training-dashboard", { layout: "freeform" }),
      render("training-dashboard-update"),
      render("dashboard-setup"),
    ]);
    for (const text of texts) {
      // the digest has no excluded data, but an earlier tool result in the chat can
      expect(text.replace(/\s+/g, " ")).toContain(
        "Do not mention in the notes the data or the sports that the `settings` of the reply exclude. This rule applies also to data that another tool showed earlier in this chat.",
      );
    }
  });

  it("checks race readiness with the race, the goal and the plan", async () => {
    const text = await render("race-readiness", {
      date: "2026-11-15",
      distance: "half",
      goal: "1:45:00",
    });
    expect(text).toContain("Race: half on 2026-11-15, goal time 1:45:00.");
    // the digest from a preview, not the whole getDashboardData result
    expect(text).toContain("Call `writeDashboard` with `preview` = true and `weeks` = 12.");
    expect(text).toContain(
      "Call `listActivities` with `startDate` = 2026-08-05 and `limit` = 100.",
    );
    expect(text).toContain("my goal time of 1:45:00");
    expect(text).toContain("from the goal time when it is realistic");
    expect(text).not.toContain("is missing");
    expect(text.includes("{{")).toBe(false);
  });

  it("reads the race date and goal by their shape from any slot, as the slash command passes them", async () => {
    // "/mcp__garmin-personal__race-readiness half marathon 2026-11-15 1:45:00" fills the slots in order
    const text = await render("race-readiness", {
      date: "half",
      distance: "marathon",
      goal: "2026-11-15 1:45:00",
    });
    expect(text).toContain("Race: half marathon on 2026-11-15, goal time 1:45:00.");
  });

  it("asks for a missing race date or distance, and predicts only without a goal", async () => {
    const text = await render("race-readiness", { distance: "10k" });
    expect(text).toContain("Race: 10k on a date not given.");
    expect(text).toContain("The race date or distance is missing: ask me for it");
    expect(text).toContain("I have no goal time: give the prediction only.");
    expect(text).toContain("split, from the prediction.");
    expect(await render("race-readiness", { date: "2026-11-15" })).toContain(
      "Race: distance not given on 2026-11-15.",
    );
  });
});
