import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContextOptions, chromium, type Page } from "playwright-core";
import { writeBlock } from "../../src/dashboard-page";
import { BUILT_IN } from "../../src/page/i18n/built-in";
import type { Settings } from "../../src/page/settings";

/** The synthetic data of the page tests: generated, no real activity data. */
export const data = JSON.parse(readFileSync("test/fixtures/dashboard-data.json", "utf8"));

const dir = mkdtempSync(join(tmpdir(), "dashboard-e2e-"));
let n = 0;

/** A page file from the built template, filled like the server fills it. */
export function pageFile(
  blocks: {
    data?: unknown;
    layout?: unknown;
    widgets?: unknown;
    i18n?: unknown;
    settings?: Settings;
  } = {},
): string {
  let page = readFileSync("dist/dashboard.html", "utf8");
  page = writeBlock(
    page,
    "data",
    "data" in blocks ? blocks.data : { ...data, v: 3, notes: ["Load &lt;b&gt;1.2"] },
  );
  page = writeBlock(page, "layout", blocks.layout ?? null);
  page = writeBlock(page, "widgets", blocks.widgets ?? []);
  page = writeBlock(page, "i18n", blocks.i18n ?? {});
  page = writeBlock(page, "settings", blocks.settings ?? null);
  page = writeBlock(
    page,
    "languages",
    Object.fromEntries(
      Object.entries(BUILT_IN).filter(([c]) => blocks.settings?.languages?.includes(c) ?? true),
    ),
  );
  const file = join(dir, `page-${++n}.html`);
  writeFileSync(file, page);
  return file;
}

export interface Opened {
  page: Page;
  /** Page errors and console errors since the page opened. */
  errors: string[];
}

export async function open(
  browser: Browser,
  file: string,
  options: BrowserContextOptions & { hash?: string } = {},
): Promise<Opened> {
  const { hash = "", ...contextOptions } = options;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...contextOptions,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(`file://${file}${hash}`);
  await page.waitForSelector("#app > *");
  return { page, errors };
}

export const launch = () => chromium.launch();
