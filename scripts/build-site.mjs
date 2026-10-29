// Writes dist-site/: the project website as one page, with its files and the demo dashboard.
// The page comes from site/index.html, its partials, its styles and the bundled site script. The facts
// come from the files that own them (package.json, the README, the theme list), so the site cannot
// drift from the code. `pnpm build:site`, after `pnpm build` for the demo. dist-site/ is what a
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

/** The facts of the site, from the files that own them. */
export function facts(root = ".") {
  const pkg = JSON.parse(read(`${root}/package.json`));
  const readme = read(`${root}/README.md`);
  const site = JSON.parse(read(`${root}/site/site.json`));
  const tools = section(readme, "## Tools")
    .map((l) => l.match(/^\|\s*`(\w+)`\s*\|\s*(.+?)\s*\|$/))
    .filter(Boolean)
    .map(([, name, text]) => ({ name, text }));
  const prompts = section(readme, "## Dashboard")
    .map((l) => l.match(/^\|\s*\[([\w-]+)\]\([^)]*\)\s*\|\s*(.+?)\s*\|/))
    .filter(Boolean)
    .map(([, name, text]) => ({ name, text }));
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
  return {
    pkg,
    site,
    tools,
    prompts,
    themes,
    questions,
    package: `${pkg.name}@latest`,
    node: `Node.js ${node} or later`,
    repository: pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
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
    url: f.site.url,
    description: escapeHtml(f.site.description),
    package: f.package,
    node: f.node,
    jsonld: jsonLd(f),
    toolCount: String(f.tools.length),
    tools: f.tools
      .map((t) => `<div class="tool"><code>${t.name}</code><span>${cell(t.text)}</span></div>`)
      .join("\n"),
    prompts: f.prompts
      .map((p) => `<tr><td><code>${p.name}</code></td><td>${cell(p.text)}</td></tr>`)
      .join("\n"),
    themeCount: String(f.themes.length),
    themeGroups: themeGroups(f.themes),
  };
}

function fill(text, vals) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, name) => {
    if (!(name in vals)) throw new Error(`no value for ${all}`);
    return vals[name];
  });
}

/** The page: the template with its partials, styles and script, and the facts filled in. */
export function render({ root = ".", script = "", preview = false } = {}) {
  const vals = values(facts(root));
  const css =
    `@layer site {\n${STYLES.map((n) => read(`${root}/site/styles/${n}.css`)).join("\n")}}\n` +
    read(`${root}/site/styles/hidden.css`);
  if (/<\/(style|script)/i.test(css + script))
    throw new Error("the styles or the script contain a closing tag");
  let page = read(`${root}/site/index.html`)
    .replace(/<!--include (\w+)-->/g, (_, name) => read(`${root}/site/partials/${name}.html`))
    .replace("<!--style-->", () => `<style>\n${css}</style>`)
    .replace("<!--script-->", () => `<script>\n${script}</script>`);
  page = fill(page, vals);
  if (!preview) return page;
  // the claude.ai preview adds its own document around the page: only the head content and the body
  const head = page.match(/<meta name="viewport"[^>]*>\s*([\s\S]*?)<\/head>/)[1];
  const body = page.match(/<body>([\s\S]*)<\/body>/)[1];
  return `<meta name="claude:viewport-fit-sides" content="cover" />\n${head}${body}`;
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
  const { preview } = parseArgs({ options: { preview: { type: "string" } } }).values;
  if (preview) writeFileSync(preview, render({ script, preview: true }));
  const vals = values(facts());
  for (const name of readdirSync("site/public")) {
    const from = `site/public/${name}`;
    if (/\.(txt|xml)$/.test(name)) writeFileSync(`${OUT}/${name}`, fill(read(from), vals));
    else copyFileSync(from, `${OUT}/${name}`);
  }
  copyFileSync("assets/logo-192.png", `${OUT}/icon-192.png`);
  copyFileSync("assets/dashboard.gif", `${OUT}/dashboard.gif`);
  if (!existsSync("dist/dashboard.html"))
    throw new Error("the demo needs the dashboard template: run pnpm build first");
  // the demo script writes into dist-site/demo/ by default; the page needs only its HTML
  execFileSync("node", ["scripts/demo-dashboard.mjs"], { stdio: "ignore" });
  rmSync(`${OUT}/demo/demo-data.json`);
  console.log(
    `${OUT}/ written: index.html, the public files and demo/${preview ? `; ${preview}` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
