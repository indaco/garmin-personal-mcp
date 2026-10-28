import { readFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(preset.includes("{{") || blank.includes("{{")).toBe(false);
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

  it("asks the setup questions with the built-in languages and themes, and the weeks", async () => {
    const text = await render("dashboard-setup", { weeks: "8" });
    expect(text).toContain("last **8 weeks** (today is 2026-10-28)");
    expect(text).toContain('"English and Italian, opens in the browser language" (default)');
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

  it("asks for the language, or uses the language of the chat", async () => {
    expect(await render("dashboard-language", { language: "German" })).toContain(
      "Add German to my",
    );
    expect(await render("dashboard-language", {})).toContain(
      "Add my language (the language of this chat) to my",
    );
  });
});
