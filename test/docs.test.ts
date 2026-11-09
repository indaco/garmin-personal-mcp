import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUPS } from "../src/analytics/calc";
import { CATALOGUE } from "../src/page/catalogue";
import { ABOUT } from "../src/page/catalogue-about";
import { en } from "../src/page/i18n/en";
import { preset } from "../src/page/presets";
import { WIDGET_API } from "../src/page/widget-api";

/**
 * The parts of the guide that come from the code. `pnpm guide` writes them; this test fails when they are
 * not current, so the guide never drifts from the widgets and the texts.
 */

const BOARDS = ["all", ...GROUPS];
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The types of a widget for the table: every type in short, or a list. */
const types = (t?: readonly string[]) =>
  t
    ? t.length > 8
      ? "all and each type"
      : t.map((x) => (x === "all" ? "all" : x)).join(", ")
    : "-";

function widgetsDoc(): string {
  const lines = [
    "# Widget catalogue",
    "",
    "The built-in widgets of the dashboard. `pnpm guide` writes this page from the code: do not change",
    "it by hand.",
    "",
    "| Widget | Id | Shows | Types | Width |",
    "| ------ | -- | ----- | ----- | ----- |",
    ...CATALOGUE.map(
      (c) =>
        `| ${en[c.title]} | \`${c.id}\` | ${cell(ABOUT[c.id])} | ${types(c.types)} | ${c.span} |`,
    ),
    "",
    "_Types_ are the types that the widget can show. A widget without types shows the same thing on",
    "every board. _Width_ is the default width in columns.",
    "",
    "## The preset of each board",
    "",
    "| Board | Widgets, in order |",
    "| ----- | ----------------- |",
    ...BOARDS.map(
      (b) =>
        `| ${b} | ${preset(b)
          .map((i) => `\`${i.widget}\``)
          .join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function keysPart(): string {
  return [
    "| Key | English text |",
    "| --- | ------------ |",
    ...Object.entries(en).map(([k, v]) => `| \`${k}\` | ${cell(v)} |`),
  ].join("\n");
}

/** The file with the text between the two markers replaced. */
function between(file: string, name: string, text: string): string {
  const s = readFileSync(file, "utf8");
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  return `${s.slice(0, s.indexOf(start) + start.length)}\n${text}\n${s.slice(s.indexOf(end))}`;
}

function check(file: string, text: string): void {
  if (process.env.UPDATE_DOCS) writeFileSync(file, text);
  expect(readFileSync(file, "utf8"), `${file} is not current: run pnpm guide`).toBe(text);
}

describe("guide", () => {
  it("lists every widget", () => {
    check("guide/widgets.md", widgetsDoc());
  });

  it("has the widget API that the server sends", () => {
    check(
      "guide/custom-widgets.md",
      between("guide/custom-widgets.md", "widget-api", ["```text", WIDGET_API, "```"].join("\n")),
    );
  });

  it("lists every text", () => {
    check("guide/languages.md", between("guide/languages.md", "keys", keysPart()));
  });
});

/** The garmin-personal server of each json block in a Markdown file. */
const servers = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/```json\n([\s\S]*?)```/g)]
    .filter((m) => m[1].includes('"mcpServers"'))
    .map((m) => JSON.parse(m[1]).mcpServers["garmin-personal"]);

describe("setup steps", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("names the package of package.json in the setup docs", () => {
    // release notes may name a pinned version, so only the docs that a reader follows
    const files = execFileSync("git", ["ls-files", "README.md", "CONTRIBUTING.md", "guide/*.md"], {
      encoding: "utf8",
    }).split("\n");
    for (const file of files.filter(Boolean))
      for (const [name] of readFileSync(file, "utf8").matchAll(
        /@indaco\/garmin-personal-mcp@[\w.^~-]+/g,
      ))
        expect(name, file).toBe(`${pkg.name}@latest`);
  });

  it("gives the step-by-step page the server of the README, with the key in env", () => {
    const [readme] = servers("README.md");
    const guide = servers("guide/setup-claude-desktop.md");
    expect(guide).toHaveLength(2);
    for (const { env, ...server } of guide) {
      expect(server).toEqual(readme);
      expect(Object.keys(env)).toEqual(["GARMIN_PERSONAL_API_KEY"]);
    }
  });
});
