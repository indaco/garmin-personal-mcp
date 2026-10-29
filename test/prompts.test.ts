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

  it("asks to keep the saved settings of a preset or blank page, or to use the defaults", async () => {
    for (const layout of ["preset", "blank"]) {
      const text = await render("training-dashboard", { weeks: "8", layout });
      expect(text).toContain("1. Call `writeDashboard` with `preview` = true and `weeks` = 8.");
      expect(text).toContain("only when `settings` has more than `title` and `headline`");
      expect(text).toContain('"Keep these settings" (default)');
      expect(text).toContain(
        '"Use the defaults: all sports, all data, English and\n     the language of my Garmin profile, all themes, opens in midnight"',
      );
      expect(text).toContain('"all sports, keep the rest"');
      expect(text).toContain(
        "name each item it leaves out and say that the defaults put them back",
      );
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
