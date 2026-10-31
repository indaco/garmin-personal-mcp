// Records assets/dashboard.gif, the demo of the README and the website: the page template filled with
// the data of the website demo (scripts/demo-dashboard.mjs), in headless Chromium. Also records
// assets/dashboard-chat.webp, the same page as a chat that shows MCP Apps shows it, and writes the hash
// of their inputs (scripts/demo-stamp.mjs). Needs `pnpm build` first, the Playwright Chromium and
// ImageMagick (`magick`). `--if-stale` records only when the inputs changed since the last recording.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { demoStamp, gifIsCurrent, STAMP_FILE } from "./demo-stamp.mjs";
import { fillPage } from "./fill-dashboard-fixture.mjs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

if (process.argv.includes("--if-stale") && gifIsCurrent()) {
  console.log("assets/dashboard.gif is current");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "dashboard-demo-"));
const json = join(dir, "demo-data.json");
execFileSync("node", ["scripts/demo-dashboard.mjs", json], { stdio: "ignore" });
const data = JSON.parse(readFileSync(json, "utf8"));

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
// the widget starts with the newest repeated run: choose exactly these three
const chips = "[data-id=workoutTrend] [aria-label='Workouts to compare'] button";
for (const name of ["Track Intervals", "Tempo Run", "Long Run"]) {
  const chip = page.locator(chips, { hasText: new RegExp(`^${name} \\(`) });
  if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
}
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
// The page in a chat: a host frame that offers full screen and sends the blocks of showDashboard, as
// src/page/mcp-app.ts expects; the page has no own URL and no storage there, as in a real host
const chat = await (
  await browser.newContext({ viewport: { width: 760, height: 480 }, deviceScaleFactor: 2 })
).newPage();
await chat.setContent(
  '<!doctype html><body style="margin:0"><iframe sandbox="allow-scripts" style="display:block;border:0;width:760px;height:480px"></iframe></body>',
);
const blocks = {
  data: { updated: new Date().toISOString(), ...data, server: version, notes: [] },
  layout: null,
  widgets: [],
  languages: {},
  i18n: {},
  settings: { workouts: true },
};
await chat.evaluate(
  ([html, b]) => {
    const frame = document.querySelector("iframe");
    const post = (m) => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
    addEventListener("message", ({ data: m }) => {
      if (m?.method === "ui/initialize") {
        const hostContext = {
          displayMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
        };
        const result = { protocolVersion: m.params.protocolVersion, hostContext };
        post({ id: m.id, result: { ...result, hostInfo: { name: "demo", version: "1" } } });
      }
      if (m?.method === "ui/notifications/initialized") {
        post({
          method: "ui/notifications/tool-result",
          params: { content: [], structuredContent: b },
        });
      }
    });
    frame.srcdoc = html;
  },
  [readFileSync("dist/dashboard.html", "utf8"), blocks],
);
await chat.frames()[1].waitForSelector(".screen-mode");
await chat.waitForTimeout(800); // the chart animations
const still = join(dir, "chat.png");
await chat.screenshot({ path: still });
await browser.close();
execFileSync("magick", [still, "-quality", "82", "assets/dashboard-chat.webp"]);

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
writeFileSync(STAMP_FILE, `${demoStamp()}\n`);
console.log(
  `assets/dashboard.gif (${frames.length} frames), assets/dashboard-chat.webp and ${STAMP_FILE} written`,
);
