import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DashboardWriter, readBlock, UnwritableBlockError } from "../src/dashboard-page";

// JSON.parse reads any depth, JSON.stringify overflows the stack: far past every Node stack size
const DEEP = "[".repeat(200_000) + "]".repeat(200_000);
const DEEP_BLOCKS = {
  layout: `{"rev":"r","base":"preset","boards":{},"x":${DEEP}}`,
  widgets: `[{"id":"mine","title":"T","code":"return 1","x":${DEEP}}]`,
  i18n: `{"xx":${DEEP}}`,
} as const;
type DeepBlock = keyof typeof DEEP_BLOCKS;

const template = (id: string) => `<!doctype html>
<meta name="garmin-template" content="${id}">
<script>
window.GARMIN_SETTINGS = /* garmin-settings:start */null/* garmin-settings:end */;
const DATA = /* garmin-data:start */null/* garmin-data:end */;
const LAYOUT = /* garmin-layout:start */null/* garmin-layout:end */;
const WIDGETS = /* garmin-widgets:start */[]/* garmin-widgets:end */;
const I18N = /* garmin-i18n:start */{}/* garmin-i18n:end */;
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
let templateText: string;
let writer: DashboardWriter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deep-block-"));
  file = join(dir, "garmin-dashboard.html");
  templateText = template("aaaaaaaaaaaaaaaa");
  writer = new DashboardWriter(
    async () => JSON.stringify(data),
    dir,
    async () => templateText,
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const page = () => readFileSync(file, "utf8");
const library = () => join(dir, "widgets.json");

/** A page from the template with `block` set to a deep value; returns the page text. */
async function pageWith(block: DeepBlock, otherLibrary = false): Promise<string> {
  await writer.write({});
  const re = new RegExp(`(garmin-${block}:start \\*/).*?(/\\* garmin-${block}:end)`, "s");
  writeFileSync(
    file,
    page().replace(re, (_, a: string, b: string) => a + DEEP_BLOCKS[block] + b),
  );
  if (otherLibrary) {
    writeFileSync(library(), JSON.stringify([{ id: "other", title: "O", code: "return 2" }]));
  }
  return page();
}

type Call = { name: string; run: () => Promise<unknown> };
const settings: Call = {
  name: "new settings",
  run: () => writer.write({ settings: { title: "Mine" } }),
};
const upgrade: Call = {
  name: "an upgrade",
  run: () => {
    templateText = template("bbbbbbbbbbbbbbbb");
    return writer.write({});
  },
};
const update: Call = { name: "a data update", run: () => writer.write({}) };
const view: Call = { name: "the chat view", run: () => writer.view({}) };
const read: Call = { name: "an edit that only reads", run: () => writer.edit({}) };
const place: Call = {
  name: "an edit that places a widget",
  run: () => writer.edit({ place: [{ board: "all", widget: "calendar" }] }),
};
const language: Call = {
  name: "an edit that adds texts",
  run: () => writer.edit({ languages: { de: { na: "k. A." } } }),
};

const cases: { block: DeepBlock; otherLibrary: boolean; calls: Call[] }[] = [
  { block: "layout", otherLibrary: false, calls: [settings, upgrade, view] },
  {
    block: "widgets",
    otherLibrary: false,
    calls: [settings, upgrade, update, view, read, place, language],
  },
  { block: "widgets", otherLibrary: true, calls: [settings, upgrade, update, view, place] },
  { block: "i18n", otherLibrary: false, calls: [settings, upgrade, view, language] },
];

describe("a page block too deep to write back", () => {
  for (const { block, otherLibrary, calls } of cases) {
    const label = block === "widgets" ? `${block} (${otherLibrary ? "a" : "no"} library)` : block;
    for (const call of calls) {
      it(`refuses ${call.name} with a deep ${label} block, and names the block and the file`, async () => {
        const before = await pageWith(block, otherLibrary);
        const err = await call.run().then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(RangeError);
        expect((err as Error).message).toContain(`garmin-${block} block`);
        expect((err as Error).message).toContain(file);
        expect((err as Error).cause).toBeInstanceOf(UnwritableBlockError);
        expect(page()).toBe(before);
        expect(existsSync(`${file}.bak`)).toBe(false);
        expect(existsSync(library())).toBe(otherLibrary);
      });
    }
  }

  it.each(["layout", "widgets", "i18n"] as const)(
    "lets a new layout replace a page with a deep %s block",
    async (block) => {
      await pageWith(block);
      expect((await writer.write({ layout: "preset" })).page).toBe("replaced");
      expect(readBlock(page(), "i18n")).toEqual({});
      expect(readBlock(page(), "widgets")).toEqual([]);
      expect(existsSync(library())).toBe(false);
    },
  );
});
