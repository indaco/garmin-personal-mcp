You are a data-minded endurance coach and a front-end designer. Using the Garmin tools of the
`garmin-personal` MCP server, build me a personal **training + recovery dashboard** covering the
last **{{weeks}} weeks** (today is {{today}}).

The point of this dashboard is what social training apps do not show: how training load and
recovery (HRV, sleep, resting heart rate, body battery) move together. Answer in my language.

## 1. Collect the data

Call `getDashboardData` with `weeks` = {{weeks}}. It returns all the data in one call:

- `zones`: my HR zones. `fitnessAge`: Garmin's fitness age.
- `activities`: the activities from {{startDate}} to {{today}}, most recent first, as compact
  summaries. Strength activities have `exercises`: sets, rest, and the primary and secondary
  muscles of each exercise. The 3 most recent activities, every race and every run over 15 km
  have `laps` (km splits, intervals, warm-up and cool-down).
- `previousActivities`: the activities from {{prevStartDate}} to {{prevEndDate}}, with the fields
  for the period comparison.
- `hrv`: one row for each night: `hrv`, `weeklyAvg`, `status`, and the balanced range `low` to
  `high`.
- `recovery`: one row for each of the last 14 days: sleep hours (`sleepH`, and `deep`, `light`,
  `rem`, `awake`), `sleepScore`, sleep need `needH`, bedtime `bedMin` (minutes after midnight),
  `rhr`, body battery `bbHigh` and `bbLow`, `stress`, `steps`, `stepGoal`, `floors`.
- `sync`: what the server fetched. The server keeps a local cache and asks Garmin only for the new
  days. If `failedDays` is more than 0, name the dates in `failedDates` in chat. Their widgets show
  "n/a".

If `getDashboardData` fails, use the separate tools: `getHeartRateZones`, `listActivities` (do not
send `activityType`, because Garmin rejects it), `getHrvRange`, `getSleep` and `getDailySummary`
for each of the last 14 days, `getActivitySets`, `getActivityLaps` and `getFitnessAge`.

Garmin's Personal API has no VO2 max, training status or readiness, race predictor, personal
records, weight or gear data. Do not look for them. Where this prompt tells you, the dashboard
calculates its own versions and labels them as estimates.

If a tool fails, say which one and why in one line, keep going, and show "n/a" in the affected
widget. **Never invent, interpolate or estimate missing values.**

## 2. Compute

Group every activity into one of these types by its `type` key:

| Type | Garmin type keys |
|---|---|
| Run | `running`, `trail_running`, `treadmill_running`, `track_running`, any key ending in `_running` |
| Strength | `strength_training`, any key containing `strength` |
| Walk | `walking`, `casual_walking`, `speed_walking` |
| Hike | `hiking`, `mountaineering` |
| Bike | `cycling`, `road_biking`, `mountain_biking`, `gravel_cycling`, `indoor_cycling`, `virtual_ride`, any key containing `biking` or `cycling` |
| Swim | `lap_swimming`, `open_water_swimming`, any key containing `swimming` |
| Padel | `paddelball`, any key containing `padel` or `paddel` |
| Other | all other keys, shown with a readable name (HIIT, Yoga, Cardio, Rowing, Elliptical, Ski...); in chat, name the keys that are in this group |

Indoor and outdoor: `indoor_cycling`, `virtual_ride`, `treadmill_running` and `indoor_rowing` are
indoor. All other keys are outdoor.

- **Session time**: `duration` is moving time. Strength and Padel have little moving time, so use
  `elapsed` for them when it is present. Run, Walk and Bike use `duration`.
- **Weekly volume** for each type: distance (km), time, number of sessions.
- **The last 7 days compared with the 4-week average before them** for distance, time and
  sessions (difference in %).
- **Training load** of each activity = Garmin's `trainingLoad`. Only when it is missing, use
  moving minutes x avg HR / max HR (from the zones), and label it an *estimate* where you show it.
  Then calculate the acute (7-day) to chronic (28-day) load ratio, and highlight the 0.8-1.3 band.
- **Running**: average pace and average HR for each week, and efficiency (metres per heartbeat =
  speed in m/min / avg HR) to show aerobic progress. Best efforts in the period: the fastest of
  each `best` distance (1k, mile, 5k, 10k, half, marathon), with its date and activity. Races
  (`race: true`). For each week, the share of HR-zone time in Z1-2 (easy) and Z4-5 (hard). Also
  the weekly running form averages (cadence, `strideCm`, `gctMs`, `vertOscCm`, `vertRatioPct`,
  `avgPowerW`, `normPowerW`), only for the metrics that are present. Run Walk Run sessions
  (`runWalk`): the pace of the run segments against the overall pace, and the walk time. Aerobic
  and anaerobic training effect for each run, and label counts for each week.
- **Per type**, for the type tabs: sessions, total and average moving time, average and max HR,
  share of the total load. Add distance and pace for Run and Walk, and distance, average speed
  (km/h) and ascent for Bike. Strength and Padel have no useful distance or pace. Do not show them,
  also when Garmin records a few metres.
- **Strength, per exercise** (group the sets by the `exercise` name across sessions): sessions,
  last date, total sets and reps. For each session: the top set (heaviest weight, with its reps),
  the volume (sum of kg x reps) and the estimated 1RM of the best set. Use Epley: kg x (1 + reps /
  30), only for sets of 1-12 reps, and label it an *estimate*. Exercises with reps but no kg: max
  reps in a set and total reps. Timed exercises (no reps): longest set in seconds. For each
  exercise, the change of the top set and of the estimated 1RM from its first to its last session
  in the period. Weekly completed sets for each movement `category` (Bench Press, Curl, Squat...).
  A set with 0 reps was not completed: list it, but do not use it in any number.
- **Time in HR zones** for each week and each type, from the `hrZonesSec` of each activity. Only
  for an activity without it: put all its minutes in the zone of its average HR, and label it
  *approximate*.
- **Recovery**: nightly HRV vs. its 7-day rolling average, resting HR trend, sleep duration and
  score, body battery high/low. Sleep need against actual sleep for each night
  (`needH`), bedtime regularity (the spread of `bedMin`), sleep
  stages.
- **Period comparison**: these {{weeks}} weeks against the previous {{weeks}}
  (`previousActivities`). Show km, time, load and sessions, in total and for each type, with the
  difference in %.
- **Load safety**: the weekly load ramp (% against the previous week; flag it above +10%). For the
  last 7 days: monotony = mean daily load / standard deviation of daily load (a rest day counts as
  0; flag it above 2.0), and strain = weekly load x monotony (Foster). Label them *estimates*.
- **Readiness today** (the dashboard's own heuristic, not Garmin's): last night's HRV status, sleep
  score, resting HR against its average of the 7 days before today, and the load ratio. The verdict
  is "go easy" if HRV is low, the sleep score is under 60, or resting HR is 5+ bpm above its
  average. It is "ready to push" if HRV is balanced, the sleep score is 80+ and the load ratio is
  under 1.3. Otherwise it is "normal". Show the four inputs next to the verdict.
- **Intensity minutes** for each week = the sum of `moderateMinutes` + 2 x `vigorousMinutes` of
  the activities of that week. Compare it with the guideline of 150 min/week. Say that it counts
  only activities, not all-day minutes.
- **Records in the period**: best efforts, longest run, longest ride, heaviest top set and best
  estimated 1RM for each exercise, each with its date. Show them as badges.
- **Run extras**: a race predictor from the best effort that gives the fastest prediction. Use
  Riegel: T2 = T1 x (D2 / D1)^1.06, only with best efforts of 5 km or longer, and label it an
  *estimate*. The long run share of the km of each week (flag it above 35%). The pace split of
  each race and long run from its laps: first half and second half pace (even, negative or
  positive split). The grade-adjusted pace (`gap`) next to the pace, and the ascent for each week.
- **Strength extras**: the muscle group of each exercise, from the group of its first primary
  muscle. Groups: Chest = Chest; Back = Lats, Traps, Lower Back; Shoulders; Biceps; Triceps;
  Forearms = Forearm; Quads; Hamstrings; Glutes; Calves; Abs = Abs, Obliques; Hips = Hips,
  Abductors, Adductors; Other = no muscle data. For each group, the completed sets per week: a set
  counts 1 for each primary muscle group and 0.5 for each secondary one. Compare the average
  weekly sets of each group with the usual range of 10-20 sets/week. Give the push:pull ratio:
  Chest, Shoulders and Triceps against Back and Biceps. The rest between sets for each exercise
  (median `restSec`). The weight of each set as a % of the best estimated 1RM of that exercise.
- **Walk / Hike**: daily steps against the step goal, and floors climbed (`recovery`, last 14
  days). For hikes, vertical metres per hour (ascent / hours).
- **Swim**: pace per 100 m, SWOLF (`swolf`), lengths, strokes, pool length (`poolLengthM`).
- **Padel and other racket sports**: the share of time in Z4-5, peak HR and calories per hour.
  Also the load compared with the average run of the same length.

## 3. Build the dashboard

Pick the output that fits where you are running:

- **Claude desktop / claude.ai** (artifacts available): one self-contained React artifact, with
  Recharts for the charts.
- **Claude Code** or any client without artifacts: write a single self-contained file
  `garmin-dashboard.html` in the current directory (Chart.js from cdnjs, everything else inline),
  then tell me its path and the command to open it (`xdg-open` / `open`).

Either way, no runtime calls to Garmin: embed the processed data as a constant at the top of the
file. Use the `getDashboardData` result as this data, without changes, and add two fields:
`"v": {{dashboardVersion}}` (the version of these instructions) and `notes` (the coach notes, a list
of HTML strings). Escape every activity or exercise name inside a note, because Garmin names can
contain markup. The page groups and calculates everything else in
the browser. Then an update can replace the data with a new `getDashboardData` result and keep the
page code. Put the data between the comments `/* garmin-data:start */` and `/* garmin-data:end */`,
for example `const DATA = /* garmin-data:start */{...}/* garmin-data:end */;`, and write `<\/` for
every `</` inside it. Keep the markers: the `training-dashboard-update` prompt replaces only this
block.

### Time window

Under the header, put a window bar. It selects whole Monday-Sunday weeks inside the embedded period:
presets (last 4, 8, 12... weeks, and all) and a from-week and a to-week selector. Every widget about
training follows the window, and the browser calculates it again from the embedded data. This
includes totals, charts, calendar, records, strength exercise stats, and the period comparison. The
period comparison compares the window with the same number of weeks just before it (from
`activities` and `previousActivities`). Say "partial" when these weeks start before the data. The
tiles "last 7 days against the 4-week average" end on the last day of the window, and take their
baseline from all embedded data. The widgets about today do not follow the window, and say so:
readiness, fitness age and the 14-day recovery panel. The URL hash also keeps the window (for
example `#run@2026-09-07_2026-10-26`). The last week can still be in progress, when today is not a
Sunday. Mark it (for example with *), and do not flag its load ramp.

### Tabs and filter

Each type has an icon and a colour (inline SVG, no icon font). Show the icon on its tab, its
filter chip and in the type column of the tables. The icons are decorative (`aria-hidden`), and
the text label stays.

Put a tab bar under the header: **All**, **Run**, **Strength**, **Walk**, **Bike**, **Padel**, and
**Hike**, **Swim** and **Other** only if the embedded data has activities of that type, so tabs do
not come and go with the week window. Each tab label shows its session count. A type with no
activities in the selected weeks stays visible and shows an empty state ("no sessions in the
selected weeks"), not empty charts. The URL hash keeps the selected tab, so
a reload or a shared link opens the same tab.

On the **All** tab, put a row of chips: an "All" chip, then one chip for each type in the colour of
that type. All types show by default. A click on a type chip shows only that type. A second click on
the same chip, or a click on "All", shows all types again. The chips filter the header totals,
weekly volume, consistency calendar, the load bars of load vs. recovery, and the activities table.
Recovery data (HRV, sleep, resting HR, body battery) is not per type, and the filter never changes
it. The **load ratio always uses all activities**: say this next to the tile when a filter is
active.

### All tab, top to bottom

1. **Header**: period covered, total km / hours / sessions, and 4 KPI tiles with deltas
   (distance, time, load ratio, last-night HRV vs. baseline).
2. **Readiness today**: the verdict and its four inputs. Next to it, the **fitness age** card
   (fitness age against actual age, achievable fitness age, and the components with Garmin's
   targets).
3. **Period comparison**: these weeks against the weeks before, for each type and in total.
4. **Records**: the badges from the Compute section.
5. **Weekly volume**: stacked bars for each type, with a line for the 4-week moving average.
6. **Load safety**: the weekly load with its ramp % (highlight the flagged weeks), monotony and
   strain.
7. **Intensity minutes** for each week, against a line at 150 min.
8. **Consistency calendar**: a GitHub-style heatmap of daily training minutes. When the user
   points to a day (or touches it on a phone), show a tooltip at once. The tooltip shows the date,
   total minutes, and each activity with its name, distance and time. Use your own tooltip, not
   the `title` attribute: it is slow, some viewers do not show it, and it never shows on touch.
9. **Load vs. recovery**: one chart with daily load (bars, stacked by type) and HRV (line) on
   twin axes - the heart of the dashboard.
10. **Recovery panel**: HRV with baseline band, resting HR, sleep hours by stage and score, sleep
    need against actual sleep, bedtime regularity, body battery (last 14 days).
11. **Recent activities**: table with date, type, name, distance, time, pace, avg HR, ascent;
    the 3 most recent expandable to show laps.
12. **Coach notes**: at most 5 bullet points, each tied to a specific number in the dashboard
   (e.g. "HRV 12% below baseline for 3 nights while load ratio is 1.4"). Training suggestions
   only, no medical advice. Keep them in `notes` in the data block, not in the page code.

### Type tabs

Each type tab shows only that type's data:

1. **KPI tiles**: the numbers for each type from the Compute section, the last 7 days compared with
   the 4-week average, and Garmin training load.
2. **Weekly chart**: sessions and time for each week (bars). Add distance for Run, Walk and Bike.
3. **Time in HR zones** for each week, stacked Z1-Z5.
4. The sections of that type, below.
5. **Activities**: the table for that type only, with laps where you got them.

If a type has only one session, show a session card (its numbers and zones) and no trend
charts ("one session so far"). Trends start at 2 sessions.

**Run** adds:

1. **Best efforts**: the fastest 1k, mile, 5k, 10k, half (and marathon) in the period, with date
   and activity name.
2. **Races**: one row for each race, side by side: date, name, time, pace, avg HR, avg power,
   aerobic training effect.
3. **Aerobic fitness**: a scatter of pace against avg HR, one dot for each run, coloured from
   oldest to newest. Also pace and efficiency for each week.
4. **Intensity**: the easy (Z1-2) and hard (Z4-5) share of running time for each week.
5. **Running form**: weekly cadence, stride, ground contact time, vertical oscillation and ratio,
   power. Use small multiples, one for each metric that is present, each with its unit.
6. **Run Walk Run**: for each session with `runWalk`, the pace of the run segments against the
   overall pace, and the walk time.
7. **Training effect**: aerobic and anaerobic TE for each run (dots over time), and label counts
   for each week.
8. **Race predictor**: the predicted 5k, 10k, half and marathon times, with the best effort that
   the prediction uses.
9. **Long runs and pace split**: the long run share for each week (flag it above 35%), and the
   split type of each race and long run. Also grade-adjusted pace against pace, and ascent for
   each week.

**Walk** adds pace and avg HR for each week, and steps, cadence and body battery change for each
walk. It also adds daily steps against the goal, with floors (last 14 days). **Hike** adds
vertical metres per hour. **Bike** adds average speed and ascent for each week, the ascent for
each ride and the indoor/outdoor split. **Swim** adds pace per 100 m, SWOLF, lengths and strokes
for each session. **Padel** adds avg HR and time in Z3+ for each session, Z4-5 share and peak HR.
It also adds calories per hour, training effect, and its load against a run of the same length.

The **Strength** tab adds, after the weekly chart: a weekly chart of completed sets for each
movement category, and the **muscle-group balance**. The balance shows one bar for each muscle
group: its average completed sets per week in the selected weeks, against the 10-20 band. It also
gives the push:pull ratio. Then:

1. **Exercises**: a table with one row for each exercise, grouped by muscle group. Each group has
   a header row with its number of exercises and completed sets. Show the name, sessions, last
   date and last top set (for example "70 kg x 6"). Also show the best estimated 1RM, the change
   since the first session (arrow and %) and a sparkline of the top set. The user can sort by
   every column inside each group, filter by group with chips, and use a search box.
2. **Exercise detail**: when the user selects a row (click or Enter), a panel opens with
   - a trend chart over time for each session: top-set weight and estimated 1RM (lines, kg) and
     volume (bars, kg). Use reps instead of kg for exercises without weight, and seconds for timed
     ones;
   - every session of that exercise, newest first: date, workout name and its sets
     (for example "35 x 12, 50 x 10, 60 x 8, 70 x 6"). For each set, show its % of the best
     estimated 1RM and the rest after it. The panel header shows the median rest of the exercise.
   The URL hash also keeps the selected exercise (for example `#strength/barbell-box-squat`).
3. **Sessions**: each Strength activity opens to show all its exercises and sets, in the order
   the user did them. Each exercise shows its muscle group.

If an exercise has only one session, show its sets but no trend chart ("one session so far").

Themes: put a "Theme" dropdown in the header, with the themes in groups:

- Auto: System, which uses Midnight on a dark OS and Light on a light OS.
- Dark: Midnight, Graphite, Ocean, Forest, Plum.
- Light: Light, Paper, Mist.
- Accessible: High contrast dark, High contrast light.

On first load the theme is Midnight, also on a light OS. System is a choice in the menu, not the
default. Midnight uses these colours: background `#0e1217`, panels `#161c24` and `#1c232d`, lines
`#26303d`, text `#e6ebf2`, muted text `#8d99aa`, accent `#7cc4ff`, good `#3ecf8e`, bad `#ef5a5a`,
warning `#f2c94c`. Design the other themes yourself. Define every colour as a CSS token, with one
set of tokens for each theme. Dark themes use these bright type colours: Run `#ff7a45`, Strength
`#a78bfa`, Walk `#34d399`, Hike `#a3e635`, Bike `#60a5fa`, Swim `#22d3ee`, Padel `#fbbf24`, Other
`#94a3b8`. Light themes use darker variants of the same hues for contrast. Charts read the tokens
and draw again when the theme changes. Keep the choice in `localStorage`, wrapped in try/catch, so
the page still works when storage is blocked. Apply it before the first paint.

Selection: a click on a filter selects what it shows, and never hides it. A click on a chart legend
item shows only that series. A second click on the same item shows all series again. The type chips
and the muscle-group chips work in the same way. This rule is for filters, chips and legends only:
rows and details that open, such as laps or an exercise, close again on a second click.

Colours of a change: show a better value in green, a worse value in red, and no change in grey.
This applies to every change and delta, for example the change of an exercise or a KPI delta.
Higher is better for volume (distance, time, sessions, load), HRV, sleep score, intensity minutes,
efficiency, top set, estimated 1RM and sets. Higher is worse for resting HR, the load ramp,
monotony and strain. A faster pace is better, so a slower second half of a split is red.

Design: clean, data-dense but airy. On a phone, put two KPI tiles in each row. Make the page title a
large h1 (about 32 px), clearly larger than the section headings. Use one fixed colour for each
type, on its tab, chip, bars and lines in every chart. Use tabular numbers. Make the page work down
to phone width (the tab bar scrolls horizontally, the page does not). Make the tabs work with the
keyboard. Put tooltips on every chart and units on every axis. Use your own visual identity: no
third-party app names, logos or brand colours.

Finish with two lines in chat: what is in the dashboard, and anything that was missing.
