// The site script: tsdown bundles it, and scripts/build-site.mjs puts it into the page.
import { ask } from "./scripts/ask";
import { clients } from "./scripts/clients";
import { copy } from "./scripts/copy";
import { flood } from "./scripts/flood";
import { menu } from "./scripts/menu";
import { mode } from "./scripts/mode";

menu();
mode();
flood();
ask();
clients();
copy();
