import { de } from "./de";
import type { Catalogue } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { pt } from "./pt";

/**
 * The built-in languages besides English. The page script does not hold them: the server writes the
 * languages that the page's settings choose into its languages block, so the file has no other texts.
 */
export const BUILT_IN: Record<string, Catalogue> = { it, de, fr, es, pt };
