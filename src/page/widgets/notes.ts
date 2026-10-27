import { h } from "../dom";
import { register } from "../registry";

register({
  id: "coachNotes",
  title: (t) => t("w.coachNotes"),
  span: 3,
  render(el, ctx) {
    const notes = (ctx.data.notes ?? []).slice(0, 5);
    if (notes.length === 0) {
      ctx.empty(el, ctx.t("notes.none"));
      return;
    }
    const list = h("ul", { class: "notes" });
    for (const note of notes) {
      // the server escapes each note, so it is safe as HTML
      list.append(Object.assign(h("li"), { innerHTML: note }));
    }
    el.append(
      list,
      h(
        "p",
        { class: "muted small" },
        ctx.t("notes.disclaimer", { date: ctx.fmt.longDay(ctx.data.end) }),
      ),
    );
  },
});
