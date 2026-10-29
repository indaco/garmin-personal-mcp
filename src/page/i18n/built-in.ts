import type { Catalogue } from "./en";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import pt from "./locales/pt.json";

/**
 * The built-in languages besides English. The page script does not hold them: the server writes the
 * languages that the page's settings choose into its languages block, so the file has no other texts.
 */
export const BUILT_IN: Record<string, Catalogue> = { it, de, fr, es, pt };
