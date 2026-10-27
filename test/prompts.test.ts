import { readFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_VERSION } from "../src/prompts";
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
  it("buildAndUpdateShareTheDashboardVersion", async () => {
    const v = `"v": ${DASHBOARD_VERSION}`;
    const build = await render("training-dashboard", { weeks: "12" });
    const update = await render("training-dashboard-update");
    expect(build).toContain(v);
    expect(update).toContain(`its \`v\` is not ${DASHBOARD_VERSION}`);
    expect(build.includes("{{") || update.includes("{{")).toBe(false);
  });

  it("updateNumbersTheBuildSectionsB1ToB3", async () => {
    const update = await render("training-dashboard-update", { weeks: "8" });
    expect(update).toContain("### B1. Collect the data");
    expect(update).toContain("### B3. Build the dashboard");
    expect(update).toContain("#### Time window");
    expect(update).not.toContain("\n## 1. Collect");
    expect(update).toContain("last **8 weeks**");
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
    const build = await render("training-dashboard", { weeks: "4" });
    expect(build).toBe(
      template("training-dashboard")
        .replaceAll("{{dashboardVersion}}", String(DASHBOARD_VERSION))
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
    ["99999999999", 12],
  ])("reads weeks %j as %i", async (weeks, expected) => {
    expect(await render("training-dashboard", { weeks })).toContain(`last **${expected} weeks**`);
  });

  it("keeps the weeks of the existing dashboard when the update has none", async () => {
    const update = await render("training-dashboard-update", { weeks: " " });
    expect(update).toContain("the `weeks` value of the data block (12 if it has none)");
    expect(update).toContain("2026-10-28");
  });

  it("strips control characters and spaces around an argument, not other whitespace", async () => {
    expect(await render("training-dashboard", { weeks: "\u00018\t" })).toContain(
      "last **8 weeks**",
    );
    expect(await render("training-dashboard", { weeks: "\u00a08" })).toContain("last **12 weeks**");
  });
});
