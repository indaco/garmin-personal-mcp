// Writes dist/dashboard.html, the page template that writeDashboard fills: the HTML shell with the styles
// and the page script inline, so the page works offline from a single file.
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const dir = "dist/page";
const script = readFileSync(`${dir}/${readdirSync(dir).find((f) => f.endsWith(".js"))}`, "utf8");
// no comments, and no whitespace that the browser does not need
const css = readFileSync("src/page/styles.css", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{};,>])\s*/g, "$1")
  .trim();
if (/<\/script/i.test(script) || /<\/style/i.test(css)) {
  throw new Error("the page script or styles contain a closing tag: they cannot be inlined");
}
const page = readFileSync("src/page/template.html", "utf8")
  .replace("<!--style-->", () => `<style>${css}</style>`)
  .replace("<!--script-->", () => `<script>\n${script}</script>`);
writeFileSync("dist/dashboard.html", page);
// the page script lives only inside the template; the module list is for the notices, which remove it
copyFileSync(`${dir}/modules.json`, "dist/page-modules.json");
rmSync(dir, { recursive: true });
console.log(`dist/dashboard.html written (${Math.round(page.length / 1024)} KB)`);
