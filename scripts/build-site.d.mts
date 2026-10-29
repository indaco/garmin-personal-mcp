// Types of scripts/build-site.mjs, for the site test.
export interface Entry {
  name: string;
  text: string;
}
export interface Facts {
  pkg: { name: string; license: string };
  site: { url: string; description: string };
  tools: Entry[];
  prompts: Entry[];
  themes: { id: string; group: string }[];
  questions: string[];
  package: string;
  node: string;
  repository: string;
}
export function facts(root?: string): Facts;
export function themeGroups(themes: { group: string }[]): string;
export function values(f: Facts): Record<string, string>;
export function render(options?: { root?: string; script?: string; preview?: boolean }): string;
