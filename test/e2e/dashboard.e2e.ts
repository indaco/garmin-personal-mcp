import { readFileSync, writeFileSync } from "node:fs";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { data, launch, open, pageFile } from "./page";

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

const tabs = (page: Page) =>
  page.$$eval("[role=tab]", (els) =>
    els.map((e) => [e.getAttribute("data-tab"), e.querySelector(".count")?.textContent]),
  );
const tiles = (page: Page) =>
  page.$$eval(".tile", (els) => els.map((e) => (e as HTMLElement).dataset.id));
const hash = (page: Page) => page.evaluate(() => location.hash);

describe("the page", () => {
  it("shows the All board with the coach notes and no errors", async () => {
    const { page, errors } = await open(browser, pageFile());
    expect(await page.textContent("h1")).toBe("Training + Recovery");
    expect(await tiles(page)).toEqual(["coachNotes"]);
    // the server escaped the note: it shows as text
    expect(await page.textContent(".notes li")).toBe("Load <b>1.2");
    expect(errors).toEqual([]);
  });

  it("has a tab for each type in the data, with the sessions of the window", async () => {
    const { page } = await open(browser, pageFile());
    expect(await tabs(page)).toEqual([
      ["all", "75"],
      ["run", "36"],
      ["strength", "24"],
      ["walk", "9"],
      ["bike", "3"],
      ["padel", "3"],
    ]);
  });

  it("keeps the tab and the window in the URL hash", async () => {
    const file = pageFile();
    const { page } = await open(browser, file);
    await page.click("[data-tab=run]");
    await page.focus("[data-tab=run]");
    await page.keyboard.press("ArrowRight");
    expect(await page.getAttribute("[data-tab=strength]", "aria-selected")).toBe("true");
    await page.click(".window-bar .chip >> text=Last 4");
    expect(await hash(page)).toBe("#strength@2026-10-05_2026-10-26");

    const again = await open(browser, file, { hash: "#strength@2026-10-05_2026-10-26" });
    expect(await again.page.getAttribute("[data-tab=strength]", "aria-selected")).toBe("true");
    expect(await again.page.inputValue("#from")).toBe("2026-10-05");
  });

  it("selects one type with a chip, and a second click shows all again", async () => {
    const { page } = await open(browser, pageFile());
    const pressed = () =>
      page.$$eval(".chips .chip[aria-pressed=true]", (els) => els.map((e) => e.textContent));
    await page.click(".chip-run");
    expect(await pressed()).toEqual(["Run"]);
    await page.click(".chip-run");
    expect(await pressed()).toEqual(["All"]);
  });

  it("switches between the 11 themes and keeps the choice", async () => {
    const file = pageFile();
    const { page, errors } = await open(browser, file);
    const themes = await page.$$eval("#theme option", (o) =>
      o.map((x) => (x as HTMLOptionElement).value),
    );
    expect(themes).toHaveLength(11);
    expect(await page.inputValue("#theme")).toBe("midnight");
    for (const theme of themes) await page.selectOption("#theme", theme);
    await page.selectOption("#theme", "paper");
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("paper");
    expect(errors).toEqual([]);
  });

  it("follows the browser language, and the language menu", async () => {
    const { page } = await open(browser, pageFile(), { locale: "it-IT" });
    expect(await page.textContent("h1")).toBe("Allenamento + Recupero");
    expect(await page.textContent("[data-tab=run]")).toContain("Corsa");
    await page.selectOption("#lang", "en");
    expect(await page.textContent("h1")).toBe("Training + Recovery");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  });

  it("shows a message without data", async () => {
    const { page, errors } = await open(browser, pageFile({ data: null }));
    expect(await page.textContent("#app")).toContain("no data yet");
    expect(errors).toEqual([]);
  });

  it("does not scroll sideways at phone width", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});

describe("edit mode", () => {
  const two = {
    rev: "r1",
    base: "preset",
    boards: {
      all: [
        { id: "coachNotes", widget: "coachNotes", span: 3 },
        { id: "x", widget: "notYet", span: 1 },
      ],
    },
  };

  it("hides a widget in its place, and a second click shows it again", async () => {
    const { page } = await open(browser, pageFile());
    await page.click("text=Edit layout");
    await page.click("[aria-label='Hide Coach notes']");
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("is-hidden");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual([]);
    expect(await page.textContent(".board-empty")).toContain("no widgets");
    await page.click("text=Edit layout");
    await page.click("[aria-label='Show Coach notes']");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual(["coachNotes"]);
  });

  it("moves a widget with the buttons and sets its width", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    expect(await tiles(page)).toEqual(["coachNotes", "x"]);
    await page.click("[aria-label='Move Coach notes later']");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    await page.click("[aria-label='Move Coach notes earlier']");
    expect(await tiles(page)).toEqual(["coachNotes", "x"]);
    await page.click("[aria-label='Width 1 for Coach notes']");
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("span-1");
  });

  it("moves a widget by drag", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    const handle = await page.$("[aria-label='Drag to move Coach notes']");
    const target = await page.$("[data-id=x]");
    const from = (await handle!.boundingBox())!;
    const to = (await target!.boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
  });

  it("removes a widget, adds it back from the catalogue, and resets to the preset", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    await page.click("[aria-label='Remove Coach notes']");
    expect(await tiles(page)).toEqual(["x"]);
    await page.click("text=Add widget");
    await page.click(".catalogue li:has-text('Coach notes') button");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    await page.click("text=Reset to preset");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual(["coachNotes"]);
  });

  it("keeps a browser edit after a reload, until the page gets a new layout", async () => {
    const file = pageFile({ layout: two });
    const { page } = await open(browser, file);
    await page.click("text=Edit layout");
    await page.click("[aria-label='Remove Coach notes']");
    await page.click("text=Done");
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toEqual([]);

    // Claude saved another layout into the same page: a new rev, so the page layout wins
    writeFileSync(file, readFileSync(file, "utf8").replace('"rev":"r1"', '"rev":"r2"'));
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toEqual(["coachNotes"]);
  });

  it("copies the layout as text that Claude can save", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    await page.click("text=Copy layout");
    const text = await page.inputValue(".layout-text");
    expect(JSON.parse(text)).toEqual({ base: "preset", boards: two.boards });
  });

  it("starts empty on a blank layout", async () => {
    const { page } = await open(
      browser,
      pageFile({ layout: { rev: "b", base: "blank", boards: {} } }),
    );
    expect(await tiles(page)).toEqual([]);
    expect(await page.textContent(".board-empty")).toContain("Add widget");
  });
});

it("uses only the synthetic fixture", () => {
  expect(data.activities.every((a: { name: string }) => !/\d{5,}/.test(a.name))).toBe(true);
});
