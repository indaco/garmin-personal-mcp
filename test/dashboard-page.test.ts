import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardWriter,
  languagesOf,
  patchDue,
  readBlock,
  templateVersion,
  withData,
} from "../src/dashboard-page";
import { digest } from "../src/digest";
import { DASHBOARD_VERSION } from "../src/prompts";
import { version as serverVersion } from "../package.json";

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
/** A page with only a data block, holding this JSON text. */
const dataPage = (json: string) =>
  `<script>/* garmin-data:start */${json}/* garmin-data:end */</script>`;
/** The page without its data block: what an update must keep. */
const code = (s: string) =>
  s.replace(/\/\* garmin-data:start \*\/[\s\S]*?\/\* garmin-data:end \*\//, "");

describe("writeDashboard", () => {
  it("withData keeps only the sports, data and notes that the settings keep", () => {
    const shell =
      "/* garmin-languages:start */{}/* garmin-languages:end */ /* garmin-data:start */null/* garmin-data:end */";
    const cut = withData(
      shell,
      data,
      { sports: ["cycling"], exclude: ["notes"], languages: ["en"] },
      ["a <b>"],
    );
    expect(readBlock(cut, "data")).toMatchObject({
      v: DASHBOARD_VERSION,
      server: serverVersion,
      activities: [],
      notes: [],
    });
    expect(readBlock(cut, "languages")).toEqual({});
    const all = readBlock(withData(shell, data, {}, ["a <b>"]), "data") as typeof data;
    expect(all.activities).toHaveLength(data.activities.length);
    expect(all).toMatchObject({ notes: ["a &lt;b&gt;"] });
  });

  it("reads the template version of the real template, as the formatter writes it", async () => {
    const real = readFileSync("src/page/template.html", "utf8");
    expect(templateVersion(real)).toBeGreaterThan(2);
    expect(templateVersion('<meta name="garmin-template" content="7" />')).toBe(7);
    expect(templateVersion('<meta name="garmin-template" content="7">')).toBe(7);
  });

  it("has every block in the real template", () => {
    const real = readFileSync("src/page/template.html", "utf8");
    for (const block of ["data", "layout", "widgets", "i18n", "settings", "languages"] as const) {
      expect([block, readBlock(real, block) !== undefined]).toEqual([block, true]);
    }
  });

  it("creates <data-dir>/garmin-dashboard.html from the template, with the preset layout", async () => {
    const r = await writer.write({ weeks: 8 });
    expect(r).toMatchObject({ path: file, page: "created", notes: 0 });
    expect(asked).toEqual([8]);
    expect(readBlock(page(), "data")).toEqual({
      ...data,
      v: 3,
      server: serverVersion,
      updated: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
      notes: [],
    });
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

  it("takes the default weeks when the data block of the page cannot be read", async () => {
    await writer.write({ weeks: 8 });
    writeFileSync(
      file,
      page().replace(/garmin-data:start \*\/[\s\S]*?\/\*/, "garmin-data:start */{oops/*"),
    );
    asked.length = 0;
    vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
    try {
      await writer.write({});
    } finally {
      vi.useRealTimers();
    }
    expect(asked).toEqual([undefined]);
  });

  it("refuses more than 5 coach notes and writes nothing", async () => {
    await expect(writer.write({ notes: ["1", "2", "3", "4", "5", "6"] })).rejects.toThrow(
      "At most 5 notes",
    );
    expect(existsSync(file)).toBe(false);
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

  it("reuses the snapshot when the first call has no weeks and the page is new", async () => {
    await writer.write({});
    await writer.write({ notes: ["n"] });
    expect(asked).toEqual([undefined]);
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

  it("writes the next automatic refresh of a scheduled page as due, and none for other pages", async () => {
    await writer.write({});
    expect(readBlock(page(), "data")).not.toHaveProperty("due");
    const due = "2026-11-02T06:00:00.000Z";
    const paths: string[] = [];
    writer = new DashboardWriter(
      async () => JSON.stringify(data),
      dir,
      async () => templateText,
      {
        due: async (path) => {
          paths.push(path);
          return due;
        },
      },
    );
    await writer.write({});
    expect(readBlock(page(), "data")).toMatchObject({ due });
    expect(paths).toEqual([file]);
  });

  it("patchDue sets, keeps or removes due, and leaves other files as they are", async () => {
    const due = "2026-11-02T06:00:00.000Z";
    const at = (name: string, text: string) => {
      const f = join(dir, name);
      writeFileSync(f, text);
      return f;
    };
    const ok = at("ok.html", dataPage('{"weeks":4}'));
    await patchDue(ok, due);
    expect(readBlock(readFileSync(ok, "utf8"), "data")).toEqual({ weeks: 4, due });
    // the same due writes nothing
    const before = statSync(ok).mtimeMs;
    await patchDue(ok, due);
    expect(statSync(ok).mtimeMs).toBe(before);
    await patchDue(ok, undefined);
    expect(readBlock(readFileSync(ok, "utf8"), "data")).toEqual({ weeks: 4 });
    // no due to remove: nothing changes
    await patchDue(ok, undefined);
    expect(readBlock(readFileSync(ok, "utf8"), "data")).toEqual({ weeks: 4 });

    // a missing file, a page with no data yet, a broken block and a foreign file stay as they are
    await patchDue(join(dir, "missing.html"), due);
    expect(existsSync(join(dir, "missing.html"))).toBe(false);
    for (const [name, text] of [
      ["empty.html", dataPage("null")],
      ["number.html", dataPage("4")],
      ["broken.html", dataPage("{weeks")],
      ["foreign.html", "<p>my page</p>"],
    ]) {
      const f = at(name, text);
      await patchDue(f, due);
      expect([name, readFileSync(f, "utf8")]).toEqual([name, text]);
    }
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

  it("with onlyExisting, updates a page but never makes a new one", async () => {
    await expect(writer.write({ onlyExisting: true })).rejects.toThrow(/does not exist/);
    expect(existsSync(file)).toBe(false);
    await writer.write({});
    expect((await writer.write({ onlyExisting: true })).page).toBe("updated");
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

const damageSettings = () =>
  writeFileSync(
    file,
    page().replace(/garmin-settings:start \*\/[\s\S]*?\/\*/, "garmin-settings:start */{bad/*"),
  );

/** A writer of this data for a Garmin profile in this locale. */
const profile = (base: object, locale: string) =>
  new DashboardWriter(
    async () => JSON.stringify({ ...base, locale }),
    dir,
    async () => templateText,
  );

describe("writeDashboard settings", () => {
  /** A template with the blocks, the title and the theme CSS of the real one. */
  const styledTemplate = `<!doctype html>
<meta name="garmin-template" content="6">
<title>Training + Recovery</title>
<style>:root,:root[data-theme="midnight"],:root[data-theme="system"]{--bg:#000}:root[data-theme="ocean"]{--bg:#012}:root[data-theme="paper"]{--bg:#fff}@media (prefers-color-scheme:light){:root[data-theme="system"]{--bg:#eee}}:root[data-theme="paper"],:root[data-theme="mist"]{--line:#ccc}</style>
<script>
window.GARMIN_SETTINGS = /* garmin-settings:start */null/* garmin-settings:end */;
const DATA = /* garmin-data:start */null/* garmin-data:end */;
const LAYOUT = /* garmin-layout:start */null/* garmin-layout:end */;
const WIDGETS = /* garmin-widgets:start */[]/* garmin-widgets:end */;
const LANGS = /* garmin-languages:start */{}/* garmin-languages:end */;
const I18N = /* garmin-i18n:start */{}/* garmin-i18n:end */;
</script>
`;
  const full = {
    ...data,
    zones: [{ sport: "DEFAULT", zone1Floor: 100 }],
    fitnessAge: { fitnessAge: 40 },
    activities: [
      {
        id: 1,
        name: "Run with Anna",
        sport: "running",
        type: "running",
        start: "2026-10-25 07:00:00",
        km: 10,
        duration: "50:00",
      },
      {
        id: 2,
        name: "Ride",
        sport: "cycling",
        type: "road_biking",
        start: "2026-10-24 07:00:00",
        km: 40,
        duration: "1:30:00",
      },
    ],
    previousActivities: [
      { id: 3, sport: "cycling", type: "road_biking", start: "2026-07-24 07:00:00" },
    ],
    hrv: [{ date: "2026-10-25", hrv: 50 }],
    recovery: [{ date: "2026-10-25", sleepScore: 80 }],
  };
  type Full = typeof full & { notes: string[] };

  beforeEach(() => {
    templateText = styledTemplate;
    writer = new DashboardWriter(
      async () => JSON.stringify(full),
      dir,
      async () => templateText,
    );
  });

  it("loads the workout laps for a page that turns them on, also on its updates", async () => {
    const workouts: (boolean | undefined)[] = [];
    writer = new DashboardWriter(
      async (_, w) => {
        workouts.push(w);
        return JSON.stringify(full);
      },
      dir,
      async () => templateText,
    );
    await writer.write({ weeks: 12 });
    // a snapshot without the workout laps does not serve a page that wants them
    await writer.write({ weeks: 12, settings: { workouts: true } });
    vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
    try {
      await writer.write({});
    } finally {
      vi.useRealTimers();
    }
    expect(workouts).toEqual([false, true, true]);
    expect(page()).toContain('"workouts":true');
  });

  it("keeps the settings of a page that Claude wrote with a settings block, for its updates", async () => {
    const workouts: (boolean | undefined)[] = [];
    writer = new DashboardWriter(
      async (_, w) => {
        workouts.push(w);
        return JSON.stringify(full);
      },
      dir,
      async () => templateText,
    );
    const own = `<html><script>window.GARMIN_SETTINGS = /* garmin-settings:start */null/* garmin-settings:end */;
const DATA = /* garmin-data:start */null/* garmin-data:end */;</script></html>`;
    await writer.write({ page: own, settings: { workouts: true, exclude: ["names"] } });
    vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
    try {
      await writer.write({ notes: ["n"] });
    } finally {
      vi.useRealTimers();
    }
    expect(workouts).toEqual([true, true]);
    expect(page()).toContain('{"workouts":true,"exclude":["names"]}');
    // new settings without any setting: the block is empty again
    await writer.write({ page: own, settings: {} });
    expect(page()).toContain("/* garmin-settings:start */null/* garmin-settings:end */");
  });

  it("leaves out of the page and of the digest the data and the sports that the settings exclude", async () => {
    const r = await writer.write({
      settings: { sports: ["running"], exclude: ["recovery", "fitnessAge", "names", "notes"] },
      notes: ["a note"],
    });
    const d = readBlock(page(), "data") as Full;
    const { name: _, ...run } = full.activities[0];
    expect(d.activities).toEqual([run]);
    expect(d.previousActivities).toEqual([]);
    expect(d.hrv).toEqual([]);
    expect(d.recovery).toEqual([]);
    expect(d).not.toHaveProperty("fitnessAge");
    expect(d.zones).toEqual(full.zones);
    expect(d.notes).toEqual([]);
    expect(r.notes).toBe(0);
    expect(page()).not.toContain("Anna");
    expect(r.digest.hrvLast14).toEqual([]);
    expect(Object.keys(r.digest.totals)).toEqual(["running"]);
  });

  it("keeps a title and headline from the notes call through updates, refreshes and upgrades", async () => {
    // an existing page with its own settings, then the training-dashboard prompt on a preset page
    await writer.write({ settings: { exclude: ["zones"] } });
    const first = await writer.write({ layout: "preset" });
    const own = { ...first.settings, title: "Road to Rome", headline: "Marathon block" };
    await writer.write({ notes: ["n"], settings: own });
    const kept = { exclude: ["zones"], title: "Road to Rome", headline: "Marathon block" };
    expect(readBlock(page(), "settings")).toEqual(kept);

    await writer.write({ notes: ["new"] }); // training-dashboard-update
    await writer.write({ onlyExisting: true }); // the automatic refresh
    templateText = styledTemplate.replace('content="6"', 'content="7"');
    expect((await writer.write({})).page).toBe("upgraded");
    expect(readBlock(page(), "settings")).toEqual(kept);
    expect(page()).toContain("<title>Road to Rome</title>");
  });

  it("keeps the settings on an update and on a new layout; an argument replaces them", async () => {
    await writer.write({ settings: { exclude: ["zones"] } });
    expect(readBlock(page(), "settings")).toEqual({ exclude: ["zones"] });
    expect((await writer.write({})).page).toBe("updated");
    await writer.write({ layout: "blank" });
    expect(readBlock(page(), "settings")).toEqual({ exclude: ["zones"] });
    expect(readBlock(page(), "data")).not.toHaveProperty("zones");

    const r = await writer.write({ settings: { title: "Mine" } });
    expect(r).toMatchObject({ page: "replaced", backup: `${file}.bak` });
    expect(readBlock(page(), "settings")).toEqual({ title: "Mine" });
    expect((readBlock(page(), "data") as Full).zones).toEqual(full.zones);
    // empty settings give the page of the template again
    await writer.write({ settings: {} });
    expect(readBlock(page(), "settings")).toBeNull();
    expect(page()).toContain("<title>Training + Recovery</title>");
  });

  it("names a damaged settings block and the file", async () => {
    await writer.write({ settings: { exclude: ["zones"] } });
    damageSettings();
    await expect(writer.write({})).rejects.toThrow(/settings/);
    await expect(writer.write({})).rejects.toThrow(file);
  });

  it("replaces a damaged settings block when new settings are given", async () => {
    await writer.write({ settings: { exclude: ["zones"] } });
    damageSettings();
    await writer.write({ settings: { title: "Coach" } });
    expect(readBlock(page(), "settings")).toEqual({ title: "Coach" });
  });

  it("writes the title escaped, and only the CSS of the chosen themes", async () => {
    await writer.write({ settings: { title: "Coach <b>view</b>", themes: ["midnight", "paper"] } });
    const s = page();
    expect(s).toContain("<title>Coach &lt;b&gt;view&lt;/b&gt;</title>");
    expect(s).not.toContain('data-theme="ocean"');
    expect(s).toContain(':root[data-theme="paper"]{--bg:#fff}');
    // a rule of several themes and the default stay
    expect(s).toContain(':root,:root[data-theme="midnight"],:root[data-theme="system"]{--bg:#000}');
    expect(s).toContain(':root[data-theme="paper"],:root[data-theme="mist"]{--line:#ccc}');
    // system is not chosen: its rule in @media goes, the @media stays valid
    expect(s).toContain("@media (prefers-color-scheme:light){}");
  });

  it("writes the built-in languages that the settings keep, else the one of the profile", async () => {
    let r = await writer.write({});
    expect(readBlock(page(), "languages")).toEqual({});
    expect(r.pageLanguages).toEqual(["en"]);
    // the writer reuses the data for a while: a new one for another profile
    const fromItaly = JSON.stringify({ ...full, locale: "it" });
    writer = new DashboardWriter(
      async () => fromItaly,
      dir,
      async () => templateText,
    );
    r = await writer.write({});
    expect(Object.keys(readBlock(page(), "languages") as object)).toEqual(["it"]);
    expect(r.pageLanguages).toEqual(["en", "it"]);
    await writer.write({ settings: { languages: ["en"] } });
    expect(readBlock(page(), "languages")).toEqual({});
    r = await writer.write({ settings: { languages: ["it"] } });
    expect(Object.keys(readBlock(page(), "languages") as object)).toEqual(["it"]);
    expect(r.pageLanguages).toEqual(["it"]);
    expect(r.settings).toEqual({ languages: ["it"] });
  });

  it("names the profile language when the page has no texts in it", async () => {
    writer = profile(full, "ru");
    expect((await writer.write({})).missingProfileLanguage).toBe("ru");
    await writer.edit({ languages: { ru: { title: "Тренировки" } } });
    expect(await writer.write({})).not.toHaveProperty("missingProfileLanguage");
    for (const locale of ["en-GB", "pt-BR"]) {
      expect(await profile(full, locale).write({})).not.toHaveProperty("missingProfileLanguage");
    }
    // a built-in language that the settings leave out is not missing
    writer = profile(full, "it");
    expect(await writer.write({ settings: { languages: ["en"] } })).not.toHaveProperty(
      "missingProfileLanguage",
    );
    // a page without the block of added languages has none
    templateText = styledTemplate.replace(/^const I18N.*\n/m, "");
    const r = await profile(full, "ru").write({ path: "no-i18n.html" });
    expect(r.missingProfileLanguage).toBe("ru");
  });

  it("matches the profile locale by full tag, then by language", () => {
    expect(Object.keys(languagesOf({}, "it-CH"))).toEqual(["it"]);
    expect(languagesOf({}, "en")).toEqual({});
    expect(languagesOf({}, "xx")).toEqual({});
    expect(languagesOf({}, undefined)).toEqual({});
    expect(languagesOf({ languages: ["en"] }, "it")).toEqual({});
  });

  it("writes a path that starts with ~ in the home folder", async () => {
    await expect(writer.write({ path: "~/no-such-folder-garmin/x.txt" })).rejects.toThrow(
      new RegExp(`${homedir()}/no-such-folder-garmin/x\\.txt`),
    );
  });

  it("refuses bad settings, and settings for a page that Claude wrote", async () => {
    await expect(writer.write({ settings: { sports: ["chess"] } })).rejects.toThrow(
      /sports: unknown chess/,
    );
    // a bad argument is not a broken page: no "delete the file"
    await expect(writer.preview({ settings: { sports: ["chess"] } })).rejects.toThrow(
      /^Settings: sports: unknown chess$/,
    );
    await expect(writer.write({ settings: { themes: ["neon"] } })).rejects.toThrow(/themes/);
    await expect(writer.write({ settings: { theme: "ocean", themes: ["paper"] } })).rejects.toThrow(
      /theme: one of paper/,
    );
    await expect(writer.write({ settings: { languages: ["xx"] } })).rejects.toThrow(/languages/);
    await expect(writer.write({ settings: { title: " " } })).rejects.toThrow(/title/);
    await expect(writer.write({ settings: { sports: [] } })).rejects.toThrow(/sports/);
    await expect(writer.write({ settings: { languages: [] } })).rejects.toThrow(/languages/);
    await expect(
      writer.write({ settings: { workouts: "yes" as unknown as boolean } }),
    ).rejects.toThrow(/workouts: true or false/);
    await expect(
      writer.write({ settings: { colour: "red" } as unknown as Record<string, never> }),
    ).rejects.toThrow(/unknown settings colour/);
    await expect(writer.write({ settings: { language: "english" } })).rejects.toThrow(
      /language: auto or a code such as en, it or pt-BR/,
    );
    expect(existsSync(file)).toBe(false);
    // a language with a region is a code too
    await writer.write({ settings: { language: "pt-BR" } });
    expect(readBlock(page(), "settings")).toEqual({ language: "pt-BR" });
    rmSync(file);
    const own = "<html><script>/* garmin-data:start */null/* garmin-data:end */</script></html>";
    await expect(writer.write({ page: own, settings: { exclude: ["names"] } })).rejects.toThrow(
      /template/,
    );
    expect(existsSync(file)).toBe(false);
  });

  it("previews without writing: the boards of all activities and the digest of the settings", async () => {
    const r = await writer.preview({ settings: { sports: ["cycling"] } });
    expect(r.settings).toEqual({ sports: ["cycling"] });
    expect(r.boards).toEqual({ running: 1, cycling: 1 });
    expect(Object.keys(r.digest.totals)).toEqual(["road_biking"]);
    expect(existsSync(file)).toBe(false);
  });

  it("previews with the settings that the page keeps, or none for a new page", async () => {
    expect((await writer.preview({})).settings).toEqual({});
    await writer.write({ settings: { sports: ["cycling"], title: "Rides" } });
    expect((await writer.preview({})).settings).toEqual({ sports: ["cycling"], title: "Rides" });
  });

  it("goes back to the default settings on a new layout, with only the title and headline kept", async () => {
    // the training-dashboard prompt: "Use the defaults" on a page with one sport
    await writer.write({ settings: { sports: ["cycling"], exclude: ["zones"], title: "Rides" } });
    const { title } = (await writer.preview({})).settings;
    const r = await writer.write({ layout: "preset", settings: { title } });
    expect(r.settings).toEqual({ title: "Rides" });
    const d = readBlock(page(), "data") as Full;
    expect(d.activities.map((a) => a.id)).toEqual([1, 2]);
    expect(d.zones).toEqual(full.zones);
    // a page without a title or headline: no settings at all
    await writer.write({ layout: "preset", settings: {} });
    expect((await writer.preview({})).settings).toEqual({});
  });

  it("names the file and the way out when the settings block of the page cannot be read", async () => {
    await writer.write({ settings: { sports: ["cycling"] } });
    writeFileSync(
      file,
      page().replace(/garmin-settings:start \*\/.*?\/\*/, "garmin-settings:start */{oops/*"),
    );
    const way =
      /settings block of the page is not valid JSON in .*garmin-dashboard\.html: give new settings, or delete the file/;
    await expect(writer.preview({})).rejects.toThrow(way);
    await expect(writer.write({ layout: "preset" })).rejects.toThrow(way);
    // new settings replace the broken block
    expect((await writer.preview({ settings: { sports: ["running"] } })).settings).toEqual({
      sports: ["running"],
    });
    await writer.write({ layout: "preset", settings: {} });
    expect((await writer.preview({})).settings).toEqual({});
  });

  it("views a new page with the preset layout and writes nothing", async () => {
    const r = await writer.view({});
    expect(existsSync(file)).toBe(false);
    expect(r.blocks.layout).toEqual({ rev: "preset", base: "preset", boards: {} });
    expect(r.blocks.settings).toEqual({});
    expect((r.blocks.data as Full).activities.map((a) => a.id)).toEqual([1, 2]);
    expect(r.digest).toEqual(digest(full));
  });

  it("views the saved page: its blocks and settings, with the same data filter", async () => {
    await writer.write({ settings: { sports: ["running"], exclude: ["names", "zones"] } });
    await writer.edit({ languages: { de: { title: "Training" } } });
    const saved = page();
    const { blocks, digest: d, path } = await writer.view({});
    expect(page()).toBe(saved);
    expect(path).toBe(file);
    expect(blocks.settings).toEqual({ sports: ["running"], exclude: ["names", "zones"] });
    for (const b of ["layout", "widgets", "languages", "i18n"] as const) {
      expect(blocks[b]).toEqual(readBlock(saved, b));
    }
    const { updated: _, ...rest } = blocks.data as Full & { updated: string };
    const { updated: __, ...written } = readBlock(saved, "data") as Full & { updated: string };
    expect(rest).toEqual(written);
    expect(JSON.stringify(blocks.data)).not.toContain("Run with Anna");
    expect(blocks.data).not.toHaveProperty("zones");
    expect(Object.keys(d.totals)).toEqual(["running"]);
  });

  it("views a page that Claude wrote with the preset layout, and its settings still filter", async () => {
    const own =
      "<html><script>/* garmin-settings:start */null/* garmin-settings:end */ /* garmin-data:start */null/* garmin-data:end */</script></html>";
    await writer.write({ page: own, settings: { exclude: ["names"] } });
    const { blocks } = await writer.view({});
    expect(blocks.layout).toEqual({ rev: "preset", base: "preset", boards: {} });
    expect(blocks.settings).toEqual({ exclude: ["names"] });
    expect(JSON.stringify(blocks.data)).not.toContain("Run with Anna");
  });

  it("refuses to view a page whose settings block cannot be read, and names the way out", async () => {
    await writer.write({ settings: { exclude: ["names"] } });
    writeFileSync(
      file,
      page().replace(/garmin-settings:start \*\/.*?\/\*/, "garmin-settings:start */{oops/*"),
    );
    // without readable settings the view could show data that the page leaves out
    await expect(writer.view({})).rejects.toThrow(
      /settings block of the page is not valid JSON in .*garmin-dashboard\.html: give new settings, or delete the file/,
    );
  });
});
