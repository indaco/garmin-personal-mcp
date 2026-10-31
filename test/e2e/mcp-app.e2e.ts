import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { build } from "tsdown";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DashboardWriter, type ViewBlocks } from "../../src/dashboard-page";
import { data, launch } from "./page";

let browser: Browser;
let host: string;
beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), "mcp-host-"));
  await build({
    config: false,
    entry: { host: "test/e2e/mcp-host.ts" },
    format: ["iife"],
    platform: "browser",
    outDir,
    dts: false,
    logLevel: "silent",
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
  });
  host = readFileSync(join(outDir, "host.iife.js"), "utf8");
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

const template = () => readFileSync("dist/dashboard.html", "utf8");

/** The blocks that showDashboard sends for a new page, with the synthetic data. */
async function viewBlocks() {
  const html = template();
  const writer = new DashboardWriter(
    async () => JSON.stringify(data),
    mkdtempSync(join(tmpdir(), "mcp-app-")),
    async () => html,
  );
  return (await writer.view({})).blocks;
}

/** The page shown by the test host, as a host shows the showDashboard resource. */
async function showInHost(html: string, blocks: ViewBlocks) {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: host });
  await page.evaluate(([h, b]) => window.showApp(h, { ...b }), [html, blocks] as const);
  const frame = page.frames()[1];
  await frame.waitForSelector(".tile");
  return { page, frame, errors };
}

it("shows the dashboard in a host frame from the showDashboard blocks", async () => {
  const { page, frame, errors } = await showInHost(template(), await viewBlocks());
  expect(await frame.$$eval(".tile", (els) => els.length)).toBeGreaterThan(5);
  expect(await frame.innerText("#app")).toContain("Training + Recovery");
  // the host sizes the frame to the page
  await expect
    .poll(() => page.evaluate(() => window.hostLog.sizes.at(-1) ?? 0))
    .toBeGreaterThan(900);
  // a link that leaves the page goes to the host; a tab changes the board in the page
  await frame.click("footer a[href*='LICENSE']");
  await frame.click("[role=tab][data-tab=recovery]");
  expect(await frame.getAttribute("[data-tab=recovery]", "aria-selected")).toBe("true");
  await expect
    .poll(() => page.evaluate(() => window.hostLog.links))
    .toEqual(["https://github.com/indaco/garmin-personal-mcp/blob/main/LICENSE"]);
  expect(errors).toEqual([]);
});

it("shows the error in a custom widget when the host blocks eval, and the rest of the page", async () => {
  // a host whose rules leave out 'unsafe-eval'
  const strict = template().replace(" 'unsafe-eval'", "");
  expect(strict).not.toContain("unsafe-eval");
  const blocks = {
    ...(await viewBlocks()),
    widgets: [{ id: "mine", title: "Mine", span: 1, code: "el.textContent = 'ran';" }],
    layout: {
      rev: "c",
      base: "preset",
      boards: { all: ["mine", "kpis"].map((id) => ({ id, widget: id, span: 1 })) },
    },
  };
  const { frame, errors } = await showInHost(strict, blocks);
  expect(await frame.innerText("[data-id=mine]")).toContain("This widget failed");
  expect(await frame.innerText("[data-id=mine]")).not.toContain("ran");
  expect(await frame.innerText("[data-id=kpis]")).not.toBe("");
  expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
});
