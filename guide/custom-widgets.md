# Custom widgets

A custom widget is a small piece of JavaScript that your assistant writes for you. The server keeps
it in the page, and each update keeps it.

## Make a widget

Run the `dashboard-widget` prompt with your idea, for example "my longest ride of each month".
The optional `path` argument, or a last word that ends in `.html`, picks the page file.
The assistant:

1. reads the widget catalogue. If a built-in widget shows the same thing, the assistant adds that
   widget instead.
2. writes the widget and saves it with the `editDashboard` tool.
3. puts the widget on the board that fits the idea.

Reload the page to see the widget. The assistant cannot open the page, so it cannot test the widget.

You can also ask your assistant to change or remove a custom widget. The widget catalogue of the
page (the settings menu, **Edit layout**, then **Add widget**) lists the custom widgets too.

## Your widget library

The server also keeps each custom widget in `widgets.json` in the data folder. This file is your
widget library. It stays on your computer: the server does not send it anywhere.

- **A new page gets your widgets.** A page in another file (for example `coach.html`) and a page
  that you make again from the template get every widget of the library. The widgets are in
  **Add widget**; put them on a board there, or ask your assistant to.
- **A changed widget goes to every page.** When you change a widget, each page gets the new version
  at its next update.
- **Remove from one page or from all.** Ask your assistant to remove a widget from the page
  (`removeWidgets`): the widget stays in the library and in **Add widget**. Ask it to forget the
  widget (`forgetWidgets`): the server also removes it from the library. Other pages keep their copy
  until you remove it there.
- **Back up or move.** Copy `widgets.json` to keep your widgets, or to use them on another
  computer.

Widgets that you made before the library existed join it at the first update. When a page has a
widget that is not in the library, the page keeps it.

## When a widget fails

The page runs each widget in its own tile. When a widget fails, its tile shows the error, and the
other widgets work. A widget with a syntax error shows the error the same way.

## Safety

A custom widget runs in your page, as the built-in widgets do. It can read the data of the page and
draw in its tile. The assistant writes it only when you ask, and the server stores it only in your
page. Read the code in the page file if you want to see it.

## The widget API

The assistant gets this text from `editDashboard`. It is the same text that the server sends.

<!-- widget-api:start -->
```text
A custom widget is the body of a JavaScript function (el, ctx). Draw into el. The page runs it like a built-in widget, inside try/catch: an error shows in its tile only.

ctx gives:
- ctx.data: the getDashboardData result (activities, previousActivities, hrv, recovery, zones, fitnessAge, sync, units) and notes (plain text). The data is always metric (km, m, kg, seconds per km); units is the measurement system of the Garmin profile (metric, statute_us or statute_uk).
- ctx.type: "all" or the board the widget shows: running, strengthTraining, walking, hiking, cycling, swimming, racket, generic (Other), or another SDK sport name such as alpineSkiing. Each activity has type (the Garmin type key) and sport (the SDK sport name).
- ctx.from, ctx.to: Mondays of the first and last week of the window; ctx.weeks: every Monday in it.
- ctx.activities: the activities of the window and of ctx.type. ctx.allActivities: every type. ctx.ofType(list): the same type filter for any list.
- ctx.t(key, params): a page text; ctx.lang: the page language.
- ctx.fmt: num(v, digits), pct(v), day("yyyy-MM-dd"), longDay(d), hms(seconds), hours(seconds), na (the text for a missing value). In the profile's units, from metric data: dist(km, digits), pace(secondsPerKm), speed(kmh), elev(m), mass(kg), swimPace(secondsPer100m). ctx.fmt.to.dist/pace/speed/elev/mass/swim(value) give the number only, for sums and charts; ctx.fmt.unit.dist/pace/speed/elev/mass/swim give the unit names, for axis titles. Show every distance, pace, speed, elevation and weight with these, never with a fixed "km" or "kg".
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
p.textContent = `${ctx.fmt.dist(best.km)} · ${best.name ?? ""} · ${ctx.fmt.day(best.start.slice(0, 10))}`;
el.append(p);
```
<!-- widget-api:end -->
