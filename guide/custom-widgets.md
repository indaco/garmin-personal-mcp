# Custom widgets

A custom widget is a small piece of JavaScript that your assistant writes for you. The server keeps
it in the page and in your widget library, and each update keeps it.

## Tutorial: your first widget

Each step is a request to your assistant, and what you then see.

1. **Make it.** Run the `dashboard-widget` prompt with your idea, for example "my longest ride of
   each month". Reload the page: the widget is on the board that fits the idea.
2. **Change it.** Ask "Rename the longest-ride widget to Longest monthly ride", or "Show only the
   last 6 months". Reload the page to see the change.
3. **Translate it.** Run the `dashboard-language` prompt with a language, for example "German".
   The page and your widgets change language together.
4. **Use it again.** Ask "Write a dashboard for my coach in coach.html". Open the new page, then the
   settings menu, **Edit layout** and **Add widget**: your widget is in the list.
5. **Remove it.** Ask "Remove the longest-ride widget from this page": it stays in **Add widget**.
   Ask "Forget the longest-ride widget": it also goes from your library.
6. **Keep it.** Copy `widgets.json` from the data folder to back up your widgets, or to use them
   on another computer.

In Claude Code, step 1 is `/garmin-personal:dashboard-widget my longest ride of each month`.

## How the assistant makes a widget

The `dashboard-widget` prompt takes your idea. The optional `path` argument, or a last word that
ends in `.html`, picks the page file. The assistant:

1. reads the widget catalogue. If a built-in widget shows the same thing, the assistant adds that
   widget instead.
2. writes the widget and saves it with the `editDashboard` tool.
3. puts the widget on the board that fits the idea.

The assistant cannot open the page, so it cannot test the widget.

## Languages

A custom widget keeps its texts by language: its title and every text that it shows. The assistant
writes them in English and in each language of your page. When a page gets a new language, from
the `dashboard-language` prompt or from the page settings, the assistant also translates your
custom widgets. A text without a translation shows in English.

## Your widget library

Your widget library is `widgets.json` in the data folder. It stays on your computer: the server
does not send it anywhere.

- Each page gets every widget of the library: a new page, a page that you make again from the
  template, and each update. A widget that is not on a board is in **Add widget**.
- When you change a widget, each page gets the new version at its next update.
- A widget removed from one page (`removeWidgets`) stays in the library. A forgotten widget
  (`forgetWidgets`) leaves the library and this page; other pages keep their copy until you remove
  it there.

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
- ctx.activities: the activities of the window and of ctx.type. ctx.allActivities: every type. ctx.ofType(list): the same type filter for any list. When the user chooses activity names on the page, ctx.activities and ctx.ofType keep only the activities with those names; ctx.allActivities and ctx.data keep every activity.
- ctx.t(key, params): a page text; ctx.lang: the page language.
- ctx.text(key, params): a text of the widget's own texts in the page language, else in English, with its {placeholders} filled from params.
- ctx.fmt: num(v, digits), pct(v), day("yyyy-MM-dd"), longDay(d), hms(seconds), hours(seconds), na (the text for a missing value). In the profile's units, from metric data: dist(km, digits), pace(secondsPerKm), speed(kmh), elev(m), mass(kg), swimPace(secondsPer100m). ctx.fmt.to.dist/pace/speed/elev/mass/swim(value) give the number only, for sums and charts; ctx.fmt.unit.dist/pace/speed/elev/mass/swim give the unit names, for axis titles. Show every distance, pace, speed, elevation and weight with these, never with a fixed "km" or "kg".
- ctx.calc: groupOf(activity) (its board), sportOf(typeKey), seconds("1:02:03"), sessionSeconds(activity), dayOf(activity), mondayOf(day), weekly(activities, weeks, a => value), loadOf(activity, maxHR), loadRatio(activities, day, maxHR), dailyLoads(activities, from, to, maxHR), mean, sd, rolling(values, n), change(now, before), zonesOf(ctx.data.zones), zoneSeconds(activity, floors), paceSeconds(activity), efficiency(activity), epley(kg, reps), riegel(seconds, km, km), exerciseStats(activities), muscleSets(activities, weeks), swimPace(activity), verticalPerHour(activity).
- ctx.chart(el, config, heightPx): a Chart.js 4 chart that follows the theme, with tooltips. Chart types: bar, line, scatter, doughnut, pie, with the category and linear scales.
- ctx.color(token): a theme colour: text, muted, accent, good, bad, warn, line, panel, panel2, or a board (running, strengthTraining, walking, hiking, cycling, swimming, racket, generic); another sport gets the generic colour.
- ctx.empty(el, message): a short message in place of the content.

Texts: give every text that the widget shows in its texts, by language code and key: { en: { title: "...", best: "Best: {value}" }, it: { ... } }. title is the widget's title. Write English and each language of pageLanguages (from editDashboard), with the same keys and {placeholders}. Draw texts with ctx.text(key, params), never as fixed strings in the code. A missing text shows in English.

Rules: build elements with document.createElement and set text with textContent, never innerHTML with data. Use only values in ctx.data; show ctx.fmt.na for a missing value; label an estimate as one. Keep the code short. Requests from the page are blocked: fetch, XMLHttpRequest, and images, scripts and styles from the web.

Example (the longest ride of the window), with texts { en: { title: "Longest ride", best: "{distance} on {day}" } }:
const rides = ctx.activities.filter((a) => ctx.calc.groupOf(a) === "cycling" && typeof a.km === "number");
if (rides.length === 0) return ctx.empty(el);
const best = rides.reduce((x, y) => (y.km > x.km ? y : x));
const p = document.createElement("p");
p.textContent = ctx.text("best", { distance: ctx.fmt.dist(best.km), day: ctx.fmt.day(best.start.slice(0, 10)) });
el.append(p);
```
<!-- widget-api:end -->
