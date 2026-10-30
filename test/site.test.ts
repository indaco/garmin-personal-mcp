import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { facts, render, themeGroups } from "../scripts/build-site.mjs";
import { THEMES } from "../src/page/theme";
import { AUTHORED, QUESTIONS } from "../site/questions";

// the fixtures are the tools/list and prompts/list answers of the server
const names = (file: string) =>
  (JSON.parse(readFileSync(file, "utf8")) as { name: string }[]).map((t) => t.name).toSorted();

/** n themes of one group. */
const g = (group: string, n: number) => Array.from({ length: n }, () => ({ group }));

describe("site facts", () => {
  const f = facts();

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
    const release = `<a\\s+href="${f.repository}/releases/tag/v${f.pkg.version}"[^>]*>\\s*v${f.pkg.version}<span class="sr-only"> release notes</span></a`;
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
