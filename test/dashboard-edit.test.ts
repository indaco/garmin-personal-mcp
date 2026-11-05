import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardWriter, readBlock } from "../src/dashboard-page";
import { en } from "../src/page/i18n/en";

const template = `<!doctype html>
<meta name="garmin-template" content="bbbbbbbbbbbbbbbb">
<script>
window.GARMIN = {
  data: /* garmin-data:start */null/* garmin-data:end */,
  layout: /* garmin-layout:start */null/* garmin-layout:end */,
  widgets: /* garmin-widgets:start */[]/* garmin-widgets:end */,
  i18n: /* garmin-i18n:start */{}/* garmin-i18n:end */,
};
</script>
`;
const data = {
  start: "2026-08-03",
  end: "2026-10-26",
  weeks: 12,
  activities: [],
  previousActivities: [],
  hrv: [],
  recovery: [],
};

let dir: string;
let file: string;
let writer: DashboardWriter;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dashboard-edit-"));
  file = join(dir, "garmin-dashboard.html");
  writer = new DashboardWriter(
    async () => JSON.stringify(data),
    dir,
    async () => template,
  );
  await writer.write({});
});

const page = () => readFileSync(file, "utf8");
const layout = () =>
  readBlock(page(), "layout") as { rev: string; base: string; boards: Record<string, unknown[]> };
const seen = () => (layout() as { seen?: unknown }).seen;
const widget = { id: "longest-ride", title: "Longest ride", code: "el.textContent = 'x';" };

describe("editDashboard", () => {
  it("only reads without changes: catalogue, widget API, layout, widgets, languages", async () => {
    const before = statSync(file).mtimeMs;
    const r = await writer.edit({});
    expect(r.changed).toBe(false);
    expect(r.catalogue.find((c) => c.id === "kpis")).toMatchObject({ title: "Overview", span: 3 });
    expect(r.widgetApi).toContain("ctx.activities");
    expect(r).not.toHaveProperty("englishTexts");
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it("gives the English texts to translate when asked", async () => {
    const r = await writer.edit({ englishTexts: true });
    expect(r.englishTexts).toEqual(en);
  });

  it("saves a layout with a new rev, and drops what it cannot use", async () => {
    const rev = layout().rev;
    const r = await writer.edit({
      layout: { base: "blank", boards: { all: [{ id: "a", widget: "hrv", span: 9 }, "x"] } },
    });
    expect(r.changed).toBe(true);
    expect(layout()).toMatchObject({
      base: "blank",
      boards: { all: [{ id: "a", widget: "hrv", span: 3 }] },
    });
    expect(layout().rev).not.toBe(rev);
  });

  describe("seen record", () => {
    const board = [{ id: "hrv", widget: "hrv", span: 1 }];
    const given = { base: "preset", boards: { all: board }, seen: { all: ["kpis", "hrv"] } };

    it("keeps the record of a given layout and returns it", async () => {
      const r = await writer.edit({ layout: given });
      expect(seen()).toEqual({ all: ["kpis", "hrv"] });
      expect(r.layout.seen).toEqual({ all: ["kpis", "hrv"] });
    });

    it("keeps the record of the saved page through a place", async () => {
      await writer.edit({ layout: given });
      await writer.edit({ place: [{ board: "all", widget: "calendar" }] });
      expect(seen()).toEqual({ all: ["kpis", "hrv"] });
    });

    it("stamps a board that a place lists for the first time", async () => {
      await writer.edit({ layout: given });
      await writer.edit({ place: [{ board: "recovery", widget: "calendar" }] });
      expect(seen()).toMatchObject({ all: ["kpis", "hrv"] });
      expect(seen()).toHaveProperty("recovery", [
        "readiness",
        "fitnessAge",
        "loadVsRecovery",
        "hrv",
        "restingHr",
        "sleep",
        "sleepNeed",
        "bedtime",
        "bodyBattery",
        "stress",
        "recoveryTrend",
      ]);
    });

    it("cleans a bad record of a given layout and still saves it", async () => {
      await writer.edit({
        layout: { boards: { all: board }, seen: { all: [1, "x", "x"], run: ["y"], hrv: "z" } },
      });
      expect(seen()).toEqual({ all: ["x"] });
    });
  });

  it("places a widget at the end of a board that still shows its preset", async () => {
    await writer.edit({ place: [{ board: "running", widget: "weeklyVolume", span: 2 }] });
    const run = layout().boards.running as { widget: string }[];
    expect(run.at(0)).toMatchObject({ widget: "typeKpis" });
    expect(run.at(-1)).toEqual({ id: "weeklyVolume", widget: "weeklyVolume", span: 2 });
  });

  it("places a widget on the Recovery board, after its preset", async () => {
    await writer.edit({ place: [{ board: "recovery", widget: "calendar", span: 1 }] });
    const recovery = layout().boards.recovery as { widget: string }[];
    expect(recovery.at(0)).toMatchObject({ widget: "readiness" });
    expect(recovery.at(-1)).toMatchObject({ widget: "calendar", span: 1 });
  });

  it("places a widget on the board of any SDK sport", async () => {
    await writer.edit({
      widgets: [{ ...widget, types: ["alpineSkiing"] }],
      place: [{ board: "alpineSkiing", widget: "typeKpis" }],
    });
    expect(layout().boards.alpineSkiing.at(-1)).toMatchObject({ widget: "typeKpis" });
    expect(readBlock(page(), "widgets")).toMatchObject([{ types: ["alpineSkiing"] }]);
  });

  it("adds, replaces and removes a custom widget, also from the boards", async () => {
    await writer.edit({ widgets: [widget], place: [{ board: "all", widget: "longest-ride" }] });
    expect(readBlock(page(), "widgets")).toEqual([{ ...widget, span: 1 }]);
    await writer.edit({
      widgets: [{ ...widget, title: "Longest ride ever", span: 2, types: ["cycling"] }],
    });
    expect(readBlock(page(), "widgets")).toEqual([
      { ...widget, title: "Longest ride ever", span: 2, types: ["cycling"] },
    ]);
    await writer.edit({ removeWidgets: ["longest-ride"] });
    expect(readBlock(page(), "widgets")).toEqual([]);
    expect(
      (layout().boards.all as { widget: string }[]).some((i) => i.widget === "longest-ride"),
    ).toBe(false);
  });

  it("keeps marker text in widget code inside its block", async () => {
    const code = "el.textContent = '/* garmin-widgets:end */ </script>';";
    await writer.edit({ widgets: [{ ...widget, code }] });
    await writer.write({});
    expect((readBlock(page(), "widgets") as { code: string }[])[0].code).toBe(code);
  });

  it("refuses a custom widget with a built-in id, a bad id, no code or an unknown type", async () => {
    await expect(writer.edit({ widgets: [{ ...widget, id: "kpis" }] })).rejects.toThrow(/built-in/);
    await expect(writer.edit({ widgets: [{ ...widget, id: "Bad Id" }] })).rejects.toThrow(/id/);
    await expect(writer.edit({ widgets: [{ ...widget, code: "" }] })).rejects.toThrow(/code/);
    for (const title of ["", " ", "x".repeat(61)]) {
      await expect(writer.edit({ widgets: [{ ...widget, title }] })).rejects.toThrow(
        "A widget title needs 1 to 60 characters",
      );
    }
    await expect(writer.edit({ widgets: [{ ...widget, types: ["chess"] }] })).rejects.toThrow(
      /chess/,
    );
    await expect(writer.edit({ place: [{ board: "all", widget: "nope" }] })).rejects.toThrow(
      /nope/,
    );
    await expect(writer.edit({ place: [{ board: "chess", widget: "kpis" }] })).rejects.toThrow(
      /chess/,
    );
    await expect(
      writer.edit({ place: [{ board: "all", widget: "kpis", type: "paddle" }] }),
    ).rejects.toThrow(/paddle/);
    const result = await writer.edit({
      place: [{ board: "all", widget: "kpis", type: "running" }],
    });
    expect(result.changed).toBe(true);
    const all = layout().boards.all as { widget: string; type?: string }[];
    expect(all.at(-1)).toMatchObject({ widget: "kpis", type: "running" });
  });

  it("adds a language, and lists the texts it still misses", async () => {
    const r = await writer.edit({
      languages: { de: { title: "Training + Erholung", "window.last": "Letzte {n}" } },
    });
    expect(readBlock(page(), "i18n")).toEqual({
      de: { title: "Training + Erholung", "window.last": "Letzte {n}" },
    });
    expect(r.languages.de.missing).toHaveLength(Object.keys(en).length - 2);
    // a later call adds texts to the same language
    await writer.edit({ languages: { de: { na: "k. A." } } });
    expect(Object.keys((readBlock(page(), "i18n") as Record<string, object>).de)).toHaveLength(3);
    // the update reply lists the missing texts too
    expect((await writer.write({})).languages?.de.missing).toHaveLength(Object.keys(en).length - 3);
  });

  it("removes an added language", async () => {
    await writer.edit({ languages: { de: { title: "Training + Erholung" } } });
    const r = await writer.edit({ removeLanguages: ["de"] });
    expect(r.changed).toBe(true);
    expect(readBlock(page(), "i18n")).toEqual({});
    expect(r.languages).not.toHaveProperty("de");
  });

  it("saves nothing when the settings block of the page is damaged", async () => {
    writeFileSync(
      file,
      page().replace(
        "  i18n:",
        "  s: /* garmin-settings:start */{bad/* garmin-settings:end */,\n  i18n:",
      ),
    );
    const before = page();
    await expect(writer.edit({ place: [{ board: "all", widget: "kpis" }] })).rejects.toThrow(
      /garmin-settings.*garmin-dashboard\.html/,
    );
    expect(page()).toBe(before);
  });

  it.each(["layout", "widgets", "i18n"] as const)(
    "names the file when the %s block is damaged",
    async (block) => {
      writeFileSync(
        file,
        page().replace(
          new RegExp(`(garmin-${block}:start \\*/)[\\s\\S]*?(/\\* garmin-${block}:end)`),
          "$1{bad$2",
        ),
      );
      await expect(writer.edit({})).rejects.toThrow(
        new RegExp(`garmin-${block}.*garmin-dashboard\\.html`),
      );
    },
  );

  it("refuses names that every object has", async () => {
    const before = page();
    await expect(writer.edit({ removeLanguages: ["toString"] })).rejects.toThrow(/toString/);
    await expect(writer.edit({ languages: { de: { constructor: "x" } } })).rejects.toThrow(
      /unknown text constructor/,
    );
    expect(page()).toBe(before);
  });

  it("refuses to remove a language that the page did not add", async () => {
    await expect(writer.edit({ removeLanguages: ["fr"] })).rejects.toThrow(/fr/);
  });

  it("refuses unknown texts, a changed placeholder and a bad language code", async () => {
    await expect(writer.edit({ languages: { de: { nope: "x" } } })).rejects.toThrow(/nope/);
    await expect(writer.edit({ languages: { de: { "window.last": "Letzte" } } })).rejects.toThrow(
      /\{n\}/,
    );
    await expect(writer.edit({ languages: { German: { title: "x" } } })).rejects.toThrow(/German/);
    for (const title of [" ", "x".repeat(501)]) {
      await expect(writer.edit({ languages: { de: { title } } })).rejects.toThrow(
        "title: 1 to 500 characters",
      );
    }
  });

  it("works only on a dashboard from the template", async () => {
    writeFileSync(
      file,
      "<script>const D = /* garmin-data:start */null/* garmin-data:end */;</script>",
    );
    await expect(writer.edit({ place: [{ board: "all", widget: "kpis" }] })).rejects.toThrow(
      /layout/,
    );
    await expect(writer.edit({ path: "none.html" })).rejects.toThrow(/writeDashboard/);
  });

  it("keeps the languages when the template is upgraded", async () => {
    await writer.edit({ languages: { de: { title: "Training + Erholung" } } });
    writeFileSync(file, page().replace("bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"));
    expect((await writer.write({})).page).toBe("upgraded");
    expect(readBlock(page(), "i18n")).toEqual({ de: { title: "Training + Erholung" } });
  });

  it("keeps the added languages when the page gets a new layout", async () => {
    await writer.edit({ languages: { nl: { title: "Training en herstel" } } });
    await writer.write({ layout: "blank" });
    expect(readBlock(page(), "i18n")).toEqual({ nl: { title: "Training en herstel" } });
  });

  it("writes a new layout over a broken language block", async () => {
    writeFileSync(
      file,
      page().replace(/garmin-i18n:start \*\/.*?\/\*/, "garmin-i18n:start */{oops/*"),
    );
    await writer.write({ layout: "preset" });
    expect(readBlock(page(), "i18n")).toEqual({});
  });

  it("gives a new layout no languages from a page without a language block or not from the template", async () => {
    writeFileSync(file, page().replace(/\n {2}i18n: .*\n/, "\n"));
    expect(readBlock(page(), "i18n")).toBeUndefined();
    await writer.write({ layout: "preset" });
    expect(readBlock(page(), "i18n")).toEqual({});
    const own =
      '<script>/* garmin-data:start */null/* garmin-data:end */ /* garmin-i18n:start */{"nl":{"title":"x"}}/* garmin-i18n:end */</script>';
    await writer.write({ page: own });
    await writer.write({ layout: "preset" });
    expect(readBlock(page(), "i18n")).toEqual({});
  });
});

const libraryFile = () => join(dir, "widgets.json");
const library = () => JSON.parse(readFileSync(libraryFile(), "utf8")) as { id: string }[];
const ids = (p: string) => (readBlock(p, "widgets") as { id: string }[]).map((w) => w.id);
const coach = () => readFileSync(join(dir, "coach.html"), "utf8");
/** Gives the page a custom widget too deep to write back: JSON.stringify overflows the stack. */
const deepWidgets = () =>
  writeFileSync(
    file,
    page().replace(
      /(garmin-widgets:start \*\/).*?(\/\* garmin-widgets:end)/s,
      (_, a: string, b: string) =>
        `${a}[{"id":"mine","title":"T","code":"x","x":${"[".repeat(200_000)}${"]".repeat(200_000)}}]${b}`,
    ),
  );

describe("widget library", () => {
  it("does not start the library from a widgets block too deep to write back", async () => {
    deepWidgets();
    await expect(writer.edit({})).rejects.toThrow(
      `The garmin-widgets block of the page is too deeply nested to write back in ${file}: correct the block in the file, or give writeDashboard a new layout`,
    );
    expect(existsSync(libraryFile())).toBe(false);
  });

  it("keeps the library as it is when the page cannot take the change", async () => {
    await writer.edit({ widgets: [widget] });
    const before = readFileSync(libraryFile(), "utf8");
    deepWidgets();
    await expect(
      writer.edit({ widgets: [{ ...widget, id: "second", title: "Second" }] }),
    ).rejects.toThrow("garmin-widgets block");
    expect(readFileSync(libraryFile(), "utf8")).toBe(before);
  });

  it("saves a new custom widget in the library", async () => {
    const r = await writer.edit({ widgets: [widget] });
    expect(library()).toEqual([{ ...widget, span: 1 }]);
    expect(r.customWidgets).toEqual([
      { id: "longest-ride", title: "Longest ride", span: 1, library: true },
    ]);
  });

  it("gives the library to a new page and to a page rebuilt from the template, not placed", async () => {
    await writer.edit({ widgets: [widget], place: [{ board: "all", widget: "longest-ride" }] });
    await writer.write({ path: "coach.html" });
    expect(ids(coach())).toEqual(["longest-ride"]);
    await writer.write({ layout: "blank" });
    expect(ids(page())).toEqual(["longest-ride"]);
    expect(JSON.stringify(layout().boards)).not.toContain("longest-ride");
  });

  it("brings a changed widget to the other pages on their next write", async () => {
    await writer.edit({ widgets: [widget] });
    await writer.write({ path: "coach.html" });
    await writer.edit({ widgets: [{ ...widget, title: "Longest ride ever" }] });
    await writer.write({ path: "coach.html" });
    expect((readBlock(coach(), "widgets") as { title: string }[])[0].title).toBe(
      "Longest ride ever",
    );
  });

  it("starts the library from the page's widgets, and keeps widgets that only the page has", async () => {
    const pageOnly = { id: "page-only", title: "Page only", code: "x", span: 1 };
    writeFileSync(
      file,
      page().replace(
        "/* garmin-widgets:start */[]",
        () => `/* garmin-widgets:start */${JSON.stringify([pageOnly])}`,
      ),
    );
    await writer.write({});
    expect(library()).toEqual([pageOnly]);
    writeFileSync(libraryFile(), JSON.stringify([{ ...widget, span: 1 }]));
    await writer.write({});
    expect(ids(page())).toEqual(["page-only", "longest-ride"]);
  });

  it("removes a widget from the page only, or forgets it everywhere", async () => {
    await writer.edit({ widgets: [widget], place: [{ board: "all", widget: "longest-ride" }] });
    await writer.edit({ removeWidgets: ["longest-ride"] });
    expect(ids(page())).toEqual([]);
    expect(library()).toHaveLength(1);
    await writer.write({});
    expect(ids(page())).toEqual(["longest-ride"]);
    await writer.edit({ forgetWidgets: ["longest-ride"] });
    expect(ids(page())).toEqual([]);
    expect(library()).toEqual([]);
  });

  it("stops at a library it cannot read, and leaves it as it is", async () => {
    writeFileSync(libraryFile(), "{ not json");
    await expect(writer.edit({ widgets: [widget] })).rejects.toThrow(/widgets\.json/);
    await expect(writer.write({ layout: "preset" })).rejects.toThrow(/widgets\.json/);
    writeFileSync(libraryFile(), JSON.stringify([{ ...widget, id: "kpis" }]));
    expect(await writer.edit({})).toMatchObject({
      skippedWidgets: [{ id: "kpis", problem: expect.stringContaining("built-in") }],
    });
    expect(readFileSync(libraryFile(), "utf8")).toContain("kpis");
    writeFileSync(libraryFile(), "{}");
    await expect(writer.edit({})).rejects.toThrow(/not a list of widgets/);
  });

  it("reads a page whose widgets block is null as a page without widgets", async () => {
    writeFileSync(
      file,
      page().replace("/* garmin-widgets:start */[]", "/* garmin-widgets:start */null"),
    );
    await writer.write({});
    expect(readBlock(page(), "widgets")).toEqual([]);
    expect(statSync(libraryFile(), { throwIfNoEntry: false })).toBeUndefined();
  });

  it("stops when the library cannot be read at all", async () => {
    mkdirSync(libraryFile());
    await expect(writer.edit({ widgets: [widget] })).rejects.toThrow(/EISDIR/);
  });
});

const put = (list: unknown) => writeFileSync(libraryFile(), JSON.stringify(list));
const onAll = (w: string) =>
  (layout().boards.all as { widget: string }[]).some((i) => i.widget === w);
const raw = () => JSON.parse(readFileSync(libraryFile(), "utf8")) as unknown[];

describe("a library entry that cannot be used", () => {
  const good = { ...widget, span: 1 };
  const bad = { ...widget, id: "hrv" };
  const another = { ...widget, id: "another-ride" };
  const skipped = { id: "hrv", problem: expect.stringContaining("built-in") };

  it("goes on without the entry, and says which one it skipped", async () => {
    put([good, bad]);
    const r = await writer.write({});
    expect(ids(page())).toEqual(["longest-ride"]);
    expect(r.skippedWidgets).toEqual([skipped]);
  });

  it("keeps the entry in the file when the library is saved", async () => {
    put([good, bad]);
    await writer.write({});
    await writer.edit({ widgets: [another] });
    const saved = raw();
    expect(saved).toHaveLength(3);
    expect(saved).toContainEqual(bad);
  });

  it("does not bring old bad entries back into a new library file", async () => {
    put([good, bad]);
    expect((await writer.edit({})).skippedWidgets).toEqual([skipped]);
    unlinkSync(libraryFile());
    const r = await writer.edit({ widgets: [another] });
    expect(r).not.toHaveProperty("skippedWidgets");
    expect(raw()).not.toContainEqual(bad);
  });

  it("drops the entry when it is forgotten", async () => {
    put([good, bad]);
    await writer.write({});
    const r = await writer.edit({ forgetWidgets: ["hrv"] });
    expect(raw()).toEqual([good]);
    expect(r).not.toHaveProperty("skippedWidgets");
    expect(await writer.write({})).not.toHaveProperty("skippedWidgets");
  });

  it("starts the library from the page with only the widgets that can run", async () => {
    writeFileSync(
      file,
      page().replace(
        "/* garmin-widgets:start */[]",
        () => `/* garmin-widgets:start */${JSON.stringify([good, bad])}`,
      ),
    );
    await writer.write({});
    expect(raw()).toEqual([good]);
    await writer.write({});
    unlinkSync(libraryFile());
    await writer.write({});
    expect(raw()).toEqual([good]);
  });

  it("skips an entry that is not an object, as (no id), and keeps it", async () => {
    put([good, null, 3]);
    const r = await writer.write({});
    expect(r.skippedWidgets).toEqual([
      { id: "(no id)", problem: expect.any(String) },
      { id: "(no id)", problem: expect.any(String) },
    ]);
    await writer.edit({ widgets: [another] });
    expect(raw()).toEqual([good, { ...another, span: 1 }, null, 3]);
  });

  it("still stops at a file that is not JSON or not a list, and leaves it as it is", async () => {
    for (const text of ["{ not json", "{}"]) {
      writeFileSync(libraryFile(), text);
      await expect(writer.write({})).rejects.toThrow(/widgets\.json/);
      expect(readFileSync(libraryFile(), "utf8")).toBe(text);
    }
  });

  it("has no skippedWidgets when every entry can run", async () => {
    put([good]);
    expect(await writer.write({})).not.toHaveProperty("skippedWidgets");
    expect(await writer.edit({})).not.toHaveProperty("skippedWidgets");
  });

  it("reports nothing for a write that does not read the library", async () => {
    put([good, bad]);
    expect((await writer.write({})).skippedWidgets).toEqual([skipped]);
    const own = `<html><script>const DATA = /* garmin-data:start */null/* garmin-data:end */;</script></html>`;
    expect(await writer.write({ page: own })).not.toHaveProperty("skippedWidgets");
  });

  it("goes on when every entry is bad, and keeps them all", async () => {
    put([bad, { ...bad, id: "kpis" }]);
    const r = await writer.write({});
    expect(r.skippedWidgets).toHaveLength(2);
    await writer.edit({ widgets: [another] });
    expect(raw()).toHaveLength(3);
  });

  it("reads an empty library as no widgets", async () => {
    put([]);
    expect(await writer.write({})).not.toHaveProperty("skippedWidgets");
    expect(raw()).toEqual([]);
  });

  it("makes no library file from a page whose only widget is bad", async () => {
    writeFileSync(
      file,
      page().replace(
        "/* garmin-widgets:start */[]",
        () => `/* garmin-widgets:start */${JSON.stringify([bad])}`,
      ),
    );
    const r = await writer.write({});
    expect(r).not.toHaveProperty("skippedWidgets");
    expect(existsSync(libraryFile())).toBe(false);
  });

  it("skips an entry whose id is not a string, and names it (no id)", async () => {
    put([{ ...good, id: 7 }]);
    expect((await writer.write({})).skippedWidgets).toEqual([
      { id: "(no id)", problem: expect.any(String) },
    ]);
  });

  it("forgets an id that is not in the file without changing the bad entries", async () => {
    put([good, bad]);
    const r = await writer.edit({ forgetWidgets: ["nothing-here"] });
    expect(r.skippedWidgets).toEqual([skipped]);
    expect(raw()).toEqual([good, bad]);
  });

  it("forgets one of two bad entries and keeps the other", async () => {
    const kpis = { ...bad, id: "kpis" };
    put([bad, kpis]);
    const r = await writer.edit({ forgetWidgets: ["hrv"] });
    expect(r.skippedWidgets).toEqual([{ id: "kpis", problem: expect.any(String) }]);
    expect(raw()).toEqual([kpis]);
  });

  it.each(["forgetWidgets", "removeWidgets"] as const)(
    "%s of a bad entry with a built-in id keeps the built-in widget on its board",
    async (option) => {
      await writer.edit({ place: [{ board: "all", widget: "hrv" }] });
      put([bad]);
      const r = await writer.edit({ [option]: ["hrv"] });
      expect(onAll("hrv")).toBe(true);
      if (option === "forgetWidgets") {
        expect(raw()).toEqual([]);
        expect(r).not.toHaveProperty("skippedWidgets");
      }
    },
  );

  it("still takes a custom widget off the board with forgetWidgets", async () => {
    await writer.edit({ widgets: [widget], place: [{ board: "all", widget: "longest-ride" }] });
    expect(onAll("longest-ride")).toBe(true);
    await writer.edit({ forgetWidgets: ["longest-ride"] });
    expect(onAll("longest-ride")).toBe(false);
  });

  it("gives the chat view the widgets that can run", async () => {
    put([good, bad]);
    const v = await writer.view({});
    expect((v.blocks.widgets as { id: string }[]).map((w) => w.id)).toEqual(["longest-ride"]);
  });

  it("goes on in a refresh of an existing page, and reports the entry", async () => {
    put([good, bad]);
    expect((await writer.write({ onlyExisting: true })).skippedWidgets).toEqual([skipped]);
  });

  it("never loses an entry that cannot be written back", async () => {
    const text = `[{"id":"hrv","x":${"[".repeat(200_000)}${"]".repeat(200_000)}}]`;
    writeFileSync(libraryFile(), text);
    await expect(writer.edit({ widgets: [another] })).rejects.toThrow(/too deeply nested/);
    expect(readFileSync(libraryFile(), "utf8")).toBe(text);
    expect((await writer.write({})).skippedWidgets).toEqual([skipped]);
    expect(readFileSync(libraryFile(), "utf8")).toBe(text);
  });

  it("forgets the entries without an id with (no id)", async () => {
    put([good, null, 3, bad]);
    const r = await writer.edit({ forgetWidgets: ["(no id)"] });
    expect(r.skippedWidgets).toEqual([skipped]);
    expect(raw()).toEqual([good, bad]);
  });

  it("replaces the entry with a corrected widget of the same id", async () => {
    put([good, { id: "fixable", title: "", code: "x" }]);
    const r = await writer.edit({ widgets: [{ ...widget, id: "fixable" }] });
    expect(r).not.toHaveProperty("skippedWidgets");
    expect(raw().filter((w) => (w as { id: string }).id === "fixable")).toEqual([
      expect.objectContaining({ id: "fixable", title: "Longest ride" }),
    ]);
  });
});

describe("widget texts", () => {
  const texts = { en: { title: "Longest ride", best: "{distance} on {day}" } };

  it("keeps the texts of a widget, and adds a language with widgetTexts, also in the library", async () => {
    await writer.edit({ widgets: [{ ...widget, texts }] });
    const r = await writer.edit({
      widgetTexts: {
        "longest-ride": { it: { title: "Uscita più lunga", best: "{distance} il {day}" } },
      },
    });
    const saved = { ...texts, it: { title: "Uscita più lunga", best: "{distance} il {day}" } };
    expect((readBlock(page(), "widgets") as { texts: unknown }[])[0].texts).toEqual(saved);
    expect((library()[0] as unknown as { texts: unknown }).texts).toEqual(saved);
    expect(r.customWidgets[0].texts).toEqual(saved);
    expect(r.pageLanguages).toEqual(["en"]);
  });

  it("names the widgets that miss texts in a language of the page", async () => {
    const old = { id: "old-widget", title: "Old", code: "x" };
    await writer.edit({
      widgets: [{ ...widget, texts }, old],
      languages: { it: { title: "Allenamento" } },
    });
    const r = await writer.write({});
    // a widget without texts shows fixed text: nothing to translate
    expect(r.missingWidgetTexts).toEqual({ "longest-ride": ["it"] });
    await writer.edit({ widgetTexts: { "longest-ride": { it: { title: "Uscita più lunga" } } } });
    expect(await writer.write({})).not.toHaveProperty("missingWidgetTexts");
  });

  it("refuses bad codes, keys, empty texts, changed placeholders and unknown widgets", async () => {
    const bad = (t: Record<string, Record<string, string>>) =>
      writer.edit({ widgets: [{ ...widget, texts: { ...texts, ...t } }] });
    await expect(bad({ Italian: { title: "x" } })).rejects.toThrow(/language code Italian/);
    await expect(bad({ it: { "bad key": "x" } })).rejects.toThrow(/bad key/);
    await expect(bad({ it: { title: " " } })).rejects.toThrow(/it\.title/);
    await expect(bad({ it: { best: "{distanza} il {day}" } })).rejects.toThrow(/placeholders/);
    await expect(bad({ it: { title: "Uscita {n}" } })).rejects.toThrow(
      /keep the placeholders \(none\)/,
    );
    await expect(bad({ it: null as unknown as Record<string, string> })).rejects.toThrow(
      /it: texts by key/,
    );
    // 41 texts of 500 characters: each is short enough, all together are not
    const many = Object.fromEntries(
      Array.from({ length: 41 }, (_, i) => [`k${i}`, "x".repeat(500)]),
    );
    await expect(bad({ de: many })).rejects.toThrow(/too long/);
    await expect(writer.edit({ widgetTexts: { nope: { it: { title: "x" } } } })).rejects.toThrow(
      /nope/,
    );
  });
});

const bak = () => `${file}.bak`;
const one = (widgetId: string) => ({
  base: "preset",
  boards: { all: [{ id: widgetId, widget: widgetId, span: 1 }] },
});
describe("editDashboard keeps a copy of the page for a whole layout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the page from before the call, and returns the path", async () => {
    const before = page();
    const r = await writer.edit({ layout: one("hrv") });
    expect(r.backup).toBe(bak());
    expect(readFileSync(bak(), "utf8")).toBe(before);
    expect(page()).not.toBe(before);
  });

  it("makes no copy for an edit without a layout", async () => {
    const r = await writer.edit({ place: [{ board: "all", widget: "calendar" }] });
    expect(r.changed).toBe(true);
    expect(r).not.toHaveProperty("backup");
    expect(existsSync(bak())).toBe(false);
  });

  it("keeps the copy of the build when the layout comes right after a write", async () => {
    const before = page();
    await writer.edit({ place: [{ board: "all", widget: "calendar" }] });
    const built = page();
    expect(built).not.toBe(before);
    // a write with a new layout makes the .bak and starts the window of a build
    await writer.write({ layout: "preset" });
    const afterWrite = page();
    const saved = readFileSync(bak(), "utf8");
    expect(saved).toBe(built);
    const r = await writer.edit({ layout: one("hrv") });
    expect(r).not.toHaveProperty("backup");
    expect(readFileSync(bak(), "utf8")).toBe(saved);
    expect(page()).not.toBe(afterWrite);
  });

  it("makes no copy and leaves the page when the edit fails", async () => {
    const before = page();
    await expect(
      writer.edit({ layout: one("hrv"), place: [{ board: "nowhere", widget: "hrv" }] }),
    ).rejects.toThrow();
    expect(existsSync(bak())).toBe(false);
    expect(page()).toBe(before);
  });

  it("copies the page from before the second layout, so a wrong one can be undone", async () => {
    await writer.edit({ layout: one("hrv") });
    const afterFirst = page();
    const r = await writer.edit({ layout: one("calendar") });
    expect(r.backup).toBe(bak());
    expect(readFileSync(bak(), "utf8")).toBe(afterFirst);
  });

  it("copies the page from before the edit when the window of a build is over", async () => {
    await writer.write({ layout: "preset" });
    const afterWrite = page();
    vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
    const r = await writer.edit({ layout: one("hrv") });
    expect(r.backup).toBe(bak());
    expect(readFileSync(bak(), "utf8")).toBe(afterWrite);
  });

  it.skipIf(process.platform === "win32")("gives the copy the mode of the page", async () => {
    chmodSync(file, 0o600);
    await writer.edit({ layout: one("hrv") });
    expect(statSync(bak()).mode & 0o777).toBe(0o600);
  });

  // root ignores the mode of a folder
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "saves no widget when the copy cannot be written",
    async () => {
      const ro = join(dir, "ro");
      mkdirSync(ro);
      const roPage = join(ro, "page.html");
      await writer.write({ path: roPage });
      const before = readFileSync(roPage, "utf8");
      chmodSync(ro, 0o500);
      try {
        await expect(
          writer.edit({ path: roPage, layout: one("hrv"), widgets: [widget] }),
        ).rejects.toThrow();
      } finally {
        chmodSync(ro, 0o700);
      }
      expect(readFileSync(roPage, "utf8")).toBe(before);
      expect(existsSync(join(dir, "widgets.json"))).toBe(false);
    },
  );
});
