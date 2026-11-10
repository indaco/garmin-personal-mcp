import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
        '"Use the defaults: all sports, all data, English and\n     the language of my Garmin profile, all themes, opens in midnight, no workout comparison, no\n     Recovery trend"',
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

  it("gives a freeform page a pinned Chart.js and a policy that blocks requests", async () => {
    const text = await render("training-dashboard", { layout: "freeform" });
    expect(text).toMatch(
      /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.\d+\.\d+\/chart\.umd(\.min)?\.js" integrity="sha512-[A-Za-z0-9+/=]{88}" crossorigin="anonymous"><\/script>/,
    );
    expect(text).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`,
    );
    expect(text).not.toContain("unsafe-eval");
    expect(text).not.toContain("self-contained");
    expect(text).toContain("`const DATA = /* garmin-data:start */null/* garmin-data:end */;`");
    expect(text).toContain("first in the first inline script of the page");
    expect(text.includes("{{")).toBe(false);
    const flat = text.replace(/\s+/g, " ");
    for (const line of [
      "Write the page as one HTML file, with everything inline except Chart.js. It has no calls to Garmin.",
      "Load Chart.js with exactly this tag.",
      "Put this tag first in `<head>`, exactly as it is. It blocks requests from the page:",
      "Do not load anything else from the web.",
      "Do not put data into the code.",
    ]) {
      expect(flat).toContain(line);
    }
    expect(flat).not.toContain("sending the data anywhere");
  });

  it("pins the hash of the Chart.js file that the dev dependency has", async () => {
    const text = await render("training-dashboard", { layout: "freeform" });
    const m = text.match(/Chart\.js\/(\d+\.\d+\.\d+)\/([\w.]+)" integrity="sha512-([^"]+)"/);
    expect(m).not.toBeNull();
    const [, version, file, hash] = m as RegExpMatchArray;
    const pkg = JSON.parse(
      readFileSync(new URL("../node_modules/chart.js/package.json", import.meta.url), "utf8"),
    );
    // cdnjs can be behind npm: a bump of the dev dependency must not fail here.
    if (pkg.version !== version) return;
    const bytes = readFileSync(new URL(`../node_modules/chart.js/dist/${file}`, import.meta.url));
    expect(createHash("sha512").update(bytes).digest("base64")).toBe(hash);
  });

  it.each(["preset", "blank"])("does not give the CDN tag to the %s layout", async (layout) => {
    const text = await render("training-dashboard", { layout });
    expect(text).not.toContain("cdnjs");
  });

  it("tells the update prompt that a page with different page code gets the server's code", async () => {
    const text = (await render("training-dashboard-update", {})).replace(/\s+/g, " ");
    expect(text).toContain("A page with different page code gets the page code of the server");
    expect(text).not.toContain("older template");
  });

  it("tells the update prompt to name both server versions after a refresh, in step 1", async () => {
    const argSets: Record<string, string>[] = [
      {},
      { weeks: "8" },
      { path: "coach.html" },
      { weeks: "8", path: "coach.html" },
    ];
    for (const args of argSets) {
      const text = (await render("training-dashboard-update", args)).replace(/\s+/g, " ");
      const rule = text.indexOf('`page: "upgraded"`');
      expect(rule).toBeGreaterThan(text.indexOf("1. Call `writeDashboard`"));
      expect(rule).toBeLessThan(text.indexOf("2. Write at most"));
      expect(rule).toBeLessThan(text.indexOf("3. Call `writeDashboard` again"));
      const step1 = text.slice(text.indexOf("1. Call"), text.indexOf("2. Write at most"));
      expect(step1).toContain("`previousServer`");
      expect(step1).toContain("`server`");
      expect(step1).toContain('"n/a"');
      expect(step1).toContain("reply of this first call");
      expect(step1).toContain("do not guess a version");
    }
  });

  it("tells the update prompt to name the added widgets of the first call, in step 1", async () => {
    const argSets: Record<string, string>[] = [{}, { weeks: "8", path: "coach.html" }];
    for (const args of argSets) {
      const text = (await render("training-dashboard-update", args)).replace(/\s+/g, " ");
      const step1 = text.slice(text.indexOf("1. Call"), text.indexOf("2. Write at most"));
      expect(step1).toContain("`addedWidgets`");
      expect(step1).toContain("reply of this first call has `addedWidgets`");
      expect(step1).toContain("The reply of step 3 does not have them");
      expect(step1).toContain("Without `addedWidgets`, say nothing about added widgets");
      expect(step1).toContain("do not make up a title");
      expect(step1).toContain("If the reply has `skippedWidgets`");
    }
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
      expect(text).toContain("failedDetails");
      expect(text).toContain("stoppedEarly");
    }
  });

  it("tells Claude that the last saved zones and units are used when a call fails", async () => {
    for (const text of [
      await render("training-dashboard"),
      await render("training-dashboard-update"),
      await render("training-dashboard", { layout: "freeform" }),
    ]) {
      expect(text).toContain("last saved");
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

  it("tells the setup prompt to name the widgets that its write added", async () => {
    const text = (await render("dashboard-setup")).replace(/\s+/g, " ");
    const step4 = text.slice(text.indexOf("4. Call `writeDashboard`"), text.indexOf("5. Unless"));
    expect(step4).toContain("If the reply has `addedWidgets`");
    expect(step4).toContain("Without it, say nothing about them");
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
    const sorted = prompts.toSorted((a, b) => a.name.localeCompare(b.name));
    if (process.env.UPDATE_DOCS) {
      const rows = sorted.map(({ name, description, arguments: args }) => ({
        name,
        description,
        arguments: args,
      }));
      writeFileSync("test/fixtures/prompt-list.json", `${JSON.stringify(rows, null, 2)}\n`);
    } else {
      expect(sorted.map(shape), "the prompt list changed: run pnpm guide").toEqual(
        promptList.map(shape),
      );
    }
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
        .replaceAll("{{startDate}}", "2026-09-28")
        .replaceAll("{{prevStartDate}}", "2026-08-24")
        .replaceAll("{{prevEndDate}}", "2026-09-27"),
    );
  });

  it.each([
    ["2026-10-26", "4", "2026-09-28", "2026-08-24", "2026-09-27"],
    ["2026-11-01", "4", "2026-09-28", "2026-08-24", "2026-09-27"],
    ["2026-11-01", "1", "2026-10-19", "2026-10-05", "2026-10-18"],
    ["2027-01-03", "1", "2026-12-21", "2026-12-07", "2026-12-20"],
  ])(
    "starts the time window on a Monday when today is %s",
    async (today, weeks, start, prevStart, prevEnd) => {
      const [y, m, d] = today.split("-").map(Number);
      vi.setSystemTime(new Date(y, m - 1, d, 12));
      const text = await render("training-dashboard", { weeks, layout: "freeform" });
      expect(text).toBe(
        template("training-dashboard-freeform")
          .replaceAll("{{weeks}}", weeks)
          .replaceAll("{{today}}", today)
          .replaceAll("{{startDate}}", start)
          .replaceAll("{{prevStartDate}}", prevStart)
          .replaceAll("{{prevEndDate}}", prevEnd),
      );
    },
  );

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

  it("keeps the dollar patterns of an argument as typed", async () => {
    const idea = "cost over $$100, $& and $' and $` and $1";
    const text = await render("dashboard-widget", { idea });
    expect(text).toContain(`dashboard: ${idea}. Use`);
  });

  it("keeps a marker in an argument as typed and fills the markers of the template", async () => {
    const idea = "rides {{pathWith}} on {{today}}, {{idea}} and {{today";
    const text = await render("dashboard-widget", { idea, path: "coach.html" });
    expect(text).toContain(`dashboard: ${idea}. Use`);
    expect(text).toContain('call `writeDashboard` with `path` = "coach.html" first');
    expect(text).toContain('call `editDashboard` again with `path` = "coach.html", at most');
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

  it("tells the assistant not to translate a built-in language", async () => {
    // by name, by code, not built in, and the language of the chat
    const cases: Record<string, string>[] = [
      { language: "German" },
      { language: "de" },
      { language: "Dutch" },
      {},
    ];
    for (const args of cases) {
      const text = await render("dashboard-language", args);
      expect(text).toContain("built in: Italian (it), German (de),");
      expect(text).toContain("is one of them, do not translate");
      expect(text.includes("{{")).toBe(false);
    }
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

/** The prompt on one line per paragraph, so that a reflow does not change a pin. */
const pageText = async (name: string, args: Record<string, string> = {}) =>
  (await render(name, args)).replace(/\s+/g, " ");

describe("recovery trend", () => {
  const ask =
    '**Recovery trend**: only when `settings` has no `recoveryHistory` and its `exclude` has no `recovery`. Options "No" (default) and "Yes, add the Recovery trend". Say that a yes adds a widget with the weekly average of sleep, sleep score and resting HR for the whole period, and that the page file then holds these values for each day: this matters for a page that I share.';

  it("is asked in the preset and blank prompts, and given as a setting", async () => {
    for (const layout of ["preset", "blank"]) {
      const text = await pageText("training-dashboard", { layout });
      expect(text).toContain(ask);
      expect(text).toContain(
        "Do the same with `recoveryHistory` = true if I said yes to the Recovery trend.",
      );
    }
  });

  it("is asked in the freeform prompt, with the settings and the board", async () => {
    const text = await pageText("training-dashboard", { layout: "freeform" });
    expect(text).toContain("## Recovery trend");
    expect(text).toContain(
      'After that question, ask whether to add a Recovery trend. Options "No" (default) and "Yes, add the Recovery trend".',
    );
    expect(text).toContain(
      'give `settings` with `"recoveryHistory": true`, next to `"workouts": true` when I also said yes to that.',
    );
    expect(text).toContain(
      "With `recoveryHistory`, the rows cover the whole period: a row older than the last 14 days has only `date`, `sleepH`, `sleepScore` and `rhr`, so a panel of the last 14 days uses the last 14 rows.",
    );
    expect(text).toContain(
      "Only when I said yes to the Recovery trend: a weekly chart over the week window with the mean of `sleepH`, `sleepScore` and `rhr`. A mean counts only days with a value above 0, and a week with no value is a gap, never 0.",
    );
  });

  it("is asked in the setup prompt, and given as a setting", async () => {
    const setup = await pageText("dashboard-setup");
    expect(setup).toContain(
      'ask about the **Recovery trend**, only when I kept the recovery data. Options "No" (default) and "Yes, add the Recovery trend".',
    );
    expect(setup).toContain("`recoveryHistory` (true when I said yes to the Recovery trend)");
  });

  it("pins the other sentences of the Recovery trend in the three prompts", async () => {
    for (const layout of ["preset", "blank"]) {
      expect(await pageText("training-dashboard", { layout })).toContain(
        'opens in midnight, no workout comparison, no Recovery trend". Say that I can type my own choice',
      );
    }
    expect(await pageText("dashboard-setup")).toContain(
      "Say that a yes adds a widget with the weekly average of sleep, sleep score and resting HR for the whole period, and that the page file then holds these values for each day: this matters for a page that I share.",
    );
    const free = await pageText("training-dashboard", { layout: "freeform" });
    expect(free).toContain(
      "Say that a yes adds a section with the weekly average of sleep, sleep score and resting HR for the whole period, and that the page file then holds these values for each day: this matters for a page that I share. On a yes:",
    );
    expect(free).toContain(
      "Put the settings line of the Workout comparison first in the first inline script of the page, once.",
    );
    expect(free).toContain("Add the Recovery trend to the Recovery board (below).");
    expect(free).toContain("a week with no value is a gap, never 0.");
  });

  it("is not asked in an update, which keeps the choice of the page", async () => {
    expect(await render("training-dashboard-update")).not.toContain("Recovery trend");
  });
});

const check = (tests: string) =>
  render("swim-readiness", { date: "2026-08-01", distance: "1.9 km", tests });

describe("coach prompts", () => {
  it.each(["run-review", "strength-review", "swim-review", "ride-review"])(
    "%s shows a night without sleep data as n/a",
    async (name) => {
      const text = (await render(name)).replace(/\s+/g, " ");
      expect(text).toContain(
        'A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".',
      );
    },
  );

  it("run-review quotes split and the fade of each step instead of computing them", async () => {
    const text = (await render("run-review")).replace(/\s+/g, " ");
    expect(text).toContain(
      "The run is intervals when the `getActivityLaps` answer has `work`. Else it is steady.",
    );
    // the per-lap table of the reps stays
    expect(text).toContain("each active lap of 20 m and 8 s or more, with its pace, HR");
    expect(text).toContain(
      'Also the fade of each step from `work.fade`: `pct` is the last rep against the first, in %. When `pct` is null, the reps are not alike: write "n/a".',
    );
    expect(text).toContain("`split.hrDriftPct`");
    // the same boundary as the page: drift above 5% is bad
    expect(text).toContain("5% or less shows a solid aerobic base.");
    expect(text).toContain('When it is null, a lap has no heart rate: write "n/a".');
    expect(text).toContain('When `split` is null, the run has fewer than 2 laps: write "n/a" too.');
    expect(text).not.toContain("The halves split at half the distance");
  });

  it("run-review quotes the plan of getActivityLaps as the plan against execution", async () => {
    const text = (await render("run-review")).replace(/\s+/g, " ");
    const call = text.slice(text.indexOf("2. Call"), text.indexOf("3. Call"));
    // the plan comes from the .FIT file: no getActivityWorkouts call
    expect(call).toBe("2. Call `getActivity` and `getActivityLaps` with its `activityId`. ");
    const plan = text.slice(
      text.indexOf("- **Plan against execution**"),
      text.indexOf("- **Reps**"),
    );
    expect(plan).toBe(
      [
        "- **Plan against execution**: when `plan` of `getActivityLaps` is not null, a table with one row",
        "per row of `plan.laps`, in lap order: the lap, its `step`, the target (`type`, `low` to `high` in",
        "its `unit`, or its `zone`), what the lap did (`done`), and the `verdict` (hit or miss) with `off`",
        "(how far outside the target, in its unit; for a pace, above 0 is slower). Quote the verdict: do",
        "not judge a lap yourself. A row with a null `verdict` has no hit or miss, and a row with a null",
        '`target` has no target. A null value shows as "n/a". When `plan` is null, say "no planned',
        'workout" in one line. ',
      ].join(" "),
    );
  });

  it("reviews a run by id, by name, or the latest run", async () => {
    const byId = await render("run-review", { activity: " 21000000123 " });
    expect(byId).toContain("`activityId` = 21000000123.");
    expect(byId).toContain("Today is\n2026-10-28.");
    expect(byId).toContain('a failed call shows as "n/a"');
    expect(byId.includes("{{")).toBe(false);
    const byName = await render("run-review", { activity: "Riverside" });
    expect(byName).toContain('`names` = ["Riverside"], and keep the runs');
    expect(byName).not.toContain("`limit` = 100");
    expect(byName).toContain(
      "When no row is a run, say that none of my last 200 activities is a run with that name, and stop.",
    );
    // the slash command can pass only the first word of the name
    expect(byName).toContain(
      "when the runs have more than one name, list the 5 most recent with date and name and ask me which one",
    );
    // 100 activities answer about 55,000 characters, over a client's tool output limit: page by 20
    const latest = await render("run-review");
    expect(latest).toContain(
      "Call `listActivities` and take the most recent run (a type that ends in `running`). When none of them is one, call it again with `endDate` = the day of the oldest activity in the list, at most 5 calls in all. When none of them has one, say that none of my last 100 activities is a run, and stop.",
    );
    expect(latest).not.toContain("`limit` = 100");
  });

  it("strength-review says what to compare when a set has no e1RM, no reps or another form", async () => {
    const text = (await render("strength-review")).replace(/\s+/g, " ");
    expect(text).toContain(
      "A set with 0 reps was not done: leave it and its `restSec` out of every count and median.",
    );
    // the tool gives the top set and the e1RM: the prompt quotes them and computes neither
    expect(text).toContain(
      "the top set (`top`) and the e1RM (`e1rmKg`: the best estimate of its sets of 1 to 12 reps) of `getActivitySets`.",
    );
    expect(text).toContain(
      'When `e1rmKg` is null, show "n/a" and give the change in % of the top set\'s weight.',
    );
    expect(text).toContain("The e1RM is an estimate: say so.");
    expect(text).toContain("**Never invent or estimate a missing value**: a missing value");
    expect(text).not.toContain("kg × (1 + reps / 30)");
    expect(text).not.toContain("The top set is the heaviest set");
    expect(text).toContain(
      'When the previous session has the exercise in another form (timed sets against sets with reps, or sets without weight against sets with weight), show its comparison as "n/a".',
    );
    // a search by name in step 1 already holds this session and the previous ones
    expect(text).toContain(
      "3. When step 1 called `listActivities` with `names`, use its rows; otherwise call `listActivities` with `names` = [the session's name] and `endDate` = the session's day (`getActivity` gives the name and the day when you have only the id). Its row of this session is the summary. The previous session is the most recent strength session of the same name before this one: call `getActivitySets` with its `activityId`. Without one, show the comparison as \"n/a\".",
    );
    expect(text).not.toContain("`limit` = 100");
  });

  it("reviews a strength session by id, by name, or the latest one", async () => {
    const byId = await render("strength-review", { activity: "21000000456" });
    expect(byId).toContain("The strength session is the activity with `activityId` = 21000000456.");
    expect(byId).toContain('a failed call shows as "n/a"');
    expect(byId.includes("{{")).toBe(false);
    const byName = await render("strength-review", { activity: "Upper" });
    expect(byName).toContain(
      'Call `listActivities` with `names` = ["Upper"], and keep the strength sessions (a type that contains `strength`).',
    );
    expect(byName).not.toContain("`limit` = 100");
    expect(byName).toContain(
      "When no row is a strength session, say that none of my last 200 activities is a strength session with that name, and stop.",
    );
    expect(byName).toContain(
      "when the strength sessions have more than one name, list the 5 most recent",
    );
    expect(await render("strength-review")).toContain(
      "Call `listActivities` and take the most recent strength session (a type that contains `strength`). When none of them is one, call it again with `endDate` = the day of the oldest activity in the list, at most 5 calls in all. When none of them has one, say that none of my last 100 activities is a strength session, and stop.",
    );
  });

  it("compares planned sets with done sets and never shows a planned weight", async () => {
    // the sentences as one line: the template wraps them anywhere
    const text = (await render("strength-review")).replace(/\s+/g, " ");
    expect(text).toContain("The plan has no weights: do not show a planned weight.");
    expect(text).toContain("A set with 0 reps was not done");
    expect(text).toContain("the previous session when it has that exercise");
    // a group starts after a rest over 20 s: the first value of plannedRestSec is the short rest
    expect(text).toContain(
      "a group starts at the first set and at each set after a `restSec` over 20",
    );
    expect(text).toContain("compare only the first set of each group");
    expect(text).toContain(
      'When it is empty, the plan has no rest right after the exercise (for example the first exercise of a superset): show "n/a (no planned rest)".',
    );
    expect(text).toContain("`plannedRestSec` of its rows in `plan.exercises`");
    const call = text.slice(text.indexOf("2. Call"), text.indexOf("3. When"));
    // the planned rest comes from the .FIT file: no getActivityWorkouts call
    expect(call).toBe("2. Call `getActivitySets` with its `activityId`. ");
    expect(text).not.toContain("getActivityWorkouts");
    expect(text).toContain("compare each with the rests after the sets it follows");
    expect(text).toContain("The warm-up and cool-down stay out of Sets and Rest.");
    // the time of a timed set follows the lap button: it is no gain or loss
    expect(text).toContain("for a timed one, the longest set in seconds, without a change");
  });

  it("quotes the plan of getActivitySets as the plan against execution", async () => {
    const text = (await render("strength-review")).replace(/\s+/g, " ");
    const bullet = text.slice(
      text.indexOf("- **Plan against execution**"),
      text.indexOf("- **Sets**"),
    );
    expect(bullet).toBe(
      [
        "- **Plan against execution**: when `plan` of `getActivitySets` is not null, a table with one",
        "row per row of `plan.exercises`, in its order: the exercise, the planned sets and reps",
        '(`plannedSets`, `plannedReps` from `low` to `high`; `high` null is "at least `low`"), the done',
        "sets and reps (`doneSets`, `reps`), and the `verdict` (hit or miss) with its `why` (`sets`,",
        "`reps`). Add `extra` (done sets above the plan) and `over` (done sets above the high end) when",
        "they are not 0. Show a row with `part` as the warm-up or cool-down and a row with `notInPlan` as",
        '"not in the plan", both without hit or miss. The plan has no weights: do not show a planned',
        'weight. A null value shows as "n/a". The warm-up and cool-down stay out of Sets and Rest. When',
        '`plan` is null, say "no planned workout" in one line. ',
      ].join(" "),
    );
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
    // one call: the long runs and the race predictions are in the digest
    expect(text).not.toContain("listActivities");
    expect(text).not.toContain("getActivityLaps");
    expect(text).toContain("`longRuns`");
    expect(text).toContain("`racePredictions`");
    expect(text).toContain("my goal time of 1:45:00");
    expect(text).toContain("from the goal time when it is realistic");
    expect(text).not.toContain("is missing");
    expect(text.includes("{{")).toBe(false);
  });

  it("quotes the digest's aerobic efficiency in the training block", async () => {
    const text = (await render("race-readiness", { date: "2026-11-15" })).replace(/\s+/g, " ");
    const block = text.slice(
      text.indexOf("- **Training block**"),
      text.indexOf("- **Load and taper**"),
    );
    expect(block).toBe(
      "- **Training block**: a table of the run km (`weekly.<monday>.runKm`) and the load of each week. The first week can be partial (`partial: true`): say so. Also the longest run and its date (`longestRun`). For each long run (`longRuns`): the pace of the first and the second half, the split, and the HR drift. An HR drift of 5% or less shows a solid aerobic base. `null` is n/a: for example, a lap without heart rate. Then the aerobic efficiency (`aerobicEfficiency`): the metres per heartbeat of the runs below zone 4, the last `comparedWeeks` weeks against the first, and the change in % (`changePct`). A higher value is more distance for each heartbeat. A null value, or no `aerobicEfficiency`, is n/a. ",
    );
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

  it("checks today's training with the page's readiness and fitness from one call", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.find((p) => p.name === "train-today")?.arguments ?? []).toEqual([]);
    const text = await render("train-today");
    const flat = text.replace(/\s+/g, " ");
    expect(text.includes("{{")).toBe(false);
    expect(text).toContain("Today is 2026-10-28.");
    // the digest from a preview, with the weeks of the page
    expect(text).toContain("Call `writeDashboard` with `preview` = true.");
    expect(text).not.toContain("listActivities");
    expect(text).toContain("`readiness.verdict`");
    expect(text).toContain("`fitnessFatigue`");
    // the rules of the page's readiness(), in the same order
    expect(flat).toContain(
      '"easy" when the HRV status is LOW, or the sleep score is less than 60, or the resting HR is 5 bpm or more above the 7-day average.',
    );
    expect(flat).toContain(
      '"push" when the HRV status is BALANCED, the sleep score is 80 or more, and the load ratio is less than 1.3.',
    );
    expect(flat).toContain(
      "Say that this is the dashboard's own rule, not Garmin's Training Readiness.",
    );
    expect(flat).toContain(
      'If the digest has no `readiness`, write "n/a" for the verdict and for each input: there is no HRV and no sleep data.',
    );
    expect(flat).toContain(
      "If `settings.exclude` has `recovery`, say that the dashboard leaves out the recovery data.",
    );
    expect(flat).toContain(
      '**Never invent or estimate a missing value**: a missing value or a failed call shows as "n/a".',
    );
  });

  it("reviews the last whole week with the page's numbers from one call", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.find((p) => p.name === "week-review")?.arguments ?? []).toEqual([]);
    const text = await render("week-review");
    const flat = text.replace(/\s+/g, " ");
    expect(text.includes("{{")).toBe(false);
    expect(text).toContain("Today is 2026-10-28.");
    // Monday 2026-10-26 is this week's: the last whole week starts one week before
    expect(text).toContain("`2026-10-19`");
    expect(text).toContain("Call `writeDashboard` with `preview` = true.");
    expect(text).not.toContain("listActivities");
    expect(flat).toContain("without a row had no sessions");
    expect(flat).toContain("A week before `digest.period.start` has no data");
    expect(flat).toContain("say that the page does not cover it");
    expect(flat).toContain(
      "Do not mention the data or the sports that the `settings` of the reply exclude.",
    );
    expect(flat).toContain("not the reviewed week");
    expect(text).toContain('"n/a"');
    for (const line of template("week-review").split("\n")) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it("quotes the page's load ramp, monotony and strain of the digest", async () => {
    const text = (await render("week-review")).replace(/\s+/g, " ");
    const part = text.slice(
      text.indexOf("- **Against the weeks before**"),
      text.indexOf("- **New bests**"),
    );
    expect(part).toBe(
      '- **Against the weeks before**: how the week\'s load and hours compare with the mean of the weeks before it in the table, as a percent. Without an earlier week or with a null load, write "n/a". Then the page\'s load ramp of the week (`rampPct`): its load against the week before, in %. A ramp of more than 10% is the page\'s warning level: say so. A null `rampPct` is "n/a". - **Now**: the load ratio of 7 to 28 days (`load.acuteToChronic`), the monotony and strain of the last 7 days (`load.monotony`, `load.strain`), and `fitnessFatigue.form` (below 0 you carry fatigue). A monotony above 2 is the page\'s flag: the days are too alike. Say that these describe today, not the reviewed week. A null value is "n/a". If `fitnessFatigue` is null, write "n/a". ',
    );
  });

  it("lists the new run bests of the week from the digest's progression", async () => {
    const text = (await render("week-review")).replace(/\s+/g, " ");
    const part = text.slice(text.indexOf("- **New bests**"), text.indexOf("- **Strength plan**"));
    expect(part).toBe(
      '- **New bests**: the run bests of the week of `2026-10-19`: each entry of `recordProgression` with a date in that week, with the distance, the time and the `previous` time it beat. These are bests since `digest.period.start` only: an older, faster run can sit before that date, so name each one "best since" that date, never a personal record. A null `previous` means no earlier effort of that distance since that date, not a first ever. Without such an entry, write "none". ',
    );
  });

  it("quotes the plan verdicts of the strength sessions done, and says that skipped ones are not seen", async () => {
    const text = (await render("week-review")).replace(/\s+/g, " ");
    const part = text.slice(text.indexOf("- **Strength plan**"), text.indexOf("- **Run plan**"));
    expect(part).toBe(
      '- **Strength plan**: the exercises hit and missed in the strength sessions of the week of `2026-10-19`, from its key in `strengthPlan.weeks`. These count only the sessions done: a planned session that was skipped leaves no file and is not seen, so never read "all hit" as "every planned session done". Then the exercises that miss most in the page period (`strengthPlan.mostMissed`), each with its misses of its sessions and the reason (`sets`: too few sets, `reps`: reps under the plan); an empty list is "none". A week without a key is "no planned strength session", and a null week is "n/a" (sets not read). Without `strengthPlan`, write "no planned strength session" in one line. ',
    );
  });

  it("quotes the lap verdicts of the runs read, and says how many runs were not read", async () => {
    const text = (await render("week-review")).replace(/\s+/g, " ");
    const part = text.slice(text.indexOf("- **Run plan**"), text.indexOf("- **Coach note**"));
    expect(part).toBe(
      '- **Run plan**: the laps on the planned target (hit) and off it (miss) in the runs of the week of `2026-10-19`, from its key in `runPlan.weeks`. These count only the runs whose laps the page read: a planned run that was skipped leaves no file and is not seen. Then the drills that miss most in the page period (`runPlan.mostMissed`), each with its workout, its target type, its misses of its laps, and how many laps were under (`low`) and over (`high`) the range; for a pace, under is faster. An empty list is "none". Then the planned runs with no target to check (`runPlan.untargeted`), and "N of M runs not read" with `runPlan.unread` and `runPlan.runs`. When `runPlan.unread` is above 0, add one sentence: the page setting `workouts` reads the laps of the runs whose workout name repeats. A week without a key is "no planned run with a target", and a null week is "n/a" (laps not read). Without `runPlan`, write "no run" in one line. ',
    );
  });

  it("starts the last whole week one week before a Monday, and before a Sunday", async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    expect(await render("week-review")).toContain(
      "The last whole week starts on Monday `2026-10-19`.",
    );
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    expect(await render("week-review")).toContain(
      "The last whole week starts on Monday `2026-10-19`.",
    );
  });

  it("swim-review quotes the set fade, keeps open water apart and does not judge on HR alone", async () => {
    const text = (await render("swim-review")).replace(/\s+/g, " ");
    expect(text).toContain("The swim is open water when its type contains `open_water`.");
    expect(text).toContain("each row of `sets`");
    expect(text).toContain("A lap with `metres` 0 or `intensity` `rest` is a rest");
    expect(text).toContain("Do not judge the swim on heart rate alone");
    expect(text).toContain("Compare SWOLF only within this swim");
    expect(text).toContain("**Never invent or estimate a missing value**");
    expect(text).toContain("the most recent swim (a type that contains `swimming`)");
    // the server judges no swim plan: the prompt must not ask the assistant for a verdict
    expect(text).not.toContain("what the lap did, and hit or miss");
    expect(text).toContain(
      "Give no hit or miss: the server judges no swim plan, so say in one line that the table shows the plan beside the laps.",
    );
    expect(text).toContain(
      '- **Plan against execution**: when `getActivityWorkouts` gives steps, a table with one row per lap that has a `step`: the step (its `intensity`, duration and target as `getActivityWorkouts` gives them) and what the lap did (`metres`, `time`, `swimPace`). A lap\'s `step` is the `stepIndex` of its plan step. Match by it, not in order. Give no hit or miss: the server judges no swim plan, so say in one line that the table shows the plan beside the laps. With an empty list, say "no planned workout" in one line.',
    );
    expect(text.includes("{{")).toBe(false);
  });

  it("swim-review finds a swim by id or by words of its name", async () => {
    expect(await render("swim-review", { activity: "21000000789" })).toContain(
      "The swim is the activity with `activityId` = 21000000789.",
    );
    const byName = await render("swim-review", { activity: "Morning" });
    expect(byName).toContain('`names` = ["Morning"]');
    expect(byName).toContain(
      "When no row is a swim, say that none of my last 200 activities is a swim with that name, and stop.",
    );
    expect(await render("swim-review")).toContain(
      "at most 5 calls in all. When none of them has one, say that none of my last 100 activities is a swim, and stop.",
    );
  });

  it("ride-review gives its whole text for a ride by id, with the argument trimmed", async () => {
    const text = (await render("ride-review", { activity: "\u0001 21000000790\t" })).replace(
      /\s+/g,
      " ",
    );
    expect(text).toBe(
      [
        "Review one of my rides as a cycling coach. Use the tools of the `garmin-personal` MCP server. Today",
        "is 2026-10-28.",
        "1. The ride is the activity with `activityId` = 21000000790.",
        "2. Call `getActivityLaps` and `getActivityWorkouts` with its `activityId`.",
        "3. Call `listActivities` with `names` = [the ride's full name] and `endDate` = the ride's day",
        "(`getActivity` gives the name and the day when you have only the id). Its row of this ride is the",
        "summary. The earlier rides are the rows before this one with the same `type` and the same name,",
        "ignoring case. Same name does not prove the same route: leave out a ride whose `km` differs from",
        "this ride's by more than 10%, and say how many you left out.",
        "When the summary row has no `sport`, or its `sport` is not `cycling`, say that the activity is not a",
        "ride, and stop.",
        "4. Call `getSleep` with `date` = the day after the ride (the night after it), and `getHrvRange` with",
        "`fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show the",
        'recovery as "n/a".',
        "The ride is a mountain-bike ride when its type is `mountain_biking`. Else it is a road ride. An",
        "indoor ride (type `indoor_cycling` or `virtual_ride`) has no real ascent: show its `ascentM`, also",
        'in the laps, and its ascent per hour as "n/a".',
        "Then answer in chat, in this order, short:",
        "- **Summary**, from the `listActivities` row: date, name, road or mountain bike, distance, the",
        "moving time `duration` (and `elapsed` when the row has it), the speed `kmh` (the row's `pace` is",
        "for foot sports, do not quote it), ascent `ascentM`, the ascent per hour `ascentMPerHour`, average",
        "and max HR, and the",
        "training effect (`aerobicTE`, `anaerobicTE` and its label `teLabel`) and the `trainingLoad`.",
        '- **Power**: `avgPowerW` and `normPowerW` of the row. When the row has neither, write "n/a: the ride',
        'has no power data" in one line, and give no power, IF or TSS from heart rate or speed.',
        "- **Trail**: for a mountain-bike ride, `grit` (how hard the trail was) and `flow` (how smoothly you",
        'rode it: lower is smoother). A missing value shows "n/a". Skip this part for a road ride.',
        "- **Effort**: `easyZonePct` (the share of the zone time in Z1-2) and `hardZonePct`",
        '(Z4-5). Without them, write "n/a".',
        "- **Plan against execution**: when `getActivityWorkouts` gives steps, a table with one row per lap",
        "that has a `step`: the step (its `intensity`, duration and target as `getActivityWorkouts` gives",
        "them) and what the lap did (`km`, `time`, `kmh`, `avgHR`, `avgPowerW`). A lap's `step` is the",
        "`stepIndex` of its plan step. Match by it, not in order. Give no hit or miss: the server judges no",
        "ride plan, so say in one line that the table shows the plan beside the laps. With an empty list,",
        'say "no planned workout" in one line.',
        "- **Laps**: when the ride has 2 laps or more, a table with one row per lap: `km`, `time`, `kmh`,",
        '`avgHR`, `cadence`, `ascentM` and `avgPowerW`, "n/a" when a lap has no value. A lap\'s speed follows',
        "its climb: do not read a slower lap with more `ascentM` as a fade. With 1 lap, skip this part.",
        "- **Same route**: the earlier rides of step 3, at most the 5 most recent: date, `km`, `kmh`,",
        "`ascentMPerHour`, average HR, and `grit` and `flow` for a mountain-bike ride. Say how many rides you compared",
        "and the date of the oldest. Wind, weather and the trail surface change speed and HR on one route:",
        "say so in one line. The search reads only the 200 activities before this ride: without an",
        'earlier ride, write "n/a: no earlier ride of this name in the 200 activities before it".',
        "- **Recovery**: the sleep score and hours of the night after the ride, and its HRV (`lastNightAvg`)",
        "against Garmin's 7-day average of that night (`weeklyAvg`).",
        'A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".',
        "- **Coach note**: 2 or 3 sentences: what went well and what to change next time. Base each sentence",
        "on a number above. Compare speed, HR and ascent per hour only with the rides of **Same route**: a",
        "hillier route gives a lower speed and a higher ascent per hour at the same fitness.",
        "Every number comes from a tool result. **Never invent",
        'or estimate a missing value**: a missing value or a failed call shows as "n/a". If a call fails, say',
        "which one and why in one line. Do not create or change a dashboard.",
      ].join(" ") + " ",
    );
  });

  it("ride-review finds a ride by id or by words of its name", async () => {
    expect(await render("ride-review", { activity: "21000000790" })).toContain(
      "The ride is the activity with `activityId` = 21000000790.",
    );
    const byName = await render("ride-review", { activity: "Trail" });
    expect(byName).toContain('`names` = ["Trail"], and keep the rides (`sport` = `cycling`).');
    expect(byName).toContain(
      "when the rides have more than one name, list the 5 most recent with date and name and ask me which one",
    );
    expect(byName).toContain(
      "When no row is a ride, say that none of my last 200 activities is a ride with that name, and stop.",
    );
    // a blank argument is no name: the latest ride, never a search for ""
    const latest = await render("ride-review", { activity: " \u2003\n" });
    expect(latest).toContain(
      "Call `listActivities` and take the most recent ride (`sport` = `cycling`).",
    );
    expect(latest).not.toContain('`names` = [""]');
    // digits inside a name are a name, not an id
    expect(await render("ride-review", { activity: "Loop 2" })).toContain('`names` = ["Loop 2"]');
  });

  it("ride-review shows no indoor ascent and stops on an activity that is not a ride", async () => {
    const text = (await render("ride-review")).replace(/\s+/g, " ");
    expect(text).toContain(
      'An indoor ride (type `indoor_cycling` or `virtual_ride`) has no real ascent: show its `ascentM`, also in the laps, and its ascent per hour as "n/a".',
    );
    expect(text).toContain(
      "the training effect (`aerobicTE`, `anaerobicTE` and its label `teLabel`) and the `trainingLoad`.",
    );
    expect(text).toContain(
      "When the summary row has no `sport`, or its `sport` is not `cycling`, say that the activity is not a ride, and stop.",
    );
  });

  it("ride-review quotes the numbers of the listActivities row and asks for no division", async () => {
    const text = (await render("ride-review")).replace(/\s+/g, " ");
    expect(text).toContain(
      "the speed `kmh` (the row's `pace` is for foot sports, do not quote it), ascent `ascentM`, the ascent per hour `ascentMPerHour`, average and max HR,",
    );
    expect(text).toContain(
      '- **Effort**: `easyZonePct` (the share of the zone time in Z1-2) and `hardZonePct` (Z4-5). Without them, write "n/a".',
    );
    expect(text).toContain(
      "- **Same route**: the earlier rides of step 3, at most the 5 most recent: date, `km`, `kmh`, `ascentMPerHour`, average HR, and `grit` and `flow` for a mountain-bike ride.",
    );
    expect(text).toContain("Every number comes from a tool result. **Never invent or estimate");
    expect(text).not.toContain("your own division");
  });

  describe("swim-readiness", () => {
    it("checks one event from the digest, with no prediction", async () => {
      const text = (await check("")).replace(/\s+/g, " ");
      expect(text).toContain("Event: 1.9 km on 2026-08-01.");
      expect(text).toContain("Call `writeDashboard` with `preview` = true and `weeks` = 12.");
      expect(text).not.toContain("listActivities");
      expect(text).toContain("`swims.weekly`");
      expect(text).toContain("`swims.poolTrend`");
      expect(text).toContain("Pool and open water in two separate tables");
      expect(text).toContain("Give no predicted time");
      expect(text).toContain("**Never invent or estimate a missing value**");
      expect(text).not.toContain("is missing");
      // weeks = 12 covers the 12 whole weeks and this week so far
      expect(text).toContain(
        'When the digest has no `swims`, say that the 12 weeks and this week have no swim, and show each swim value below as "n/a".',
      );
      expect(text).toContain("say how many of these weeks have a swim");
      expect(text).toContain(
        '- **Training block**: a table of the swims and km of each week (`swims.weekly`): the 12 whole weeks and this week so far. `null` km is "n/a": no swim of that week has a distance. Leave out the weeks that are not in `swims.weekly`, and say how many of these weeks have a swim.',
      );
      expect(text).not.toContain("first compared date");
      expect(text).toContain(
        'For the pool, `swims.poolTrend`: the pace and strokes per length of the last `comparedSwims` swims against as many before them, in one pool length (`poolLengthM`). `swims` is the number of swims of that pool length since `from`, the date of the first of them; `left` is the other swims (open water, another pool length, or no strokes). A `null` comparison is "n/a": too few swims, or too close together.',
      );
      expect(text.includes("{{")).toBe(false);
    });

    it("computes CSS from the two test times, in either order", async () => {
      for (const tests of ["3:10 6:40", "6:40 3:10"]) {
        const text = await check(tests);
        expect(text).toContain("My test times are 3:10 for 200 m and 6:40 for 400 m.");
        expect(text).toContain("= 1:45/100 m.");
      }
    });

    it.each([
      ["no time", "", "I gave no test times"],
      ["one time", "3:10", "I gave 3:10, not 2 test times"],
      ["three times", "3:10 6:40 3:20", "I gave 3:10, 6:40, 3:20, not 2 test times"],
      ["a 400 m at twice the 200 m", "3:20 6:40", "the test is not valid"],
      ["two equal times", "6:40 6:40", "the test is not valid"],
      ["a time of zero", "0:00 6:40", "the test is not valid"],
      ["a 400 m under twice the 200 m", "3:30 6:40", "the test is not valid"],
    ])("gives no CSS with %s", async (_why, tests, line) => {
      const text = await check(tests);
      expect(text).toContain(line);
      expect(text).toContain('"n/a"');
      expect(text).not.toContain("CSS = (400 m time");
    });

    it.each(["3:10, 6:40", "3:10,6:40"])("reads the test times %s", async (tests) => {
      const text = await check(tests);
      expect(text).toContain("Event: 1.9 km on 2026-08-01.");
      expect(text).toContain("= 1:45/100 m.");
    });

    it("keeps a decimal comma in the distance, and a time that is no time in the event", async () => {
      const text = await render("swim-readiness", {
        date: "2026-08-01",
        distance: "1,9 km",
        tests: "3:75",
      });
      expect(text).toContain("Event: 1,9 km 3:75 on 2026-08-01.");
      expect(text).toContain("I gave no test times");
    });

    it("reads the date and the times by their shape from any slot", async () => {
      // "/mcp__garmin-personal__swim-readiness 1.9 km 2026-08-01 3:10 6:40" fills the slots in order
      const text = await render("swim-readiness", {
        date: "1.9",
        distance: "km",
        tests: "2026-08-01 3:10 6:40",
      });
      expect(text).toContain("Event: 1.9 km on 2026-08-01.");
      expect(text).toContain("= 1:45/100 m.");
    });

    it("asks for a missing date or distance", async () => {
      const noDate = await render("swim-readiness", { distance: "3.8 km" });
      expect(noDate).toContain("Event: 3.8 km on a date not given.");
      expect(noDate).toContain("The event date or distance is missing: ask me for it");
      expect(await render("swim-readiness", { date: "2026-08-01" })).toContain(
        "Event: distance not given on 2026-08-01.",
      );
    });

    it("keeps an event distance with a dollar pattern or a marker as typed", async () => {
      const text = await render("swim-readiness", {
        date: "2026-08-01",
        distance: "$'1k {{today}}",
      });
      expect(text).toContain("Event: $'1k {{today}} on 2026-08-01.");
    });
  });

  it("keeps a race distance with a dollar pattern or a marker as typed", async () => {
    const text = await render("race-readiness", {
      date: "2026-12-06",
      distance: "$'10k {{today}}",
    });
    expect(text).toContain("Race: $'10k {{today}} on 2026-12-06.");
  });
});
