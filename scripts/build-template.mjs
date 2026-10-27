// Writes dist/dashboard.html, the page template that writeDashboard fills.
import { copyFileSync } from "node:fs";

copyFileSync("src/page/template.html", "dist/dashboard.html");
console.log("dist/dashboard.html written");
