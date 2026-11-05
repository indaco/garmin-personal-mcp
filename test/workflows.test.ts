import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The text of the release gate. A workflow cannot run in a test, but a release must not publish
 * before the checks of every system pass, and the os job of the release must stay a copy of the
 * one in ci.yml.
 */

const read = (name: string) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8").split(/\r?\n/);

/** The lines of a job: from `  <name>:` up to the next job or the comment above it. */
function job(lines: string[], name: string): string[] {
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `job ${name}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && /^ {2}(#|\w[\w-]*:)/.test(l));
  return lines.slice(start, end === -1 ? undefined : end);
}

const steps = (j: string[]) => j.filter((l) => /^\s+(- name:|- uses:|run:|if:|shell:)/.test(l));

const release = read("release.yml");
const ci = read("ci.yml");
const releaseOs = job(release, "os");
const ciOs = job(ci, "os");

describe("release workflow", () => {
  it("publishes only after the build, the check and the os jobs", () => {
    expect(job(release, "publish")).toContain("    needs: [build, check, os]");
  });

  it("runs the same steps in the os job as ci.yml", () => {
    expect(steps(ciOs).length).toBeGreaterThan(5);
    expect(steps(releaseOs)).toEqual(steps(ciOs));
  });

  it("runs the os job on the same systems and Node versions as ci.yml", () => {
    const os = "        os: [ubuntu-latest, macos-latest, windows-latest]";
    expect(ciOs).toContain(os);
    expect(releaseOs).toContain(os);
    const node = ciOs.find((l) => /^\s+node: \[/.test(l));
    expect(node).toBeDefined();
    expect(releaseOs).toContain(node);
  });

  it("gives the os job no cache, read-only access, no OIDC and no environment", () => {
    const text = releaseOs.join("\n");
    expect(releaseOs).toContain("          package-manager-cache: false");
    expect(text).not.toContain("cache: pnpm");
    expect(releaseOs).toContain("      contents: read");
    expect(text).not.toContain("id-token");
    expect(text).not.toContain("environment:");
  });

  it("publishes only the tarball that the build job packed", () => {
    expect(job(release, "build")).toContain("      sha256: ${{ steps.pack.outputs.sha256 }}");
    const publish = job(release, "publish");
    expect(publish).toContain("          SHA256: ${{ needs.build.outputs.sha256 }}");
    const check = publish.findIndex((l) => l.includes("sha256sum -c -"));
    const npmPublish = publish.findIndex((l) => l.includes('npm publish "'));
    expect(check).toBeGreaterThan(-1);
    expect(npmPublish).toBeGreaterThan(check);
  });

  it("pins an exact version of node-pty in both workflows", () => {
    for (const os of [ciOs, releaseOs]) {
      const runs = os.filter((l) => /^\s+run:/.test(l) && /node-pty@\d+\.\d+\.\d+( |$)/.test(l));
      expect(runs).toHaveLength(1);
      expect(os.some((l) => l.includes("node-pty@latest"))).toBe(false);
    }
  });

  it("marks a release as Latest only when it creates it", () => {
    const latest = release.filter((l) => l.includes("--latest"));
    expect(latest).toHaveLength(1);
    expect(latest[0]).toContain("gh release create");
  });
});
