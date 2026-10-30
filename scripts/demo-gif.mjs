// Records assets/dashboard.gif, the README demo: the page template filled with the synthetic data of
// the page tests, in headless Chromium. Needs `pnpm build` first, the Playwright Chromium and
// ImageMagick (`magick`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { asServer, fillPage } from "./fill-dashboard-fixture.mjs";

const dir = mkdtempSync(join(tmpdir(), "dashboard-demo-"));
const data = JSON.parse(readFileSync("test/fixtures/dashboard-data.json", "utf8"));
// the test data has laps on every run: keep the ones that the server gives a page with the workout comparison
asServer(data.activities, true);

function pageFile(name, layout, settings = null) {
  const page = fillPage(readFileSync("dist/dashboard.html", "utf8"), data, layout, settings);
  const file = join(dir, `${name}.html`);
  writeFileSync(file, page);
  return file;
}

const browser = await chromium.launch();
const frames = [];

async function open(file) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`file://${file}`);
  await page.waitForSelector("#app > *");
  return page;
}

async function shot(page) {
  await page.waitForTimeout(800); // the chart animations
  const file = join(dir, `frame-${frames.length}.png`);
  await page.screenshot({ path: file });
  frames.push(file);
}

/** Opens edit mode from the settings menu. */
async function startEdit(page) {
  await page.click(".account summary");
  await page.click(".account-panel >> text=Edit layout");
}

/** Scrolls the widget to the top of the window. */
const scrollTo = (page, id) =>
  page.$eval(`[data-id=${id}]`, (el) =>
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16),
  );

// The All board, load against recovery, the Run board with two workouts compared across weeks, and
// an exercise of the Strength board
let page = await open(pageFile("preset", null, { workouts: true }));
await shot(page);
await scrollTo(page, "loadVsRecovery");
await shot(page);
await page.click("[data-tab=running]");
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page);
await page.click("[data-id=workoutTrend] >> text=Track Intervals (6)");
await page.click("[data-id=workoutTrend] >> text=Tempo Run (6)");
await page.click("[data-id=workoutTrend] >> text=Long Run (10)");
await page.click("[data-id=workoutTrend] >> text=Efficiency");
await scrollTo(page, "workoutTrend");
await shot(page);
await page.click("[data-tab=strengthTraining]");
await page.click("[data-exercise=barbell-back-squat]");
await scrollTo(page, "exercises");
await shot(page);

// Edit mode: drag Consistency before Readiness, widen Readiness, then hide it
page = await open(pageFile("edit", null));
await startEdit(page);
const from = await page.locator("[aria-label='Move Consistency']").boundingBox();
await page.mouse.move(from.x + 5, from.y + 5);
await page.mouse.down();
const to = await page.locator("[data-id=readiness]").boundingBox();
await page.mouse.move(to.x + to.width / 4, to.y + to.height / 2, { steps: 8 });
await shot(page);
await page.mouse.up();
const edge = await page.locator("[aria-label='Width of Readiness today']").boundingBox();
await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
await page.mouse.down();
await page.mouse.move(1260, edge.y + edge.height / 2, { steps: 6 });
await shot(page);
await page.mouse.up();
await page.click("[aria-label='Hide Readiness today']");
await page.mouse.move(0, 0);
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page);

// A blank board: the catalogue, then the board with the added widgets
page = await open(pageFile("blank", { rev: "demo", base: "blank", boards: {} }));
await startEdit(page);
const addWidget = async (title) => {
  await page.click("text=Add widget");
  await page.click(`.catalogue li:has(span:text-is('${title}')) button`);
};
for (const title of ["Weekly volume", "HRV", "Sleep"]) await addWidget(title);
await page.click("text=Add widget");
await shot(page);
await page.click(".catalogue li:has(span:text-is('Resting HR')) button");
await page.click(".edit-bar >> text=Done");
await shot(page);

// The light and high-contrast themes
page = await open(pageFile("themes", null));
for (const theme of ["light", "hcDark"]) {
  // the theme menu is in the settings menu
  await page.click(".account summary");
  await page.selectOption("#theme", theme);
  await page.keyboard.press("Escape");
  await shot(page);
}
await browser.close();

execFileSync("magick", [
  "-delay",
  "250",
  "-loop",
  "0",
  ...frames,
  "-resize",
  "1000x625",
  "-colors",
  "128",
  "-layers",
  "optimize",
  "assets/dashboard.gif",
]);
console.log(`assets/dashboard.gif written (${frames.length} frames)`);
