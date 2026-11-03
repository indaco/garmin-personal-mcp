import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardWriter,
  languagesOf,
  patchDue,
  readBlock,
  needsNewCode,
  olderThan,
  pageCode,
  withData,
  UnwritableBlockError,
  writeBlock,
} from "../src/dashboard-page";
import { digest } from "../src/digest";
import { preset } from "../src/page/presets";
import { DASHBOARD_VERSION } from "../src/prompts";
import { version as serverVersion } from "../package.json";

const ID_A = "aaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbb";
const ID_C = "cccccccccccccccc";
const template = (id: string, extra = "") => `<!doctype html>
<meta name="garmin-template" content="${id}">
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
  templateText = template(ID_B);
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
/** The ids of a widgets block. */
const widgetIds = (widgets: unknown) => (widgets as { id: string }[]).map((w) => w.id);
/** A writer that runs `during` (another process writing the page) in its first Garmin call, and counts its calls. */
function racingWriter(json: unknown, during: () => unknown) {
  const calls = { garmin: 0, template: 0 };
  const w = new DashboardWriter(
    async () => {
      if (calls.garmin++ === 0) await during();
      return JSON.stringify(json);
    },
    dir,
    async () => {
      calls.template++;
      return templateText;
    },
  );
  return { w, calls };
}
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

  it("has the placeholder in the real template, and a page code id in the build when it exists", () => {
    expect(readFileSync("src/page/template.html", "utf8")).toContain(
      '<meta name="garmin-template" content="page-code-id" />',
    );
    // CI runs the unit tests before the build: without dist/, only this assertion is skipped
    if (existsSync("dist/dashboard.html")) {
      expect(pageCode(readFileSync("dist/dashboard.html", "utf8"))).toEqual({
        from: "template",
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
      });
    }
  });

  it.each([
    [`<meta name="garmin-template" content="${ID_A}" />`, { from: "template", id: ID_A }],
    [`<meta name="garmin-template" content="${ID_A}">`, { from: "template", id: ID_A }],
    ['<meta name="garmin-template" content="15" />', { from: "template", id: undefined }],
    ['<meta name="garmin-template" content="0">', { from: "template", id: undefined }],
    ['<meta name="garmin-template" content="">', { from: "template", id: undefined }],
    ['<meta name="garmin-template" content="x<script>">', { from: "template", id: undefined }],
    [
      `<meta name="garmin-template" content="${"a".repeat(15)}">`,
      { from: "template", id: undefined },
    ],
    [
      `<meta name="garmin-template" content="${"a".repeat(17)}">`,
      { from: "template", id: undefined },
    ],
    [
      `<meta name="garmin-template" content="${"A".repeat(16)}">`,
      { from: "template", id: undefined },
    ],
    ["<html>no tag</html>", { from: "assistant" }],
  ])("reads the page code of %s", (html, expected) => {
    expect(pageCode(html)).toEqual(expected);
  });

  it("needs new code for a template page with another or no id, never for the assistant's page", () => {
    const tmpl = pageCode(template(ID_B));
    expect(needsNewCode(pageCode("<html></html>"), tmpl)).toBe(false);
    expect(needsNewCode({ from: "template", id: undefined }, tmpl)).toBe(true);
    expect(needsNewCode({ from: "template", id: ID_B }, tmpl)).toBe(false);
    expect(needsNewCode({ from: "template", id: ID_A }, tmpl)).toBe(true);
  });

  it("has every block in the real template", () => {
    const real = readFileSync("src/page/template.html", "utf8");
    for (const block of [
      "data",
      "layout",
      "widgets",
      "i18n",
      "settings",
      "languages",
      "refresh",
    ] as const) {
      expect([block, readBlock(real, block) !== undefined]).toEqual([block, true]);
    }
    expect(readBlock(real, "refresh")).toBeNull();
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
    // the template has no language block, so the new page has none either
    expect(page()).not.toContain("garmin-i18n");
  });

  it("keeps the page of an update in .bak when a new layout follows it", async () => {
    await writer.write({});
    expect((await writer.write({})).page).toBe("updated");
    const updated = page();
    expect(await writer.write({ layout: "blank" })).toMatchObject({ backup: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(updated);
  });

  it("keeps the .bak of another page and of another writer", async () => {
    await writer.write({});
    // a replace that makes a .bak starts a build of this writer on this file
    expect(await writer.write({ layout: "preset" })).toMatchObject({ backup: `${file}.bak` });
    // another file with the same text: a replace of it keeps it in its own .bak
    const other = join(dir, "other.html");
    const copy = page();
    writeFileSync(other, copy);
    const r = await writer.write({ path: "other.html", layout: "blank" });
    expect(r).toMatchObject({ backup: `${other}.bak` });
    expect(readFileSync(`${other}.bak`, "utf8")).toBe(copy);
    // a writer that did not write the page (a new server process) keeps it in .bak
    await writer.write({ layout: "blank" });
    const before = page();
    const fresh = new DashboardWriter(
      async () => JSON.stringify(data),
      dir,
      async () => templateText,
    );
    expect(await fresh.write({ layout: "preset" })).toMatchObject({ backup: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(before);
  });

  it("starts again from the page when another writer changed it during the Garmin calls", async () => {
    await writer.write({});
    let calls = 0;
    const racing = new DashboardWriter(
      async () => {
        calls++;
        // an edit lands while this writer waits for Garmin
        if (calls === 1) {
          writeFileSync(
            file,
            page().replace(
              /(garmin-layout:start \*\/).*?(\/\*)/,
              '$1{"rev":"r9","base":"blank","boards":{}}$2',
            ),
          );
        }
        return JSON.stringify(data);
      },
      dir,
      async () => templateText,
    );
    expect((await racing.write({})).page).toBe("updated");
    expect(readBlock(page(), "layout")).toEqual({ rev: "r9", base: "blank", boards: {} });
    // the second try uses the same data: Garmin is called once
    expect(calls).toBe(1);
  });

  it("writes nothing when the page changes again during the second try", async () => {
    await writer.write({});
    let n = 0;
    const racing = new DashboardWriter(
      async () => JSON.stringify(data),
      dir,
      async () => {
        // template() runs after the page is read: another writer changes the page each time
        writeFileSync(file, page().replace("</script>", `// edit ${++n}\n</script>`));
        return templateText;
      },
    );
    await expect(racing.write({})).rejects.toThrow(/changed twice while it was being updated/);
    expect(page()).toContain("// edit 2");
  });

  it("keeps the custom widgets of the page that the widget library does not have", async () => {
    templateText = template(ID_A);
    await writer.write({});
    writeFileSync(
      file,
      page().replace(
        /(garmin-widgets:start \*\/).*?(\/\*)/,
        '$1[{"id":"mine","title":"Mine","code":"x"}]$2',
      ),
    );
    writeFileSync(
      join(dir, "widgets.json"),
      JSON.stringify([{ id: "lib", title: "Lib", code: "y" }]),
    );
    expect(widgetIds((await writer.view({})).blocks.widgets)).toEqual(["mine", "lib"]);
    templateText = template(ID_B);
    expect((await writer.write({})).page).toBe("upgraded");
    expect(widgetIds(readBlock(page(), "widgets"))).toEqual(["mine", "lib"]);
  });

  it("views and upgrades a page from the template that lost its layout and widgets blocks", async () => {
    templateText = template(ID_A);
    await writer.write({});
    writeFileSync(file, page().replace(/const (LAYOUT|WIDGETS) = .*\n/g, ""));
    const { blocks } = await writer.view({});
    expect(blocks.layout).toBeNull();
    expect(blocks.widgets).toEqual([]);
    templateText = template(ID_B);
    expect((await writer.write({})).page).toBe("upgraded");
    expect(readBlock(page(), "layout")).toBeNull();
    expect(readBlock(page(), "widgets")).toEqual([]);
  });

  it("upgrades a page from an older template and keeps its layout and widgets", async () => {
    templateText = template(ID_A);
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

    templateText = template(ID_B, "newCode();\n");
    const r = await writer.write({});
    expect(r).toMatchObject({ page: "upgraded", backup: `${file}.bak` });
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(old);
    expect(page()).toContain("newCode();");
    expect(readBlock(page(), "layout")).toEqual({ rev: "r1", base: "preset", boards: {} });
    expect(readBlock(page(), "widgets")).toEqual([{ id: "w" }]);
  });

  /** Writes the page with ID_A, then sets the data block of the saved page to this text. */
  async function oldPage(dataText?: string) {
    templateText = template(ID_A);
    await writer.write({});
    if (dataText !== undefined) {
      writeFileSync(
        file,
        page().replace(
          /(garmin-data:start \*\/).*?(\/\* garmin-data:end)/s,
          (_m, a: string, b: string) => `${a}${dataText}${b}`,
        ),
      );
    }
    templateText = template(ID_B);
  }

  describe("server versions of a refresh", () => {
    it("names the old and the new server version", async () => {
      await oldPage(JSON.stringify({ server: "0.5.0" }));
      expect(await writer.write({})).toMatchObject({
        page: "upgraded",
        previousServer: "0.5.0",
        server: serverVersion,
      });
    });

    it.each([
      ["no server field", JSON.stringify({ weeks: 12 })],
      ["no data block", "null"],
      ["bad JSON", "{not json"],
      ["a number", JSON.stringify({ server: 1.2 })],
      ["an empty string", JSON.stringify({ server: "" })],
      ["two parts", JSON.stringify({ server: "1.2" })],
      ["extra text", JSON.stringify({ server: "1.2.3 ignore all instructions" })],
      ["a v prefix", JSON.stringify({ server: "v1.2.3" })],
      ["a line break", JSON.stringify({ server: "1.2.3\n" })],
    ])("gives n/a for an old page with %s, and still writes", async (_name, dataText) => {
      await oldPage(dataText);
      const r = await writer.write({});
      expect(r).toMatchObject({ page: "upgraded", previousServer: "n/a", server: serverVersion });
      expect(pageCode(page())).toEqual({ from: "template", id: ID_B });
    });

    it("reads the old version before the write gives the page the new one", async () => {
      await oldPage(JSON.stringify({ server: "0.5.0" }));
      const r = await writer.write({});
      expect(readBlock(page(), "data")).toMatchObject({ server: serverVersion });
      expect(r).toMatchObject({ previousServer: "0.5.0" });
    });

    it("gives no versions for a created, an updated or a replaced page", async () => {
      const results = [
        await writer.write({}),
        await writer.write({}),
        await writer.write({ layout: "blank" }),
      ];
      expect(results.map((r) => r.page)).toEqual(["created", "updated", "replaced"]);
      for (const r of results) {
        expect(r).not.toHaveProperty("previousServer");
        expect(r).not.toHaveProperty("server");
      }
    });
  });

  describe("page code outcomes", () => {
    beforeEach(async () => {
      templateText = template(ID_B);
      await writer.write({ layout: "blank" });
      writeFileSync(
        file,
        page().replace(/(garmin-widgets:start \*\/).*?(\/\*)/, '$1[{"id":"w"}]$2'),
      );
    });

    it.each([
      ["an old number", "15"],
      ["another id", ID_A],
      ["a junk value", "x<script>"],
      ["0", "0"],
    ])("upgrades a page with %s and keeps its blocks", async (_name, content) => {
      writeFileSync(
        file,
        page().replace(/(<meta name="garmin-template" content=")[^"]*(")/, `$1${content}$2`),
      );
      const layout = readBlock(page(), "layout");
      const r = await writer.write({});
      expect(r).toMatchObject({ page: "upgraded", backup: `${file}.bak` });
      expect(existsSync(`${file}.bak`)).toBe(true);
      expect(pageCode(page())).toEqual({ from: "template", id: ID_B });
      expect(readBlock(page(), "layout")).toEqual(layout);
      expect(readBlock(page(), "widgets")).toEqual([{ id: "w" }]);
    });

    it("upgrades a page from a higher id too (a downgrade of the server)", async () => {
      templateText = template(ID_A);
      expect((await writer.write({})).page).toBe("upgraded");
      expect(pageCode(page())).toEqual({ from: "template", id: ID_A });
    });

    it("only updates a page with the same id, and makes no .bak", async () => {
      const r = await writer.write({});
      expect(r.page).toBe("updated");
      expect(r.backup).toBeUndefined();
      expect(existsSync(`${file}.bak`)).toBe(false);
    });

    it("keeps the layout of a page with an id when it is viewed", async () => {
      const layout = readBlock(page(), "layout");
      expect(layout).not.toBeNull();
      expect((await writer.view({})).blocks.layout).toEqual(layout);
    });
  });

  it("stops write and view when the template has no valid page code id", async () => {
    templateText = template("page-code-id");
    const message = /the page template has no page code id: build the server again/;
    await expect(writer.write({})).rejects.toThrow(message);
    await expect(writer.view({})).rejects.toThrow(message);
    expect(existsSync(file)).toBe(false);

    templateText = template(ID_B);
    await writer.write({});
    const before = page();
    templateText = template("15");
    await expect(writer.write({})).rejects.toThrow(message);
    expect(page()).toBe(before);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it("fills a page that Claude wrote, and never upgrades it", async () => {
    const own =
      "<html><script>const D = /* garmin-data:start */null/* garmin-data:end */;</script></html>";
    const r = await writer.write({ page: own });
    expect(r.page).toBe("replaced");
    expect(code(page())).toBe(code(own));
    expect(readBlock(page(), "data")).toMatchObject({ v: 3 });

    templateText = template(ID_C);
    expect((await writer.write({})).page).toBe("updated");
    expect(code(page())).toBe(code(own));
  });

  it("refuses a page without the data markers, and a page together with a layout", async () => {
    await expect(writer.write({ page: "<html></html>" })).rejects.toThrow(/garmin-data/);
    await expect(writer.write({ page: template(ID_A), layout: "preset" })).rejects.toThrow(
      /either/,
    );
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
<meta name="garmin-template" content="aaaaaaaaaaaaaaaa">
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
    recovery: [{ date: "2026-10-25", sleepH: 7.5, sleepScore: 80 }],
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
    // the digest is all the assistant gets for the notes: no sleep in it, also on a later update
    const update = await writer.write({ notes: ["n"] });
    for (const out of [JSON.stringify(r.digest), JSON.stringify(update.digest), page()]) {
      expect(out).not.toMatch(/sleep/i);
    }
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
    templateText = styledTemplate.replace(ID_A, ID_B);
    expect((await writer.write({})).page).toBe("upgraded");
    expect(readBlock(page(), "settings")).toEqual(kept);
    expect(page()).toContain("<title>Road to Rome</title>");
  });

  it("keeps the settings on an update and on a new layout; an argument replaces them", async () => {
    await writer.write({ settings: { exclude: ["zones"] } });
    expect(readBlock(page(), "settings")).toEqual({ exclude: ["zones"] });
    expect((await writer.write({})).page).toBe("updated");
    const beforeLayout = page();
    await writer.write({ layout: "blank" });
    expect(readBlock(page(), "settings")).toEqual({ exclude: ["zones"] });
    expect(readBlock(page(), "data")).not.toHaveProperty("zones");

    // the same build: the .bak keeps the page from before the new layout
    const r = await writer.write({ settings: { title: "Mine" } });
    expect(r.page).toBe("replaced");
    expect(r).not.toHaveProperty("backup");
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(beforeLayout);
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

  it("keeps the page from before a rebuild in .bak when the same build writes again", async () => {
    const start = new Date(2026, 9, 28, 12).getTime();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });
    try {
      await writer.write({});
      writeFileSync(file, page().replace("</script>", "// my page\n</script>"));
      const mine = page();
      await writer.write({ layout: "preset" });
      // an update in the same build keeps the build going
      expect(await writer.write({ notes: ["n"] })).toMatchObject({ page: "updated" });
      // the notes call of the same build, 1 ms before the 15 minutes end
      vi.setSystemTime(start + 15 * 60_000 - 1);
      const r = await writer.write({ settings: { title: "Mine" } });
      expect(r.page).toBe("replaced");
      expect(r).not.toHaveProperty("backup");
      expect(readFileSync(`${file}.bak`, "utf8")).toBe(mine);
      // 15 minutes after the last write, a replace keeps the page before it again
      vi.setSystemTime(start + 30 * 60_000 - 1);
      const before = page();
      expect(await writer.write({ layout: "blank" })).toMatchObject({ backup: `${file}.bak` });
      expect(readFileSync(`${file}.bak`, "utf8")).toBe(before);
      // a page that someone else changed is not the page of the build: it goes into .bak
      writeFileSync(file, page().replace("</script>", "// edited\n</script>"));
      const edited = page();
      expect(await writer.write({ layout: "preset" })).toMatchObject({ backup: `${file}.bak` });
      expect(readFileSync(`${file}.bak`, "utf8")).toBe(edited);
    } finally {
      vi.useRealTimers();
    }
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
  describe("while another process writes the page", () => {
    it.each([
      ["layout", { rev: "r9", base: "blank", boards: {} }, [1, 2]],
      ["widgets", [{ id: "w", title: "W", code: "x" }], [1, 2]],
      ["i18n", { de: { title: "Training" } }, [1, 2]],
      ["settings", { sports: ["running"] }, [1]],
    ] as const)(
      "keeps an edit to the %s block made during the Garmin calls",
      async (block, value, ids) => {
        await writer.write({});
        const { w, calls } = racingWriter(full, () =>
          writeFileSync(file, writeBlock(page(), block, value)),
        );
        expect((await w.write({ notes: ["n"] })).page).toBe("updated");
        expect(readBlock(page(), block)).toEqual(value);
        const written = readBlock(page(), "data") as Full;
        expect(written.notes).toEqual(["n"]);
        expect(written.activities.map((a) => a.id)).toEqual(ids);
        // the second try uses the snapshot: Garmin is called once
        expect(calls).toEqual({ garmin: 1, template: 2 });
      },
    );

    it("reads the page once and writes it when nothing changed it", async () => {
      await writer.write({});
      const before = code(page());
      const { w, calls } = racingWriter(full, () => {});
      expect((await w.write({})).page).toBe("updated");
      expect(code(page())).toBe(before);
      expect(calls).toEqual({ garmin: 1, template: 1 });
    });

    it("starts again when only the data changed (a parallel refresh), and writes its own data", async () => {
      await writer.write({});
      const { w, calls } = racingWriter(full, () =>
        writeFileSync(file, writeBlock(page(), "data", { ...full, notes: ["other"] })),
      );
      expect((await w.write({ notes: ["mine"] })).page).toBe("updated");
      expect(readBlock(page(), "data")).toMatchObject({ notes: ["mine"] });
      expect(calls).toEqual({ garmin: 1, template: 2 });
    });

    it("refuses to refresh a page deleted during the Garmin calls, and makes no new one", async () => {
      await writer.write({});
      const { w } = racingWriter(full, () => rmSync(file));
      await expect(w.write({ onlyExisting: true })).rejects.toThrow(/does not exist/);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(`${file}.bak`)).toBe(false);
    });

    it("refuses to write over a file that stopped being a page during the Garmin calls", async () => {
      await writer.write({});
      const { w } = racingWriter(full, () => writeFileSync(file, "<p>my notes</p>"));
      await expect(w.write({})).rejects.toThrow(/not a dashboard page/);
      expect(page()).toBe("<p>my notes</p>");
    });

    it("keeps the page and the .bak when a rebuild fails on a page that changes twice", async () => {
      await writer.write({});
      writeFileSync(`${file}.bak`, "older");
      let n = 0;
      const w = new DashboardWriter(
        async () => JSON.stringify(full),
        dir,
        async () => {
          writeFileSync(file, page().replace("</script>", `// edit ${++n}\n</script>`));
          return templateText;
        },
      );
      await expect(w.write({ layout: "blank" })).rejects.toThrow(
        /garmin-dashboard\.html changed twice while it was being updated: run the update again/,
      );
      expect(readFileSync(`${file}.bak`, "utf8")).toBe("older");
      expect(page()).toContain("// edit 2");
      expect(readBlock(page(), "layout")).toMatchObject({ base: "preset" });
    });

    it("keeps in .bak an edit made during the second write of a build", async () => {
      let edit = false;
      const w = new DashboardWriter(
        async () => JSON.stringify(full),
        dir,
        async () => {
          if (edit) {
            edit = false;
            writeFileSync(file, writeBlock(page(), "i18n", { de: { title: "Training" } }));
          }
          return templateText;
        },
      );
      await w.write({});
      expect(await w.write({ layout: "blank" })).toMatchObject({ backup: `${file}.bak` });
      edit = true;
      // the page is no longer the one this build wrote: the edited page goes to .bak
      expect(await w.write({ layout: "preset" })).toMatchObject({ backup: `${file}.bak` });
      const bak = readFileSync(`${file}.bak`, "utf8");
      expect(readBlock(bak, "i18n")).toEqual({ de: { title: "Training" } });
      // the page written by the second try is the build's page: the next write keeps that .bak
      expect(await w.write({ layout: "blank" })).not.toHaveProperty("backup");
      expect(readFileSync(`${file}.bak`, "utf8")).toBe(bak);
    });
  });
});

const setLayout = (value: unknown) => writeFileSync(file, writeBlock(page(), "layout", value));
const widgetsOf = (name: string) =>
  (
    readBlock(page(), "layout") as {
      boards: Record<string, { widget: string }[]>;
    }
  ).boards[name]?.map((i) => i.widget);
/** The page without its layout block and its update time. */
const withoutLayout = (text: string) =>
  text
    .replace(/\/\* garmin-layout:start.*?garmin-layout:end \*\//s, "")
    .replace(/"updated":"[^"]*"/, "");

describe("writeDashboard new preset widgets", () => {
  /** The running board of the preset, without longRuns. */
  const missing = preset("running").filter((i) => i.widget !== "longRuns");
  const edited = (extra: Record<string, unknown> = {}) => ({
    rev: "r1",
    base: "preset",
    boards: { running: missing },
    seen: { running: missing.map((i) => i.widget) },
    ...extra,
  });

  beforeEach(async () => {
    await writer.write({});
  });

  it("adds the widget and the record on an update, keeping rev, kind and no .bak", async () => {
    setLayout(edited());
    const r = await writer.write({});
    expect(r).toMatchObject({ page: "updated", addedWidgets: { running: ["longRuns"] } });
    expect(r.backup).toBeUndefined();
    expect(existsSync(`${file}.bak`)).toBe(false);
    const layout = readBlock(page(), "layout") as { rev: string; seen: Record<string, string[]> };
    expect(layout.rev).toBe("r1");
    expect(layout.seen.running).toEqual(preset("running").map((i) => i.widget));
    expect(widgetsOf("running")).toContain("longRuns");
  });

  it("adds them on an upgrade and keeps the .bak", async () => {
    setLayout(edited());
    writeFileSync(
      file,
      page().replace(/(<meta name="garmin-template" content=")[^"]*(")/, `$1${ID_A}$2`),
    );
    const r = await writer.write({});
    expect(r).toMatchObject({
      page: "upgraded",
      backup: `${file}.bak`,
      addedWidgets: { running: ["longRuns"] },
    });
    expect(widgetsOf("running")).toContain("longRuns");
  });

  it("adds them when new settings replace the page, and keeps the .bak", async () => {
    templateText = template(
      ID_B,
      "window.S = /* garmin-settings:start */null/* garmin-settings:end */;\n",
    );
    rmSync(file);
    await writer.write({});
    setLayout(edited());
    const r = await writer.write({ settings: { title: "Mine" } });
    expect(r).toMatchObject({
      page: "replaced",
      backup: `${file}.bak`,
      addedWidgets: { running: ["longRuns"] },
    });
    expect(widgetsOf("running")).toContain("longRuns");
  });

  it("gives a page from before the record nothing back, and saves the record", async () => {
    setLayout(edited({ seen: undefined }));
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(widgetsOf("running")).toEqual(missing.map((i) => i.widget));
    expect((readBlock(page(), "layout") as { seen: unknown }).seen).toEqual({
      running: preset("running").map((i) => i.widget),
    });
  });

  it("keeps a layout from editDashboard without a record through the next update", async () => {
    await writer.edit({ layout: { base: "preset", boards: { all: preset("all").slice(0, 1) } } });
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(widgetsOf("all")).toHaveLength(1);
  });

  it("does not throw on a board named like a property of Object", async () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      const layout = `{"rev":"r1","base":"preset","boards":{"${name}":[]},"seen":{"${name}":[]}}`;
      setLayout(JSON.parse(layout));
      // the board has a tab when the data has an activity of that sport
      const sport = { ...data.activities[0], type: "other", sport: name };
      writer = new DashboardWriter(
        async () => JSON.stringify({ ...data, activities: [sport] }),
        dir,
        async () => templateText,
      );
      const r = await writer.write({});
      expect(Object.hasOwn(r.addedWidgets ?? {}, name), name).toBe(true);
      expect(Object.entries(r.addedWidgets ?? {})).toEqual([
        [name, ["typeKpis", "typeWeekly", "hrZones", "activities"]],
      ]);
    }
  });

  /** The running board without workoutTrend, and not met: the only new widget is the opt-in one. */
  const withoutTrend = () => {
    const board = preset("running").filter((i) => i.widget !== "workoutTrend");
    return edited({ boards: { running: board }, seen: { running: board.map((i) => i.widget) } });
  };

  it("saves a widget that the page withholds but does not report it", async () => {
    setLayout(withoutTrend());
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(widgetsOf("running")).toContain("workoutTrend");
  });

  it("reports a widget that an opt-in setting turns on", async () => {
    templateText = template(
      ID_B,
      "window.S = /* garmin-settings:start */null/* garmin-settings:end */;\n",
    );
    rmSync(file);
    await writer.write({});
    setLayout(withoutTrend());
    // the settings of this write decide what the page shows, not those of the page before
    const r = await writer.write({ settings: { workouts: true } });
    expect(r).toMatchObject({ addedWidgets: { running: ["workoutTrend"] } });
  });

  it("reports a sport board only when the page has a tab for it", async () => {
    const swim = preset("swimming").filter((i) => i.widget !== "swimDetails");
    const layout = (name: string) =>
      edited({
        boards: { [name]: swim },
        seen: { [name]: swim.map((i) => i.widget) },
      });
    // no swimming in the data and not a fixed tab: no tab
    setLayout(layout("swimming"));
    expect(await writer.write({})).not.toHaveProperty("addedWidgets");
    // a fixed tab shows without data
    const cycling = preset("cycling").filter((i) => i.widget !== "bikeDetails");
    setLayout(
      edited({
        boards: { cycling },
        seen: { cycling: cycling.map((i) => i.widget) },
      }),
    );
    expect(await writer.write({})).toMatchObject({ addedWidgets: { cycling: ["bikeDetails"] } });
  });

  it("does not report the recovery board of a page that leaves recovery out", async () => {
    templateText = template(
      ID_B,
      "window.S = /* garmin-settings:start */null/* garmin-settings:end */;\n",
    );
    rmSync(file);
    await writer.write({});
    const board = preset("recovery").filter((i) => i.widget !== "fitnessAge");
    setLayout(
      edited({ boards: { recovery: board }, seen: { recovery: board.map((i) => i.widget) } }),
    );
    expect(await writer.write({ settings: { exclude: ["recovery"] } })).not.toHaveProperty(
      "addedWidgets",
    );
    setLayout(
      edited({ boards: { recovery: board }, seen: { recovery: board.map((i) => i.widget) } }),
    );
    expect(await writer.write({ settings: { exclude: [] } })).toMatchObject({
      addedWidgets: { recovery: ["fitnessAge"] },
    });
  });

  it("reports the boards of the sports that the page keeps, and all and recovery", async () => {
    templateText = template(
      ID_B,
      "window.S = /* garmin-settings:start */null/* garmin-settings:end */;\n",
    );
    rmSync(file);
    await writer.write({});
    const all = preset("all").filter((i) => i.widget !== "records");
    setLayout(
      edited({
        boards: { running: missing, all },
        seen: { running: missing.map((i) => i.widget), all: all.map((i) => i.widget) },
      }),
    );
    const r = await writer.write({ settings: { sports: ["cycling"] } });
    // running is left out: its widget is saved but not reported
    expect(r.addedWidgets).toEqual({ all: ["records"] });
    expect(widgetsOf("running")).toContain("longRuns");
  });

  it("adds nothing on a second write", async () => {
    setLayout(edited());
    await writer.write({});
    const first = readBlock(page(), "layout");
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(readBlock(page(), "layout")).toEqual(first);
  });

  it("saves only the record when the board has every preset widget", async () => {
    setLayout(edited({ boards: { running: preset("running") } }));
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(r.page).toBe("updated");
    expect((readBlock(page(), "layout") as { seen: unknown }).seen).toEqual({
      running: preset("running").map((i) => i.widget),
    });
  });

  it("does not stop on a layout block that is not valid JSON", async () => {
    writeFileSync(file, page().replace(/(garmin-layout:start \*\/).*?(\/\*)/, "$1{nope$2"));
    const before = page();
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(page().match(/garmin-layout:start \*\/(.*?)\/\* garmin-layout:end/)?.[1]).toBe(
      before.match(/garmin-layout:start \*\/(.*?)\/\* garmin-layout:end/)?.[1],
    );
  });

  it("leaves a blank layout, a new layout, a first write and your own page alone", async () => {
    setLayout(edited({ base: "blank" }));
    expect(await writer.write({})).not.toHaveProperty("addedWidgets");
    expect(widgetsOf("running")).toEqual(missing.map((i) => i.widget));

    setLayout(edited());
    const fresh = await writer.write({ layout: "preset" });
    expect(fresh).not.toHaveProperty("addedWidgets");
    expect(readBlock(page(), "layout")).toMatchObject({ boards: {} });

    rmSync(file);
    expect(await writer.write({})).not.toHaveProperty("addedWidgets");

    const own = `<script>/* garmin-data:start */null/* garmin-data:end */ /* garmin-layout:start */${JSON.stringify(edited())}/* garmin-layout:end */</script>`;
    expect(await writer.write({ page: own })).not.toHaveProperty("addedWidgets");
    expect(readBlock(page(), "layout")).toEqual(edited());
    // the next update does not take the layout of your own page either
    expect(await writer.write({})).not.toHaveProperty("addedWidgets");
    expect(readBlock(page(), "layout")).toEqual(edited());
  });

  it("changes only the layout block: data, notes and settings stay as without the merge", async () => {
    const notes = ["Easy week"];
    await writer.write({ notes });
    const plain = page();
    setLayout(edited());
    await writer.write({ notes });
    expect(withoutLayout(page())).toBe(withoutLayout(plain));
  });
});

/** The refresh record of the saved page. */
const record = () => readBlock(page(), "refresh");
/** The running board of an edited layout, without this widget. */
const running = (without: string) => {
  const board = preset("running").filter((i) => i.widget !== without);
  return {
    rev: "r1",
    base: "preset",
    boards: { running: board },
    seen: { running: board.map((i) => i.widget) },
  };
};

describe("writeDashboard refresh record", () => {
  const MARK = "window.R = /* garmin-refresh:start */null/* garmin-refresh:end */;\n";
  const SETTINGS = "window.S = /* garmin-settings:start */null/* garmin-settings:end */;\n";
  /** A page of code ID_A with a data block of this server version, then the template moves to ID_B. */
  async function oldPage(server?: string) {
    templateText = template(ID_A, MARK + SETTINGS);
    await writer.write({});
    if (server !== undefined) {
      writeFileSync(file, writeBlock(page(), "data", { server }));
    }
    templateText = template(ID_B, MARK + SETTINGS);
  }
  const first = { from: "0.5.0", server: serverVersion, code: ID_B, widgets: {} };

  it("saves the versions and the page code on an upgrade, with no widget", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    expect(record()).toEqual(first);
  });

  it("gives n/a as the old version of a page with no server", async () => {
    await oldPage();
    writeFileSync(file, writeBlock(page(), "data", { weeks: 12 }));
    await writer.write({});
    expect(record()).toMatchObject({ from: "n/a" });
  });

  it("saves widget names, not the numbered ids of the result", async () => {
    await oldPage("0.5.0");
    const board = preset("running").filter((i) => i.widget !== "longRuns");
    // the id longRuns is taken by another widget, so the new instance is longRuns-2
    const taken = { id: "longRuns", widget: "typeKpis", span: 1 };
    const boards = { running: [...board, taken] };
    writeFileSync(
      file,
      writeBlock(page(), "layout", {
        rev: "r1",
        base: "preset",
        boards,
        seen: { running: board.map((i) => i.widget) },
      }),
    );
    const r = await writer.write({});
    expect(r.addedWidgets).toEqual({ running: ["longRuns-2"] });
    expect(record()).toMatchObject({ widgets: { running: ["longRuns"] } });
  });

  it("leaves out a widget that the page withholds, as the result does", async () => {
    await oldPage("0.5.0");
    writeFileSync(file, writeBlock(page(), "layout", running("workoutTrend")));
    const r = await writer.write({});
    expect(r).not.toHaveProperty("addedWidgets");
    expect(record()).toMatchObject({ widgets: {} });
  });

  it("keeps the record on a data-only update, also when the update adds a widget", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    expect((await writer.write({})).page).toBe("updated");
    expect(record()).toEqual(first);
    writeFileSync(file, writeBlock(page(), "layout", running("longRuns")));
    expect(await writer.write({})).toMatchObject({
      page: "updated",
      addedWidgets: { running: ["longRuns"] },
    });
    expect(record()).toEqual(first);
  });

  it("copies the record on a write for new settings with the same page code", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    const r = await writer.write({ settings: { title: "Mine" } });
    expect(r.page).toBe("replaced");
    expect(record()).toEqual(first);
  });

  it("drops a record that is not valid JSON and still writes", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    writeFileSync(
      file,
      page().replace(/(garmin-refresh:start \*\/).*?(\/\* garmin-refresh:end)/s, "$1{oops$2"),
    );
    const r = await writer.write({ settings: { title: "Mine" } });
    expect(r.page).toBe("replaced");
    expect(record()).toBeNull();
  });

  it("writes no record when a newer server wrote the page before", async () => {
    await oldPage(`${Number(serverVersion.split(".")[0]) + 1}.0.0`);
    expect((await writer.write({})).page).toBe("upgraded");
    expect(record()).toBeNull();
  });

  it("orders versions by number, and ignores a version that is not x.y.z", () => {
    expect(olderThan("0.9.0", "0.10.0")).toBe(true);
    expect(olderThan("0.10.0", "0.9.0")).toBe(false);
    expect(olderThan("1.2.3", "1.2.3")).toBe(false);
    expect(olderThan("n/a", "1.0.0")).toBe(false);
    expect(olderThan("1.0.0", "n/a")).toBe(false);
  });

  it("still writes a record when the server version is the same", async () => {
    await oldPage(serverVersion);
    await writer.write({});
    expect(record()).toMatchObject({ from: serverVersion, server: serverVersion });
  });

  it("drops a record that cannot be written back, and still writes", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    writeFileSync(
      file,
      page().replace(
        /(garmin-refresh:start \*\/).*?(\/\* garmin-refresh:end)/s,
        '$1{"poison":1}$2',
      ),
    );
    // a value deep enough to pass a check can still fail in writeBlock: make only that call throw
    const real = JSON.stringify;
    const spy = vi.spyOn(JSON, "stringify").mockImplementation((v, ...rest) => {
      if (
        (v as { poison?: number } | null)?.poison === 1 &&
        new Error().stack?.includes("writeBlock")
      ) {
        throw new RangeError("deep");
      }
      return real(v, ...(rest as [never, never]));
    });
    try {
      const r = await writer.write({ settings: { title: "Mine" } });
      expect(r.page).toBe("replaced");
    } finally {
      spy.mockRestore();
    }
    expect(record()).toBeNull();
  });

  it("gives a new layout and a new page no record", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    await writer.write({ layout: "preset" });
    expect(record()).toBeNull();
    rmSync(file);
    await writer.write({});
    expect(record()).toBeNull();
  });

  it("writes your own page, with or without the marker, as it is", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    const own = dataPage("null");
    await writer.write({ page: own });
    expect(page()).toContain("garmin-data:start");
    expect(page()).not.toContain("garmin-refresh");
  });

  it("keeps the record when the assistant edits the page", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    await writer.edit({ languages: { de: { title: "Training" } } });
    expect(record()).toEqual(first);
  });

  it("does not give the chat view the record", async () => {
    await oldPage("0.5.0");
    await writer.write({});
    expect(Object.keys((await writer.view({})).blocks).toSorted()).toEqual(
      ["data", "i18n", "languages", "layout", "settings", "widgets"].toSorted(),
    );
  });
});

describe("writeBlock", () => {
  const empty = "/* garmin-layout:start */null/* garmin-layout:end */";

  it("escapes < and *, so a value cannot close the script or a block", () => {
    const value = { a: "</script>/**/" };
    const out = writeBlock(empty, "layout", value);
    expect(out).not.toContain("<");
    expect(
      out.slice("/* garmin-layout:start */".length, -"/* garmin-layout:end */".length),
    ).not.toContain("*");
    expect(readBlock(out, "layout")).toEqual(value);
  });

  it("writes a value 1,000 levels deep", () => {
    const value = JSON.parse("[".repeat(1000) + "]".repeat(1000)) as unknown;
    expect(readBlock(writeBlock(empty, "layout", value), "layout")).toEqual(value);
  });

  it("names the block of a value too deep to write back", () => {
    const deep = JSON.parse("[".repeat(200_000) + "]".repeat(200_000)) as unknown;
    let err: unknown;
    try {
      writeBlock(empty, "layout", deep);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnwritableBlockError);
    expect((err as UnwritableBlockError).block).toBe("layout");
    expect((err as Error).message).toBe(
      "The garmin-layout block of the page is too deeply nested to write back",
    );
    expect((err as Error).cause).toBeInstanceOf(RangeError);
  });
});
