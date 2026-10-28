import { append, h } from "../dom";
import { register } from "../registry";

register({
  id: "coachNotes",
  render(el, ctx) {
    const notes = (ctx.data.notes ?? []).slice(0, 5);
    if (notes.length === 0) {
      ctx.empty(el, ctx.t("notes.none"));
      return;
    }
    const list = h("ul", { class: "notes" });
    for (const note of notes) {
      list.append(h("li", {}, note));
    }
    append(
      el,
      list,
      h(
        "p",
        { class: "muted small" },
        ctx.t("notes.disclaimer", { date: ctx.fmt.longDay(ctx.data.end) }),
      ),
    );
  },
});
