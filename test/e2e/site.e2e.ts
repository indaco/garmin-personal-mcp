import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import axe from "axe-core";
import type { Browser, BrowserContextOptions, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch } from "./page";

// The project website in Chromium, from dist-site/ (`pnpm build:site`). A small server gives the page a
// real origin: the clipboard needs one.
const ROOT = "dist-site";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".png": "image/png",
  ".gif": "image/gif",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

let browser: Browser;
let server: Server;
let base = "";
beforeAll(async () => {
  if (!existsSync(`${ROOT}/index.html`))
    throw new Error("run pnpm build and pnpm build:site first");
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    const file = join(ROOT, path.endsWith("/") ? `${path}index.html` : path);
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** The site in a new context; `errors` collects the page errors. */
async function site(
  options: BrowserContextOptions = {},
): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // "load", not "networkidle": the web fonts come from Google and may be slow
  await page.goto(base, { waitUntil: "load" });
  return { page, errors };
}

/** The WCAG 2.2 AA problems that axe finds on the page now. */
async function problems(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window)))
    await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const WHITE = "rgb(255, 255, 255)";
const DARK = "rgb(14, 18, 23)";

describe("site accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    it(`has no WCAG 2.2 AA problem in ${colorScheme} mode, on a desktop and on a phone with the menu open`, async () => {
      const { page, errors } = await site({ colorScheme });
      expect(await problems(page)).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await problems(page)).toEqual([]);
      await page.click("#menu");
      expect(await problems(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  it("starts with a skip link to the content", async () => {
    const { page } = await site();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("skip");
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => location.hash)).toBe("#top");
  });

  it("does not scroll sideways from a small phone to a desktop", async () => {
    const { page } = await site();
    for (const width of [320, 375, 390, 430, 768, 1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect([width, await page.evaluate(() => document.documentElement.scrollWidth)]).toEqual([
        width,
        width,
      ]);
    }
  });
});

describe("site footer", () => {
  it("names the version link for screen readers by what it opens", async () => {
    const { page } = await site();
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const link = page.getByRole("link", { name: `v${version} release notes`, exact: true });
    expect(await link.count()).toBe(1);
    // on screen only the version shows: the rest is clipped to a 1 px box
    const box = await link.locator(".sr-only").boundingBox();
    expect(box!.width * box!.height).toBeLessThanOrEqual(1);
  });
});

describe("site header", () => {
  it("shows the section links on a desktop and a menu button on a phone", async () => {
    const { page } = await site();
    expect(await page.isVisible("#site-nav")).toBe(true);
    expect(await page.isVisible("#menu")).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.isVisible("#site-nav")).toBe(false);
    expect(await page.isVisible("#menu")).toBe(true);
  });

  it("opens the phone menu and closes it with Escape, a link or the button", async () => {
    const { page } = await site({ viewport: { width: 390, height: 844 } });
    await page.click("#menu");
    expect(await page.getAttribute("#menu", "aria-expanded")).toBe("true");
    expect(await page.$$eval("#site-nav a", (links) => links.length)).toBe(6);
    await page.keyboard.press("Escape");
    expect(await page.isVisible("#site-nav")).toBe(false);
    expect(await focused(page)).toBe("menu");
    await page.click("#menu");
    await page.click('#site-nav a[href="#tools"]');
    expect(await page.isVisible("#site-nav")).toBe(false);
    expect(await page.evaluate(() => location.hash)).toBe("#tools");
    await page.click("#menu");
    await page.click("#menu");
    expect(await page.getAttribute("#menu", "aria-label")).toBe("Menu");
  });

  it("follows the system mode, and keeps a toggled mode only while it differs from the system", async () => {
    const { page } = await site({ colorScheme: "dark" });
    expect(await background(page)).toBe(DARK);
    await page.click("#mode");
    expect([await theme(page), await background(page)]).toEqual(["light", WHITE]);
    await page.reload({ waitUntil: "load" });
    expect(await theme(page)).toBe("light");
    // the system turns light: the saved choice now matches it, so the page follows the system again
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => theme(page)).toBe(null);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => background(page)).toBe(DARK);
    expect(await page.evaluate(() => localStorage.getItem("mode"))).toBe(null);
  });
});

describe("site sections", () => {
  it("moves between the sport tabs with the arrow keys, Home and End, with one Tab stop", async () => {
    const { page } = await site();
    await page.focus("#tab-running");
    await page.keyboard.press("ArrowRight");
    expect([await focused(page), await page.textContent("#sportname")]).toEqual([
      "tab-strength",
      "strength",
    ]);
    await page.keyboard.press("End");
    expect([await focused(page), await page.textContent("#sportname")]).toEqual([
      "tab-every",
      "every activity",
    ]);
    expect(await page.getAttribute("#ask-panel", "aria-labelledby")).toBe("tab-every");
    await page.keyboard.press("ArrowRight");
    expect(await focused(page)).toBe("tab-running");
    await page.keyboard.press("Home");
    expect(await focused(page)).toBe("tab-running");
    expect(
      await page.$$eval(
        ".picker [role=tab]",
        (tabs) => tabs.filter((t) => (t as HTMLElement).tabIndex === 0).length,
      ),
    ).toBe(1);
  });

  it("keeps the same height for every sport, on a desktop and on a phone", async () => {
    const { page } = await site();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const heights = new Set<number>();
      for (const tab of await page.$$(".picker [role=tab]")) {
        await tab.click();
        heights.add(await page.$eval("#ask", (e) => Math.round(e.getBoundingClientRect().height)));
      }
      expect([width, heights.size]).toEqual([width, 1]);
    }
  });

  it("shows the coach prompts with the running questions only", async () => {
    const { page } = await site();
    const shown = () => page.isVisible("#coach-prompts");
    expect(await shown()).toBe(true);
    expect(await page.textContent("#coach-prompts")).toContain("race-readiness");
    await page.click(".picker [data-sport=cycling]");
    expect(await shown()).toBe(false);
    await page.click(".picker [data-sport=running]");
    expect(await shown()).toBe(true);
  });

  it("selects the sport of a hero cell, with its note for the questions written for the page", async () => {
    const { page } = await site();
    await page.click(".wall .f-padel");
    expect(await page.textContent("#sportname")).toBe("padel");
    expect(await page.textContent(".qs-set.on .qs-note")).toContain("written for this page");
    await page.click(".wall .f-every");
    expect(await page.textContent("#sportname")).toBe("every activity");
    expect(await page.textContent(".qs-set.on .qs-note")).toContain(
      "Any activity your Garmin records",
    );
    await page.click(".wall .f-strength");
    expect(await page.$(".qs-set.on .qs-note")).toBeNull();
  });

  it("shows one client pane at a time, and the arrow keys move between the clients", async () => {
    const { page } = await site();
    const visible = () =>
      page.$$eval(".clientpane", (panes) =>
        panes.filter((p) => (p as HTMLElement).offsetParent).map((p) => p.id),
      );
    expect(await visible()).toEqual(["c-desktop"]);
    await page.focus("#t-desktop");
    await page.keyboard.press("ArrowRight");
    expect([await focused(page), await visible()]).toEqual(["t-code", ["c-code"]]);
    await page.click("#t-codex");
    expect(await visible()).toEqual(["c-codex"]);
  });

  it("copies the install command and tells screen readers", async () => {
    const { page } = await site({ permissions: ["clipboard-read", "clipboard-write"] });
    await page.click(".install .copy");
    // the clipboard answers later: the announcement follows it
    await expect.poll(() => page.textContent("#copy-status")).toBe("Copied to the clipboard.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await page.textContent("#npx"),
    );
  });
});

describe("site demo", () => {
  it("shows a page updated for a year: the workout trend has every session, with its form", async () => {
    const { page, errors } = await site();
    await page.goto(`${base}demo/index.html#running`, { waitUntil: "load" });
    const tile = "[data-id=workoutTrend]";
    await page.waitForSelector(tile);
    // every repeated run has its laps: no session is left out
    expect(await page.textContent(tile)).not.toContain("left out");
    await page.click(`${tile} >> text=/^Track Intervals/`);
    await page.click(`${tile} >> text=/^Tempo Run/`);
    expect(await page.textContent(`${tile} h3`)).toBe("Track Intervals");
    // the 8 newest sessions, the others behind "Show all"
    expect(await page.$$eval(`${tile} table.data tbody tr:not([hidden])`, (r) => r.length)).toBe(8);
    expect(await page.textContent(`${tile} .btn.more`)).toMatch(/^Show all \d+$/);
    // the running form of the reps, from the laps
    const head = await page.$$eval(`${tile} table.data th`, (h) => h.map((x) => x.textContent));
    const gct = await page.$$eval(
      `${tile} table.data tbody tr`,
      (r, c) => r.map((x) => x.children[c].textContent),
      head.indexOf("Ground contact"),
    );
    for (const v of gct) expect(v).toMatch(/^\d+ ms$/);
    expect(errors).toEqual([]);
  });
});
