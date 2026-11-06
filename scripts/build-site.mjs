// Writes dist-site/: the project website, with its files and the demo dashboard. The pages come from
// site/index.html and site/whats-new.html, their partials, the styles and the bundled site script. The
// facts come from the files that own them (package.json, the README, the theme list, .changes/), so the
// site cannot drift from the code. `pnpm build:site`, after `pnpm build` for the demo. dist-site/ is what a
// server needs; `--preview <file>` also writes the page for a claude.ai preview, outside of it.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gifIsCurrent } from "./demo-stamp.mjs";

const read = (path) => readFileSync(path, "utf8");
const OUT = "dist-site";
// the cascade order of the site styles; hidden.css stays outside the layer, so it wins over it
const STYLES = [
  "base",
  "utilities",
  "header",
  "hero",
  "ask",
  "dashboard",
  "start",
  "tools",
  "whats-new",
  "promise",
  "footer",
  "responsive",
  "motion",
];
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n) => WORDS[n] ?? String(n);

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** README cell text as HTML: escaped, `code` kept as code. */
const cell = (s) => escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/** The lines of a README section, from its heading to the next heading of the same level. */
function section(readme, heading) {
  const lines = readme.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`the README has no "${heading}" section`);
  const level = heading.match(/^#+/)[0];
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^${level} `).test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

const NEW_TAB = '<span class="sr-only"> (opens in a new tab)</span>';

/** One line of Highlights as HTML. Text that is not converted stops the build: no raw Markdown on the page. */
function inline(text, file) {
  const codes = [];
  const html = escapeHtml(text)
    // code first: its text is not Markdown
    .replace(/`([^`]+)`/g, (_, code) => `\0${codes.push(code) - 1}\0`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, label, url) => {
      // \0 marks code: its text must not reach the attribute
      if (!/^https:\/\/[^\s"\0]+$/.test(url))
        throw new Error(`${file}: the link "${url}" is not https`);
      return `<a href="${url}" target="_blank" rel="noopener">${label}${NEW_TAB}</a>`;
    });
  if (/\*\*|`|\]\(/.test(html)) throw new Error(`${file}: open Markdown in "${text}"`);
  return html.replace(/\0(\d+)\0/g, (_, i) => `<code>${codes[i]}</code>`);
}

/** The Highlights as HTML: paragraphs and one level of "- " bullets, nothing else. */
function highlightsHtml(lines, file) {
  const html = [];
  let paragraph = [];
  let items = [];
  const close = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(" "), file)}</p>`);
    if (items.length)
      html.push(`<ul>${items.map((i) => `<li>${inline(i, file)}</li>`).join("")}</ul>`);
    paragraph = [];
    items = [];
  };
  for (const line of lines) {
    if (!line) close();
    else if (line.startsWith("- ")) {
      if (paragraph.length) close();
      items.push(line.slice(2));
    } else if (/^(\s|>|\||\d+\.|\* )/.test(line)) {
      throw new Error(`${file}: the Highlights cannot have the line "${line}"`);
    } else {
      if (items.length) close();
      paragraph.push(line);
    }
  }
  close();
  if (!html.length) throw new Error(`${file}: the Highlights have no text`);
  return html.join("");
}

/** The releases with Highlights in .changes/, the newest first. */
export function releases(root, repository) {
  return readdirSync(`${root}/.changes`)
    .filter((file) => /^v\d+\.\d+\.\d+\.md$/.test(file))
    .flatMap((file) => {
      const lines = read(`${root}/.changes/${file}`).split("\n");
      const start = lines.indexOf("### Highlights");
      if (start < 0) return [];
      const [, version, date] =
        lines.find((l) => l.startsWith("## "))?.match(/^## v(\S+) - (\d{4}-\d{2}-\d{2})$/) ?? [];
      if (file !== `v${version}.md`)
        throw new Error(`${file}: the first heading must be "## v<version> - <date>" of this file`);
      const rest = lines.slice(start + 1);
      // #### Upgrading comes next: the Highlights stop at a heading of any level
      const end = rest.findIndex((l) => /^#{1,6} /.test(l) || l === "---");
      return {
        version,
        id: `v${version.replaceAll(".", "-")}`,
        date,
        dateText: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
          dateStyle: "long",
          timeZone: "UTC",
        }),
        url: `${repository}/releases/tag/v${version}`,
        html: highlightsHtml(end < 0 ? rest : rest.slice(0, end), file),
      };
    })
    .toSorted((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }));
}

/** The facts of the site, from the files that own them. */
export function facts(root = ".") {
  const pkg = JSON.parse(read(`${root}/package.json`));
  const readme = read(`${root}/README.md`);
  const site = JSON.parse(read(`${root}/site/site.json`));
  const tools = section(readme, "## Tools")
    .map((l) => l.match(/^\|\s*`(\w+)`\s*\|\s*(.+?)\s*\|$/))
    .filter(Boolean)
    .map(([, name, text]) => ({ name, text }));
  // the prompt tables of the README: the first column links the prompt's section
  const promptTable = (heading) =>
    section(readme, heading)
      .map((l) => l.match(/^\|\s*\[([\w-]+)\]\([^)]*\)\s*\|\s*(.+?)\s*\|/))
      .filter(Boolean)
      .map(([, name, text]) => ({ name, text }));
  const prompts = promptTable("## Dashboard");
  // the sport tab of "What you can ask" that each coach prompt goes with
  const coachPrompts = promptTable("## Coach prompts").map((p) => ({
    ...p,
    sport:
      {
        "strength-review": "strength",
        "swim-review": "swimming",
        "swim-readiness": "swimming",
        "train-today": "every",
        "week-review": "every",
      }[p.name] ?? "running",
  }));
  const themes = [
    ...read(`${root}/src/page/theme.ts`).matchAll(/\{ id: "(\w+)", group: "(\w+)" \}/g),
  ].map(([, id, group]) => ({ id, group }));
  // the README's "What you can ask" examples; a line that wraps goes on with two spaces
  const questions = section(readme, "## What you can ask")
    .join("\n")
    .replace(/\n {2}/g, " ")
    .split("\n")
    .map((l) => l.match(/^- [^:]+: "(.+)"$/)?.[1])
    .filter(Boolean);
  const node = pkg.engines.node.match(/\d+/)[0];
  const repository = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  return {
    pkg,
    site,
    tools,
    prompts,
    coachPrompts,
    themes,
    questions,
    package: `${pkg.name}@latest`,
    node: `Node.js ${node} or later`,
    repository,
    releases: releases(root, repository),
  };
}

/** "six dark, four light, two high-contrast, and System": the theme menu in words. */
export function themeGroups(themes) {
  const count = (group) => themes.filter((t) => t.group === group).length;
  const auto = count("auto") > 0 ? ", and System" : "";
  return `${word(count("dark"))} dark, ${word(count("light"))} light, ${word(count("accessible"))} high-contrast${auto}`;
}

function jsonLd(f) {
  const url = f.site.url;
  const npm = `https://www.npmjs.com/package/${f.pkg.name}`;
  const license = `https://opensource.org/licenses/${f.pkg.license}`;
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": `${url}#website`,
          name: "garmin-personal-mcp",
          url,
          inLanguage: "en",
        },
        {
          "@type": "SoftwareApplication",
          "@id": `${url}#app`,
          name: "garmin-personal-mcp",
          url,
          description: f.site.description,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "macOS, Linux, Windows",
          softwareRequirements: f.node,
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          license,
          downloadUrl: npm,
          image: `${url}og-image.png`,
          author: { "@type": "Person", ...f.site.author },
          sameAs: [f.repository, npm],
        },
        {
          "@type": "SoftwareSourceCode",
          name: "garmin-personal-mcp",
          codeRepository: f.repository,
          programmingLanguage: "TypeScript",
          runtimePlatform: "Node.js",
          license,
          targetProduct: { "@id": `${url}#app` },
        },
      ],
    },
    null,
    2,
  );
}

/** The {{name}} values of the partials and the public text files. */
export function values(f) {
  return {
    // the home page; renderWhatsNew gives its own values
    home: "",
    title: "garmin-personal-mcp",
    canonical: f.site.url,
    url: f.site.url,
    description: escapeHtml(f.site.description),
    version: f.pkg.version,
    license: f.pkg.license,
    repository: f.repository,
    npm: `https://www.npmjs.com/package/${f.pkg.name}`,
    package: f.package,
    node: f.node,
    jsonld: jsonLd(f),
    toolCount: String(f.tools.length),
    tools: f.tools
      .map((t) => `<div class="tool"><code>${t.name}</code><span>${cell(t.text)}</span></div>`)
      .join("\n"),
    prompts: promptRows(f.prompts),
    coachPrompts: promptRows(f.coachPrompts),
    themeCount: String(f.themes.length),
    themeGroups: themeGroups(f.themes),
    releases: f.releases
      .map(
        (r) =>
          `<article id="${r.id}"><div class="release-head"><h2>v${r.version}</h2><time datetime="${r.date}">${r.dateText}</time></div><div class="release-text">${r.html}<p><a href="${r.url}" target="_blank" rel="noopener">All changes in v${r.version}${NEW_TAB}</a></p></div></article>`,
      )
      .join("\n"),
  };
}

const promptRows = (list) =>
  list
    .map(
      (p) =>
        `<tr${p.sport ? ` data-sport="${p.sport}"` : ""}><td><code>${p.name}</code></td><td>${cell(p.text)}</td></tr>`,
    )
    .join("\n");

function fill(text, vals) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, name) => {
    if (!(name in vals)) throw new Error(`no value for ${all}`);
    return vals[name];
  });
}

/** A page: the template with its partials, styles and script, and the facts filled in. */
function build(template, root, script, vals) {
  const css =
    `@layer site {\n${STYLES.map((n) => read(`${root}/site/styles/${n}.css`)).join("\n")}}\n` +
    read(`${root}/site/styles/hidden.css`);
  if (/<\/(style|script)/i.test(css + script))
    throw new Error("the styles or the script contain a closing tag");
  const page = read(`${root}/site/${template}`)
    .replace(/<!--include (\w+)-->/g, (_, name) => read(`${root}/site/partials/${name}.html`))
    .replace("<!--style-->", () => `<style>\n${css}</style>`)
    .replace("<!--script-->", () => `<script>\n${script}</script>`);
  return fill(page, vals);
}

/** The home page. */
export function render({ root = ".", script = "", preview = false } = {}) {
  const page = build("index.html", root, script, values(facts(root)));
  if (!preview) return page;
  // the claude.ai preview adds its own document around the page: only the head content and the body
  const head = page.match(/<meta name="viewport"[^>]*>\s*([\s\S]*?)<\/head>/)[1];
  const body = page.match(/<body>([\s\S]*)<\/body>/)[1];
  return `<meta name="claude:viewport-fit-sides" content="cover" />\n${head}${body}`;
}

/** The What's new page. It is next to the home page, so only its links to the sections change. */
export function renderWhatsNew({ root = ".", script = "" } = {}) {
  const vals = values(facts(root));
  return build("whats-new.html", root, script, {
    ...vals,
    home: "index.html",
    title: "What's new - garmin-personal-mcp",
    canonical: `${vals.url}whats-new.html`,
  });
}

function main() {
  // a clean folder: nothing from an older build reaches the server
  for (const name of readdirSync(OUT))
    if (name !== ".script") rmSync(`${OUT}/${name}`, { recursive: true });
  const scriptDir = `${OUT}/.script`;
  const script = read(`${scriptDir}/${readdirSync(scriptDir).find((f) => f.endsWith(".js"))}`);
  rmSync(scriptDir, { recursive: true });
  mkdirSync(`${OUT}/demo`, { recursive: true });
  writeFileSync(`${OUT}/index.html`, render({ script }));
  writeFileSync(`${OUT}/whats-new.html`, renderWhatsNew({ script }));
  const { preview } = parseArgs({ options: { preview: { type: "string" } } }).values;
  if (preview) writeFileSync(preview, render({ script, preview: true }));
  const vals = values(facts());
  for (const name of readdirSync("site/public")) {
    const from = `site/public/${name}`;
    if (/\.(txt|xml)$/.test(name)) writeFileSync(`${OUT}/${name}`, fill(read(from), vals));
    else copyFileSync(from, `${OUT}/${name}`);
  }
  copyFileSync("assets/logo-192.png", `${OUT}/icon-192.png`);
  if (!gifIsCurrent()) {
    throw new Error(
      "The demo images are stale: the page or the demo scripts changed. Run pnpm demo",
    );
  }
  copyFileSync("assets/dashboard.gif", `${OUT}/dashboard.gif`);
  copyFileSync("assets/dashboard-chat.webp", `${OUT}/dashboard-chat.webp`);
  if (!existsSync("dist/dashboard.html"))
    throw new Error("the demo needs the dashboard template: run pnpm build first");
  // the demo script writes into dist-site/demo/ by default; the page needs only its HTML
  execFileSync("node", ["scripts/demo-dashboard.mjs"], { stdio: "ignore" });
  rmSync(`${OUT}/demo/demo-data.json`);
  console.log(
    `${OUT}/ written: index.html, whats-new.html, the public files and demo/${preview ? `; ${preview}` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
