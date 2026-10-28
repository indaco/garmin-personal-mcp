# Custom widgets

A custom widget is a small piece of JavaScript that Claude writes for you. The server keeps it in
the page, and each update keeps it.

## Make a widget

Run the `dashboard-widget` prompt with your idea, for example "my longest ride of each month".
Claude:

1. reads the widget catalogue. If a built-in widget shows the same thing, Claude adds that widget
   instead.
2. writes the widget and saves it with the `editDashboard` tool.
3. puts the widget on the board that fits the idea.

Reload the page to see the widget. Claude cannot open the page, so Claude cannot test the widget.

You can also ask Claude to change or remove a custom widget. The widget catalogue of the page
(the settings menu, **Edit layout**, then **Add widget**) lists the custom widgets too.

## When a widget fails

The page runs each widget in its own tile. When a widget fails, its tile shows the error, and the
other widgets work. A widget with a syntax error shows the error the same way.

## Safety

A custom widget runs in your page, as the built-in widgets do. It can read the data of the page and
draw in its tile. Claude writes it only when you ask, and the server stores it only in your page.
Read the code in the page file if you want to see it.

## The widget API

Claude gets this text from `editDashboard`. It is the same text that the server sends.

<!-- widget-api:start -->
```text
A custom widget is the body of a JavaScript function (el, ctx). Draw into el. The page runs it like a built-in widget, inside try/catch: an error shows in its tile only.

ctx gives:
- ctx.data: the getDashboardData result (activities, previousActivities, hrv, recovery, zones, fitnessAge, sync) and notes (plain text).
- ctx.type: "all" or the board the widget shows: running, strengthTraining, walking, hiking, cycling, swimming, racket, generic (Other), or another SDK sport name such as alpineSkiing. Each activity has type (the Garmin type key) and sport (the SDK sport name).
- ctx.from, ctx.to: Mondays of the first and last week of the window; ctx.weeks: every Monday in it.
- ctx.activities: the activities of the window and of ctx.type. ctx.allActivities: every type. ctx.ofType(list): the same type filter for any list.
- ctx.t(key, params): a page text; ctx.lang: the page language.
- ctx.fmt: num(v, digits), pct(v), day("yyyy-MM-dd"), longDay(d), hms(seconds), hours(seconds), na (the text for a missing value).
- ctx.calc: groupOf(activity) (its board), sportOf(typeKey), seconds("1:02:03"), sessionSeconds(activity), dayOf(activity), mondayOf(day), weekly(activities, weeks, a => value), loadOf(activity, maxHR), loadRatio(activities, day, maxHR), dailyLoads(activities, from, to, maxHR), mean, sd, rolling(values, n), change(now, before), zonesOf(ctx.data.zones), zoneSeconds(activity, floors), paceSeconds(activity), efficiency(activity), epley(kg, reps), riegel(seconds, km, km), exerciseStats(activities), muscleSets(activities, weeks), swimPace(activity), verticalPerHour(activity).
- ctx.chart(el, config, heightPx): a Chart.js 4 chart that follows the theme, with tooltips. Chart types: bar, line, scatter, doughnut, pie, with the category and linear scales.
- ctx.color(token): a theme colour: text, muted, accent, good, bad, warn, line, panel, panel2, or a board (running, strengthTraining, walking, hiking, cycling, swimming, racket, generic); another sport gets the generic colour.
- ctx.empty(el, message): a short message in place of the content.

Rules: build elements with document.createElement and set text with textContent, never innerHTML with data. Use only values in ctx.data; show ctx.fmt.na for a missing value; label an estimate as one. Keep the code short. Requests from the page are blocked: fetch, XMLHttpRequest, and images, scripts and styles from the web.

Example (the longest ride of the window):
const rides = ctx.activities.filter((a) => ctx.calc.groupOf(a) === "cycling" && typeof a.km === "number");
if (rides.length === 0) return ctx.empty(el);
const best = rides.reduce((x, y) => (y.km > x.km ? y : x));
const p = document.createElement("p");
p.textContent = `${ctx.fmt.num(best.km, 1)} km · ${best.name ?? ""} · ${ctx.fmt.day(best.start.slice(0, 10))}`;
el.append(p);
```
<!-- widget-api:end -->
