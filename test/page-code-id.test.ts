import { describe, expect, it } from "vitest";
import { pageCodeId, withPageCodeId } from "../scripts/page-code-id.mjs";

const TAG = '<meta name="garmin-template" content="page-code-id" />';
const page = (script = "a();", css = "p{}", body = "<p>x</p>") =>
  `<head>${TAG}<style>${css}</style></head><body>${body}<script>${script}</script></body>`;

describe("pageCodeId", () => {
  it("gives the same 16 lowercase hex characters for the same input", () => {
    expect(pageCodeId("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(pageCodeId("abc")).toBe(pageCodeId("abc"));
    // SHA-256("abc") starts with ba7816bf8f01cfea
    expect(pageCodeId("abc")).toBe("ba7816bf8f01cfea");
  });

  it("changes with one character in the script, the CSS or the HTML", () => {
    const ids = [
      page(),
      page("b();"),
      page(undefined, "q{}"),
      page(undefined, undefined, "<p>y</p>"),
    ].map(pageCodeId);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("withPageCodeId", () => {
  it("puts the id of the input, with its placeholder, into the tag", () => {
    const input = page();
    const out = withPageCodeId(input);
    expect(out).toContain(`content="${pageCodeId(input)}"`);
    expect(out).not.toContain("page-code-id");
    expect(out).toBe(input.replace("page-code-id", pageCodeId(input)));
  });

  it("gives the same output for the same input", () => {
    expect(withPageCodeId(page())).toBe(withPageCodeId(page()));
  });

  it("throws when the placeholder is missing", () => {
    expect(() => withPageCodeId("<head></head>")).toThrow(/placeholder/);
    expect(() => withPageCodeId('<meta name="garmin-template" content="15" />')).toThrow(
      /placeholder/,
    );
  });

  it("throws when the placeholder occurs twice", () => {
    expect(() => withPageCodeId(`${TAG}${TAG}`)).toThrow(/placeholder/);
  });
});
