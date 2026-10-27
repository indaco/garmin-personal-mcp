Make a new widget for my Garmin training dashboard: {{idea}}. Use the tools of the `garmin-personal`
MCP server. Answer in my language.

1. Call `editDashboard` with no arguments. Read `widgetApi` (how a widget works), `catalogue` (the
   built-in widgets) and `customWidgets`. If there is no dashboard, call `writeDashboard` first.
2. If a built-in widget already shows this, name it, add it with `place`, and stop.
3. Write the widget as `widgetApi` says: the body of a function (el, ctx), a short id and a title.
   Use only values from `ctx.data`. Show `ctx.fmt.na` for a missing value. Label an estimate as one.
   **Never invent, interpolate or estimate missing values.**
4. Call `editDashboard` with `widgets` = [the widget] and `place` = [{ board, widget, span }] for the
   board that fits the idea (`all` if no board fits).
5. If the reply has an error, fix the widget and call `editDashboard` again, at most 2 times.

You cannot open the page, so the widget is not tested. A widget that fails shows its error in its own
tile, and the rest of the page works.

Finish with two lines in chat: what the widget shows and on which board, and that I must reload the
page to see it.
