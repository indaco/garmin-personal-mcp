import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DashboardWriter, readBlock } from "../src/dashboard-page";
import { en } from "../src/page/i18n/en";

const template = `<!doctype html>
<meta name="garmin-template" content="3">
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
    await expect(
      writer.edit({ place: [{ board: "all", widget: "kpis", type: "running" }] }),
    ).resolves.toBeDefined();
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
    writeFileSync(file, page().replace('content="3"', 'content="2"'));
    expect((await writer.write({})).page).toBe("upgraded");
    expect(readBlock(page(), "i18n")).toEqual({ de: { title: "Training + Erholung" } });
  });
});

const libraryFile = () => join(dir, "widgets.json");
const library = () => JSON.parse(readFileSync(libraryFile(), "utf8")) as { id: string }[];
const ids = (p: string) => (readBlock(p, "widgets") as { id: string }[]).map((w) => w.id);
const coach = () => readFileSync(join(dir, "coach.html"), "utf8");

describe("widget library", () => {
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
    await expect(writer.edit({})).rejects.toThrow(/built-in/);
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
