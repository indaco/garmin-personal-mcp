// The page code id: a hash of the built page, so a saved page can tell whether the server that writes it
// has other page code. The build writes it into the meta tag of dist/dashboard.html.
import { createHash } from "node:crypto";

const PLACEHOLDER = '<meta name="garmin-template" content="page-code-id" />';

export const pageCodeId = (html) => createHash("sha256").update(html).digest("hex").slice(0, 16);

export function withPageCodeId(html) {
  if (html.split(PLACEHOLDER).length !== 2) {
    throw new Error(`the page template needs exactly one placeholder: ${PLACEHOLDER}`);
  }
  // the id covers the page with its placeholder, so the tag does not hash itself
  return html.replace(PLACEHOLDER, () => PLACEHOLDER.replace("page-code-id", pageCodeId(html)));
}
