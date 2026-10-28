import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
