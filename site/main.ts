// The site script: tsdown bundles it, and scripts/build-site.mjs puts it into the page.
import { ask } from "./scripts/ask";
import { copy } from "./scripts/copy";
import { flood } from "./scripts/flood";
import { menu } from "./scripts/menu";
import { mode } from "./scripts/mode";
import { panes } from "./scripts/panes";

menu();
mode();
flood();
ask();
panes();
copy();
