/**
 * How to write a custom widget, for Claude (the editDashboard reply) and for the docs. A custom widget is
 * the body of a function `(el, ctx)`; the page runs it like a built-in widget.
 */
export const WIDGET_API = `A custom widget is the body of a JavaScript function (el, ctx). Draw into el. The page runs it like a built-in widget, inside try/catch: an error shows in its tile only.

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
p.textContent = \`\${ctx.fmt.dist(best.km)} · \${best.name ?? ""} · \${ctx.fmt.day(best.start.slice(0, 10))}\`;
el.append(p);`;
