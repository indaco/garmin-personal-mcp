import { describe, expect, it } from "vitest";
import { CATALOGUE } from "../../src/page/catalogue";
import { en } from "../../src/page/i18n/en";
import { preset } from "../../src/page/presets";
import { allWidgets } from "../../src/page/registry";
import "../../src/page/widgets";

describe("widget catalogue", () => {
  it("has exactly the registered widgets", () => {
    expect(
      allWidgets()
        .map((w) => w.id)
        .toSorted(),
    ).toEqual(CATALOGUE.map((c) => c.id).toSorted());
  });

  it("has a title in the English catalogue and a description for each widget", () => {
    for (const c of CATALOGUE) {
      expect([c.id, c.title in en, c.about.length > 20]).toEqual([c.id, true, true]);
    }
  });

  it("has every widget of the presets", () => {
    const boards = ["all", "run", "strength", "walk", "hike", "bike", "swim", "racket", "other"];
    const ids = new Set(CATALOGUE.map((c) => c.id));
    for (const board of boards) {
      for (const inst of preset(board))
        expect([board, ids.has(inst.widget)]).toEqual([board, true]);
    }
  });
});
