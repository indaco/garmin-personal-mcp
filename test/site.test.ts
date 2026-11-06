import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { facts, releases, render, renderWhatsNew, themeGroups } from "../scripts/build-site.mjs";
import { gifIsCurrent, STAMP_FILE } from "../scripts/demo-stamp.mjs";
import { THEMES } from "../src/page/theme";
import { AUTHORED, QUESTIONS } from "../site/questions";

const NEW_TAB = '<span class="sr-only"> (opens in a new tab)</span>';
const REPO = "https://github.com/indaco/garmin-personal-mcp";

/** The notes of one version, with these lines as its Highlights. */
const note = (version: string, ...lines: string[]) =>
  [`## v${version} - 2026-11-03`, "", "### Highlights", "", ...lines, ""].join("\n");

describe("releases on the website", () => {
  const roots: string[] = [];
  /** A folder with these .changes files: file name -> text. */
  const changes = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "site-changes-"));
    roots.push(root);
    mkdirSync(join(root, ".changes"));
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(root, ".changes", name), text);
    return root;
  };
  const htmlOf = (...lines: string[]) =>
    releases(changes({ "v1.0.0.md": note("1.0.0", ...lines) }), REPO)[0]!.html;

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  });

  it("gives the newest version first, by number and not by text", () => {
    const root = changes({
      "v0.9.0.md": note("0.9.0", "Nine."),
      "v0.10.0.md": note("0.10.0", "Ten."),
      "v0.2.0.md": note("0.2.0", "Two."),
    });
    expect(releases(root, REPO).map((r) => r.version)).toEqual(["0.10.0", "0.9.0", "0.2.0"]);
  });

  it("gives the id, the date and the GitHub link of a version", () => {
    const root = changes({ "v0.10.0.md": note("0.10.0", "Ten.") });
    expect(releases(root, REPO)).toEqual([
      {
        version: "0.10.0",
        id: "v0-10-0",
        date: "2026-11-03",
        dateText: "November 3, 2026",
        url: `${REPO}/releases/tag/v0.10.0`,
        html: "<p>Ten.</p>",
      },
    ]);
  });

  it("does not list a version without Highlights, or other files", () => {
    const root = changes({
      "v0.1.0.md": "## v0.1.0 - 2026-10-27\n\n### 🚀 Enhancements\n\n- first version\n",
      "v0.2.0.md": note("0.2.0", "Two."),
      "notes.md": "### Highlights\n\nNot a release.\n",
    });
    expect(releases(root, REPO).map((r) => r.version)).toEqual(["0.2.0"]);
  });

  it("ends the Highlights at the next heading of any level, and at a rule", () => {
    expect(htmlOf("Ten.", "", "#### Upgrading", "", "Restart.")).toBe("<p>Ten.</p>");
    expect(htmlOf("Ten.", "", "### 🚀 Enhancements", "", "- a commit")).toBe("<p>Ten.</p>");
    expect(htmlOf("Ten.", "", "---", "", "Other.")).toBe("<p>Ten.</p>");
  });

  it("converts paragraphs, bullets, bold text, code and links", () => {
    expect(
      htmlOf(
        "One line",
        "goes on.",
        "",
        "Other.",
        "",
        "- **Bold `setup`.** Run `a**b**`.",
        "- See [the guide](https://example.com/a?x=1&y=2).",
      ),
    ).toBe(
      "<p>One line goes on.</p><p>Other.</p><ul>" +
        "<li><strong>Bold <code>setup</code>.</strong> Run <code>a**b**</code>.</li>" +
        `<li>See <a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener">the guide${NEW_TAB}</a>.</li>` +
        "</ul>",
    );
  });

  it("escapes HTML in the text and in code", () => {
    expect(htmlOf("A <b> & `<i>`.")).toBe("<p>A &lt;b&gt; &amp; <code>&lt;i&gt;</code>.</p>");
  });

  it.each([
    ["a quote", "> quoted"],
    ["a numbered list", "1. first"],
    ["a table", "| a | b |"],
    ["a code block", "```bash"],
    ["an indented line", "  more"],
    ["a star bullet", "* item"],
    ["open bold text", "**open"],
    ["open code", "`open"],
    ["a link that is not https", "[a](http://example.com)"],
    ["a script link", "[a](javascript:alert)"],
    ["a link with a quote", '[a](https://example.com/"x)'],
    ["a relative link", "[a](guide/a.md)"],
    ["code in a link address", '[a](https://example.com/`" onmouseover="alert(1)`)'],
  ])("refuses %s, so that no raw Markdown reaches the page", (_, line) => {
    expect(() => htmlOf(line)).toThrow(/v1\.0\.0\.md/);
  });

  it("refuses empty Highlights", () => {
    expect(() => htmlOf("", "#### Upgrading")).toThrow(/v1\.0\.0\.md: the Highlights have no text/);
  });

  it("refuses a heading that does not match the file name, or has no date", () => {
    expect(() => releases(changes({ "v1.0.0.md": note("1.0.1", "One.") }), REPO)).toThrow(
      /v1\.0\.0\.md/,
    );
    expect(() =>
      releases(changes({ "v1.0.0.md": "## v1.0.0\n\n### Highlights\n\nOne.\n" }), REPO),
    ).toThrow(/v1\.0\.0\.md/);
  });

  it("has the Highlights and the upgrade text in the notes of the current version", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    const lines = readFileSync(`.changes/v${version}.md`, "utf8").split("\n");
    expect(lines).toContain("### Highlights");
    expect(lines).toContain("#### Upgrading");
    expect(facts().releases[0]!.version).toBe(version);
  });
});

describe("what's new page", () => {
  const page = renderWhatsNew();
  const home = render();
  const f = facts();

  it("is a whole document with every placeholder filled", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).not.toMatch(/\{\{\w+\}\}/);
    expect(page).not.toContain("<!--include");
    expect(page).toContain("<title>What's new - garmin-personal-mcp</title>");
    expect(page).toContain(`<link rel="canonical" href="${f.site.url}whats-new.html" />`);
    expect(page).toContain(`<meta property="og:url" content="${f.site.url}whats-new.html" />`);
  });

  it("keeps the title and the address of the home page", () => {
    expect(home).toContain("<title>garmin-personal-mcp</title>");
    expect(home).toContain(`<link rel="canonical" href="${f.site.url}" />`);
  });

  it("shows each release with its Highlights, its date and its GitHub link", () => {
    expect(f.releases.length).toBeGreaterThan(0);
    for (const r of f.releases) {
      expect(page).toContain(`<article id="${r.id}">`);
      expect(page).toContain(r.html);
      expect(page).toContain(`<time datetime="${r.date}">${r.dateText}</time>`);
      expect(page).toContain(`href="${r.url}"`);
    }
    // no commit lists and no upgrade text in a release
    expect(page).not.toContain("/commit/");
    expect(page).not.toContain("@latest refresh");
  });

  it("shows the update steps one time, above the releases", () => {
    const steps = page.indexOf('id="update"');
    expect(steps).toBeGreaterThan(-1);
    expect(steps).toBeLessThan(page.indexOf("<article"));
    expect(page.split('id="update"')).toHaveLength(2);
    expect(page).toContain("guide/dashboard.md#update-the-page-code-after-a-release");
  });

  it("links the sections of the header to the home page", () => {
    for (const id of ["ask", "dashboard", "start", "tools"]) {
      expect(page).toContain(`href="index.html#${id}"`);
      expect(page).not.toContain(`href="#${id}"`);
      expect(home).toContain(`href="#${id}"`);
    }
  });

  it("has a link in the header and in the footer of both pages", () => {
    for (const html of [home, page]) expect(html.split('href="whats-new.html"').length - 1).toBe(2);
  });
});

// the fixtures are the tools/list and prompts/list answers of the server
const names = (file: string) =>
  (JSON.parse(readFileSync(file, "utf8")) as { name: string }[]).map((t) => t.name).toSorted();

/** n themes of one group. */
const g = (group: string, n: number) => Array.from({ length: n }, () => ({ group }));

describe("site facts", () => {
  const f = facts();

  it("has demo images recorded from the current page and demo data", () => {
    // the README and the website show assets/dashboard.gif, the website also assets/dashboard-chat.webp:
    // after a change to their inputs, run pnpm demo
    expect(gifIsCurrent(), `the demo images are stale: run pnpm demo (${STAMP_FILE})`).toBe(true);
  });

  it("lists the tools that the server registers, from the README table", () => {
    expect(f.tools.map((t) => t.name).toSorted()).toEqual(names("test/fixtures/tool-list.json"));
    expect(f.tools.every((t) => t.text.length > 0)).toBe(true);
  });

  it("lists the coach prompts of the README, apart from the dashboard prompts", () => {
    const prompts = names("test/fixtures/prompt-list.json");
    expect(f.coachPrompts.map((p) => [p.name, p.sport])).toEqual([
      ["run-review", "running"],
      ["race-readiness", "running"],
      ["strength-review", "strength"],
      ["swim-review", "swimming"],
      ["swim-readiness", "swimming"],
      ["train-today", "every"],
      ["week-review", "every"],
    ]);
    for (const p of f.coachPrompts) expect(prompts).toContain(p.name);
    expect(f.prompts.map((p) => p.name)).not.toContain("run-review");
  });

  it("lists dashboard prompts that the server has", () => {
    const prompts = names("test/fixtures/prompt-list.json");
    expect(f.prompts.length).toBeGreaterThan(0);
    for (const p of f.prompts) expect(prompts).toContain(p.name);
  });

  it("reads every theme of the menu", () => {
    expect(f.themes).toEqual(THEMES);
  });

  it("names the package and the Node version of package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(f.package).toBe(`${pkg.name}@latest`);
    expect(f.node).toBe(`Node.js ${pkg.engines.node.match(/\d+/)[0]} or later`);
  });

  it("says the theme menu in words", () => {
    expect(
      themeGroups([...g("auto", 1), ...g("dark", 6), ...g("light", 4), ...g("accessible", 2)]),
    ).toBe("six dark, four light, two high-contrast, and System");
    expect(themeGroups(g("dark", 1))).toBe("one dark, no light, no high-contrast");
  });
});

describe("site questions", () => {
  const readme = facts().questions;
  const tools = new Set(facts().tools.map((t) => t.name));

  it("quotes the README word for word, except the sports marked as written for the page", () => {
    expect(readme.length).toBeGreaterThan(5);
    for (const [sport, list] of Object.entries(QUESTIONS))
      if (!AUTHORED.has(sport))
        for (const [q] of list)
          expect([sport, readme]).toEqual([sport, expect.arrayContaining([q])]);
  });

  it("names only tools that exist", () => {
    for (const list of Object.values(QUESTIONS))
      for (const [, via] of list) for (const t of via.split(" · ")) expect(tools).toContain(t);
  });
});

describe("site page", () => {
  const page = render();

  it("fills every placeholder", () => {
    expect(page).not.toMatch(/\{\{\w+\}\}/);
    expect(page).not.toContain("<!--include");
  });

  it("shows the facts of the code", () => {
    const f = facts();
    expect(page).toContain(`npx -y ${f.package}`);
    expect(page).toContain(`${f.tools.length} tools, all of the Personal API.`);
    expect(page).toContain(`${f.themes.length} themes, your languages`);
    for (const t of f.tools) expect(page).toContain(`<code>${t.name}</code>`);
    for (const p of f.prompts) expect(page).toContain(`<code>${p.name}</code>`);
    // the footer: the version of package.json, linked to its release notes
    const release = `<a\\s+href="${f.repository}/releases/tag/v${f.pkg.version}"[^>]*>\\s*v${f.pkg.version}<span class="sr-only"> release notes \\(opens in a new tab\\)</span></a`;
    expect(page).toMatch(new RegExp(release.replace(/\./g, "\\.")));
  });

  it("is a whole document, and the preview is the head content and the body", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    const preview = render({ preview: true });
    expect(preview).not.toMatch(/<html|<head>|<body/);
    expect(preview).toContain('<meta property="og:url"');
    expect(preview).toContain('<main id="top">');
  });

  it("keeps a valid JSON-LD block", () => {
    const json = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
    expect(JSON.parse(json)["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual([
      "WebSite",
      "SoftwareApplication",
      "SoftwareSourceCode",
    ]);
  });
});
