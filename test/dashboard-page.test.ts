import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardWriter, readBlock, templateVersion } from "../src/dashboard-page";
import { digest } from "../src/digest";

const template = (version: number, extra = "") => `<!doctype html>
<meta name="garmin-template" content="${version}">
<script>
const DATA = /* garmin-data:start */null/* garmin-data:end */;
const LAYOUT = /* garmin-layout:start */null/* garmin-layout:end */;
const WIDGETS = /* garmin-widgets:start */[]/* garmin-widgets:end */;
${extra}</script>
`;

const data = {
  start: "2026-08-03",
  end: "2026-10-26",
  weeks: 12,
  activities: [
    {
      id: 1,
      name: "Run </script><script>alert(1)</script>",
      type: "running",
      start: "2026-10-25 07:00:00",
      km: 10,
      duration: "50:00",
      trainingLoad: 100,
    },
  ],
  previousActivities: [],
  hrv: [],
  recovery: [],
  sync: { failedDays: 0 },
};

let dir: string;
let file: string;
let templateText: string;
let asked: (number | undefined)[];
let writer: DashboardWriter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashboard-page-"));
  file = join(dir, "garmin-dashboard.html");
  templateText = template(2);
  asked = [];
  writer = new DashboardWriter(
    async (weeks) => {
      asked.push(weeks);
      return JSON.stringify(data);
    },
    dir,
    async () => templateText,
  );
});

const page = () => readFileSync(file, "utf8");
/** The page without its data block: what an update must keep. */
const code = (s: string) =>
  s.replace(/\/\* garmin-data:start \*\/[\s\S]*?\/\* garmin-data:end \*\//, "");

describe("writeDashboard", () => {
  it("reads the template version of the real template, as the formatter writes it", async () => {
    const real = readFileSync("src/page/template.html", "utf8");
    expect(templateVersion(real)).toBeGreaterThan(2);
    expect(templateVersion('<meta name="garmin-template" content="7" />')).toBe(7);
    expect(templateVersion('<meta name="garmin-template" content="7">')).toBe(7);
  });

  it("has every block in the real template", () => {
    const real = readFileSync("src/page/template.html", "utf8");
    for (const block of ["data", "layout", "widgets", "i18n"] as const) {
      expect([block, readBlock(real, block) !== undefined]).toEqual([block, true]);
    }
  });

  it("creates <data-dir>/garmin-dashboard.html from the template, with the preset layout", async () => {
    const r = await writer.write({ weeks: 8 });
    expect(r).toMatchObject({ path: file, page: "created", notes: 0 });
    expect(asked).toEqual([8]);
    expect(readBlock(page(), "data")).toEqual({ ...data, v: 3, notes: [] });
    expect(readBlock(page(), "layout")).toMatchObject({ base: "preset", boards: {} });
    expect(readBlock(page(), "widgets")).toEqual([]);
  });

  it("gives each new page layout its own rev, so an old browser edit does not apply to it", async () => {
    await writer.write({});
    const first = (readBlock(page(), "layout") as { rev: string }).rev;
    await writer.write({ layout: "preset" });
    const second = (readBlock(page(), "layout") as { rev: string }).rev;
    expect(first).toMatch(/^\w{8,}$/);
    expect(second).toMatch(/^\w{8,}$/);
    expect(second).not.toBe(first);
    // an update keeps the rev
    await writer.write({});
    expect((readBlock(page(), "layout") as { rev: string }).rev).toBe(second);
  });

  it("keeps the weeks of an existing page when the call has none", async () => {
    data.weeks = 8;
    await writer.write({ weeks: 8 });
    asked.length = 0;
    vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
    try {
      await writer.write({});
    } finally {
      vi.useRealTimers();
      data.weeks = 12;
    }
    expect(asked).toEqual([8]);
  });

  it("reuses the data of the last call for 15 minutes, so the notes match their digest", async () => {
    await writer.write({ weeks: 12 });
    await writer.write({ weeks: 12, notes: ["n"] });
    expect(asked).toEqual([12]);
    // other weeks, or later than 15 minutes: new data
    await writer.write({ weeks: 6 });
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000, toFake: ["Date"] });
    try {
      await writer.write({ weeks: 6 });
    } finally {
      vi.useRealTimers();
    }
    expect(asked).toEqual([12, 6, 6]);
  });

  it("returns the digest of the data, not the data", async () => {
    const r = await writer.write({});
    expect(r.digest).toEqual(digest(data));
    expect(r).not.toHaveProperty("data");
  });

  it("keeps markup in names and notes from closing the script", async () => {
    await writer.write({ notes: ["Load <b>1.2</b> & HRV </script>"] });
    const s = page();
    expect(s.match(/<\/script>/g)).toHaveLength(1);
    expect(readBlock(s, "data")).toMatchObject({
      notes: ["Load &lt;b&gt;1.2&lt;/b&gt; &amp; HRV &lt;/script&gt;"],
    });
    expect((readBlock(s, "data") as typeof data).activities[0].name).toBe(data.activities[0].name);
  });

  it("keeps marker text in a name from ending the block, also on the next update", async () => {
    const name = "Run */ /* garmin-data:end */ alert(1) /* garmin-layout:start */";
    const tricky = { ...data, activities: [{ ...data.activities[0], name }] };
    writer = new DashboardWriter(
      async () => JSON.stringify(tricky),
      dir,
      async () => templateText,
    );
    await writer.write({});
    await writer.write({});
    const s = page();
    expect(s.split("/* garmin-data:end */")).toHaveLength(2);
    expect(s.split("/* garmin-layout:start */")).toHaveLength(2);
    expect((readBlock(s, "data") as typeof data).activities[0].name).toBe(name);
  });

  it("writes the slashes of the data as they are, so paces cost no extra bytes", async () => {
    const paced = { ...data, activities: [{ ...data.activities[0], pace: "5:07/km" }] };
    writer = new DashboardWriter(
      async () => JSON.stringify(paced),
      dir,
      async () => templateText,
    );
    await writer.write({});
    expect(page()).toContain('"pace":"5:07/km"');
  });

  it("updates only the data block of an existing page", async () => {
    await writer.write({});
    // a change the user asked for, and their layout and widget
    const custom = page()
      .replace("<!doctype html>", "<!doctype html><title>Il mio allenamento</title>")
      .replace(
        /(garmin-layout:start \*\/).*?(\/\*)/,
        '$1{"rev":"r1","base":"blank","boards":{"all":[]}}$2',
      )
      .replace(
        /(garmin-widgets:start \*\/).*?(\/\*)/,
        '$1[{"id":"w","title":"W","span":1,"code":"x"}]$2',
      );
    writeFileSync(file, custom);

    const r = await writer.write({ notes: ["new"] });
    expect(r.page).toBe("updated");
    expect(code(page())).toBe(code(custom));
    expect(readBlock(page(), "data")).toMatchObject({ notes: ["new"] });
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it("writes a new page for a layout, and keeps the old one in .bak", async () => {
    await writer.write({});
    const old = page();
    const r = await writer.write({ layout: "blank" });
    expect(r).toMatchObject({ page: "replaced", backup: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(old);
    expect(readBlock(page(), "layout")).toMatchObject({ base: "blank", boards: {} });
  });

  it("upgrades a page from an older template and keeps its layout and widgets", async () => {
    templateText = template(1);
    await writer.write({});
    writeFileSync(
      file,
      page()
        .replace(
          /(garmin-layout:start \*\/).*?(\/\*)/,
          '$1{"rev":"r1","base":"preset","boards":{}}$2',
        )
        .replace(/(garmin-widgets:start \*\/).*?(\/\*)/, '$1[{"id":"w"}]$2'),
    );
    const old = page();

    templateText = template(2, "newCode();\n");
    const r = await writer.write({});
    expect(r).toMatchObject({ page: "upgraded", backup: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(old);
    expect(page()).toContain("newCode();");
    expect(readBlock(page(), "layout")).toEqual({ rev: "r1", base: "preset", boards: {} });
    expect(readBlock(page(), "widgets")).toEqual([{ id: "w" }]);
  });

  it("fills a page that Claude wrote, and never upgrades it", async () => {
    const own =
      "<html><script>const D = /* garmin-data:start */null/* garmin-data:end */;</script></html>";
    const r = await writer.write({ page: own });
    expect(r.page).toBe("replaced");
    expect(code(page())).toBe(code(own));
    expect(readBlock(page(), "data")).toMatchObject({ v: 3 });

    templateText = template(9);
    expect((await writer.write({})).page).toBe("updated");
    expect(code(page())).toBe(code(own));
  });

  it("refuses a page without the data markers, and a page together with a layout", async () => {
    await expect(writer.write({ page: "<html></html>" })).rejects.toThrow(/garmin-data/);
    await expect(writer.write({ page: template(1), layout: "preset" })).rejects.toThrow(/either/);
    expect(existsSync(file)).toBe(false);
  });

  it("writes a relative path inside the data dir, and only .html files", async () => {
    const r = await writer.write({ path: "boards/mine.html" });
    expect(r.path).toBe(join(dir, "boards/mine.html"));
    await expect(writer.write({ path: join(dir, "notes.txt") })).rejects.toThrow(/\.html/);
  });

  it("never overwrites a file that is not a dashboard", async () => {
    const other = join(dir, "index.html");
    writeFileSync(other, "<html>my page</html>");
    await expect(writer.write({ path: other })).rejects.toThrow(/not a dashboard/);
    await expect(writer.write({ path: other, layout: "preset" })).rejects.toThrow(
      /not a dashboard/,
    );
    expect(readFileSync(other, "utf8")).toBe("<html>my page</html>");
  });
});
