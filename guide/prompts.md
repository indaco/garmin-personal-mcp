# Prompts

The prompts of the server and their arguments. The [README](../README.md#dashboard) lists them and
tells how to run a prompt in your client. For the details of the dashboard page, see
[The training dashboard](dashboard.md).

- [Dashboard prompts](#dashboard-prompts) make and change a dashboard page.
- [Coach prompts](#coach-prompts) answer in the chat.
- [year-review](year-review.md#year-review-prompt) is with the tool that it calls, in
  [Year review](year-review.md).

A missing value shows as "n/a": the assistant does not estimate it.

The prompts remove all spaces around an argument, also the no-break space from a phone keyboard.

## Dashboard prompts

### training-dashboard

The server writes the dashboard page from its template, and the assistant writes the coach notes.
The page is one HTML file, `garmin-dashboard.html` in the data folder. A page from the template
works offline. A freeform page loads Chart.js from the web.

| Argument | Values                            | Default  |
| -------- | --------------------------------- | -------- |
| `weeks`  | 1 to 52 (a larger value gives 52) | 12       |
| `layout` | `preset`, `blank` or `freeform`   | `preset` |

- `preset` gives the built-in widgets on each board.
- `blank` gives empty boards: you add the widgets that you want.
- `freeform` lets the assistant design the whole page. This takes much longer, and each page looks
  different.

In Claude Code, the arguments are in order and separated by spaces: first `weeks`, then `layout`.
You can also give only the layout: `/mcp__garmin-personal__training-dashboard freeform`.

The assistant gives you the path of the page and the command to open it. The page has a board for
all your training, a Recovery board and a board for each sport. A missing value shows as "n/a".

When your runs repeat a name, for example the "Tempo Run" of a training plan, the assistant asks
whether to compare those workouts across weeks. The default is no. A yes adds the Workout trend
widget. The server downloads the laps of the last 8 runs of each workout once and keeps them, so
the comparison grows with each update. See
[Page settings](dashboard.md#page-settings).

The assistant also asks whether to add the Recovery trend. The default is no. A yes adds a widget
with the weekly average of sleep, sleep score and resting HR for the whole period, and the file then
holds these values for each day. See [Page settings](dashboard.md#page-settings).

The assistant also asks whether to add a Year tab. The default is no. A yes adds a board with the
recap of the calendar year, and the file then holds data of days before the period of the page. See
[Page settings](dashboard.md#page-settings).

[The dashboard guide](dashboard.md) tells about the title and the headline, the boards, the
themes and languages, the units and the activity-name filter, and how to change the layout.
[The widget catalogue](widgets.md) lists every widget.

### training-dashboard-update

This prompt replaces the data and the coach notes of the page. Your layout, your custom widgets and
your languages stay. Only a new preset widget of a release can join a board that you edited, one
time. Reload the page to see the new data.

When the page has no answer about the Year tab, the assistant asks one time whether to add it. The
default is no. See [Page settings](dashboard.md#page-settings).

| Argument | Values                                                                  | Default                 |
| -------- | ----------------------------------------------------------------------- | ----------------------- |
| `weeks`  | the weeks to cover                                                      | the weeks of the page   |
| `path`   | the dashboard file, for example `garmin-dashboard-coach.html` (`.html`) | `garmin-dashboard.html` |

In Claude Code: `/mcp__garmin-personal__training-dashboard-update coach.html` updates `coach.html`. A
value that ends in `.html` is the file, also in the first place.

To update the data without coach notes, see
[Update the dashboard](dashboard.md#update-the-dashboard).

After a release, this prompt also writes the new page code. Restart the client first. See
[Update the page code after a release](dashboard.md#update-the-page-code-after-a-release).

To update the page automatically, tell your assistant when, in your own words, for example "update
my dashboard every Monday at 7". Before it writes the schedule, Claude Code and the MCP Inspector
ask you to confirm the next three updates in a form (tested with 2.1.329 and 2.16.0; Claude
Desktop: not tested). See
[Update the dashboard on a schedule](dashboard.md#update-the-dashboard-on-a-schedule).

### dashboard-setup

The assistant asks you some questions, then writes a page with your answers. First, it asks who the
page is for:

- **Personal**: a page for you, with all your data.
- **Shared**: a page for your coach or personal trainer. You select each type of data to include,
  for example HR zones yes, fitness age and sleep no. Other users of your computer can read the new
  file, for example through a shared folder.

Then the assistant asks for the file (any name or path), the title, the headline, the sports, the
languages and the themes, whether to compare the workouts that your runs repeat, and the period: the
last `weeks` weeks, or from a day that you choose (`since`), with one more week at each update, up
to 52. A page can also keep the sleep and resting HR of the whole period (`recoveryHistory`,
off by default). The assistant also asks whether to add a Year tab with the recap of the calendar
year (`yearReview`, off by default). A page that has it keeps it, but a page that you share keeps it
only when you ask for it. The server writes only the data that you select into the file. Other data
is not in the file, so you can send the file safely. A personal page and a shared page can be two
files side by side. Each page keeps its settings on each update. The argument `weeks` is optional
(default 12).

[Page settings](dashboard.md#page-settings) tells more.

### dashboard-widget

This prompt makes a new widget from your idea, for example "my longest ride of each month". The
assistant writes a small widget, and `editDashboard` stores it in the page and in your widget
library (`widgets.json` in the data folder). The widget stays after each update, and each new page
gets it too. The argument `idea` is required. The argument `path` is optional: it is the file of the
page, for example `coach.html`. In Claude Code:
`/mcp__garmin-personal__dashboard-widget my longest ride each month coach.html`. Reload the page to see
the widget.
[Custom widgets](custom-widgets.md) tells more.

### dashboard-language

This prompt adds a language to the dashboard. The assistant translates the texts of the page, and
`editDashboard` stores them in the page. The argument `language` is optional: the default is the
language of the conversation. The argument `path` is optional: it is the file of the page, for
example `coach.html`. In Claude Code: `/mcp__garmin-personal__dashboard-language Dutch coach.html`.
A text without a translation shows in English. To remove an added language, ask your assistant to
remove it: `editDashboard` with `removeLanguages`. Before it deletes the texts, Claude Code asks you
to confirm in a form (tested with 2.1.329), and so does the MCP Inspector (tested with 2.16.0).
Claude Desktop shows no form and deletes the texts at once (tested with 6.6395.1).
[Languages](languages.md) tells more.

## Coach prompts

In a client that shows MCP completions, the `activity` argument of `run-review`, `strength-review`,
`swim-review` and `ride-review` suggests the names of your recent activities as you type. The
names come from the dashboard data on your computer (your newest 200 activities), not from Garmin,
so the suggestions start after your first dashboard update. The MCP Inspector shows suggestions
(tested with 2.16.0 on the `distance` argument of `race-readiness`). Claude Code (tested with
2.1.329) and Claude Desktop (tested with 6.6395.1 on `distance`) do not show them.

### run-review

The assistant compares the planned workout that your watch ran with the laps of the run: the target,
what the lap did, and hit or miss. The server finds hit or miss from the run's .FIT file, so two
reviews of one run give the same result. For intervals, it gives the fade from the first rep to the
last. For a steady run, it gives the HR drift: the drop in distance per heartbeat from the first
half to the second half. It ends with the sleep and HRV of the night after the run, and a short
coach note.

| Argument   | Values                                                     | Default      |
| ---------- | ---------------------------------------------------------- | ------------ |
| `activity` | an activity id, or words of the activity name (`Long Run`) | the last run |

### race-readiness

The assistant reads the server's summary of 12 weeks (a `writeDashboard` preview, which writes no
page file). It has the weekly run distance and load, the weekly share of easy and hard zone time
(zones 1-2 and 4-5), the share of the longest run in the weekly run distance (above 35% is the
page's warning level), the long runs with their pace split and HR drift, the aerobic efficiency
(distance per heartbeat of the easy runs, last 4 weeks against the first 4) and the race
predictions, as the dashboard computes them. The assistant gives the days to the race and these
numbers, and tells whether your load drops in the last 2 weeks (the taper). The race prediction uses
your best efforts of 5 km or more (Riegel, an estimate: the fastest prediction counts). The
assistant compares it with your goal and checks the HRV and sleep of the last 7 nights. It ends with
a target pace for each quarter of the race.

| Argument   | Values                                         | Default                  |
| ---------- | ---------------------------------------------- | ------------------------ |
| `date`     | the race date, `yyyy-MM-dd`                    | none: the assistant asks |
| `distance` | `5k`, `10k`, `half`, `marathon`, or a distance | none: the assistant asks |
| `goal`     | your goal time, for example `1:45:00`          | no goal: prediction only |

In a client that shows MCP completions, `distance` suggests `5k`, `10k`, `half` and `marathon` as
you type (the clients are in [Coach prompts](#coach-prompts)).

In Claude Code, give the values in any order: a value in the form `yyyy-MM-dd` is the date, a value
in the form `1:45:00` is the goal, and the other words are the distance. For example
`/mcp__garmin-personal__race-readiness half marathon 2026-11-15`.

### strength-review

The assistant compares the planned workout that your watch ran with the sets you did: the planned
sets and reps of each exercise, what you did, and hit or miss. The server finds hit or miss from the
session's .FIT file, so two reviews of one session give the same result. Garmin plans no weights, so
the plan shows none. For each
exercise it gives the top set and its estimated 1RM against the previous session of the same name,
and the rep drop from the first set to the last at the same weight. It compares your rest with the
planned rest, and ends with the sleep and HRV of the night after the session, and a short coach note.

| Argument   | Values                                                       | Default                   |
| ---------- | ------------------------------------------------------------ | ------------------------- |
| `activity` | an activity id, or words of the activity name (`Upper Body`) | the last strength session |

### swim-review

The assistant gives the summary of one swim, and keeps pool and open water apart. For a pool swim it
shows each interval: distance, stroke, pace per 100 m, SWOLF, strokes and the rest after it. For each
repeated set it shows the pace and SWOLF of the first and the last repeat, and the fade in %. It
shows the planned workout beside the laps, without hit or miss, and ends with the sleep and HRV of
the night after the swim, and a short coach note. It does not judge a swim on heart rate alone.

| Argument   | Values                                                    | Default       |
| ---------- | --------------------------------------------------------- | ------------- |
| `activity` | an activity id, or words of the activity name (`Morning`) | the last swim |

The prompt needs one .FIT file. A set is laps in a row of one distance, stroke and intensity. Two
sets of the same distance, stroke and intensity read as one.

### swim-readiness

The assistant reads the server's summary of 12 weeks (a `writeDashboard` preview, which writes no
page file). It gives the days to the event, the swims and km of each week, the longest swim against
the event distance, and your recent pace, with pool and open water in separate tables. For the pool
it compares your last swims with as many before them, in one pool length. It ends with your load,
HRV and sleep, and a short verdict. It gives no predicted time.

| Argument   | Values                                   | Default                  |
| ---------- | ---------------------------------------- | ------------------------ |
| `date`     | the event date, `yyyy-MM-dd`             | none: the assistant asks |
| `distance` | the event distance, for example `1.9 km` | none: the assistant asks |
| `tests`    | your 200 m and 400 m times, `3:10 6:40`  | no CSS                   |

CSS (critical swim speed) shows only when you give both test times, from all-out swims on one day. The
server computes it: (400 m time - 200 m time) / 2. It is never estimated from your swims.

In Claude Code, give the values in any order: a value in the form `yyyy-MM-dd` is the date, values in
the form `3:10` are the test times (the larger one is the 400 m), and the other words are the
distance. For example `/mcp__garmin-personal__swim-readiness 1.9 km 2026-08-01 3:10 6:40`.

### ride-review

The assistant gives the summary of one ride: distance, moving time, speed, ascent and ascent per
hour, heart rate, training effect and load, and the time in the easy and hard HR zones. It shows the
power only when the ride has power data, and the grit and flow of a mountain-bike ride. It shows the
planned workout beside the laps, without hit or miss, and a table of the laps. It compares the ride
with your earlier rides of the same name and a similar distance, among the last 20 activities of that
name before it, because a hillier route changes speed and climbing at the same fitness. It ends with
the sleep and HRV of the night after the ride, and a short coach note.

| Argument   | Values                                                       | Default       |
| ---------- | ------------------------------------------------------------ | ------------- |
| `activity` | an activity id, or words of the activity name (`Trail Loop`) | the last ride |

The laps need one .FIT file. Not checked on real data: power, a planned ride, an earlier ride of the
same name, and the laps of a mountain-bike or indoor ride.

### train-today

The assistant reads the server's summary of the dashboard data (a `writeDashboard` preview, which
writes no page file). It uses the weeks of your dashboard page, so the numbers are the same as on
the page. It gives the verdict of the dashboard's Readiness widget: go easy, normal or ready to
push. This verdict is the dashboard's own rule, not Garmin's Training Readiness. A table shows each
input and the rule it meets: the HRV status, the sleep score, the resting HR against the average of
the 7 days before, and the load ratio of 7 to 28 days. When a value is from an older night, the
assistant gives its date. Then it names the days in a row with warning signs, when 2 or more of
these were off: the resting HR 5 bpm or more above its 7-day base, last night's HRV under the low
end of its range, and a sleep score under 60. One such day is a note; 2 in a row are a warning. Each
day comes with its numbers. The signs do not change the verdict and are not a diagnosis. Then it
gives your fitness, fatigue and form, and a short coach note.

Without HRV and sleep data, for example when the page leaves out the recovery data, the summary has
no readiness: the verdict and its inputs show as "n/a". The prompt has no arguments.

### week-review

The assistant reads the server's summary of the dashboard data (a `writeDashboard` preview, which
writes no page file). It uses the weeks of your dashboard page, so the numbers are the same as on
the page. It compares your last whole week, Monday to Sunday, with up to 4 weeks before it:
sessions, hours, km, run km and load, and the load ramp against the week before (above 10% is the
page's warning level). Then it gives the load ratio, the monotony and strain of the last 7 days and
the form of today. It names the warning-sign days of the week (2 or more of these in one day: the
resting HR 5 bpm or more above its 7-day base, last night's HRV under the low end of its range, a
sleep score under 60) with their numbers, and the days in a row with signs up to the newest day: 2
in a row are a warning, not a diagnosis. Then it gives the new run bests of the week with the time
each one beat. These are bests since the page's first week, not all-time records: a faster run
before that week is not counted. It gives the planned strength exercises hit and missed in the week,
and the exercises that miss most. These count only the sessions you did: a skipped planned session
leaves no file and is not seen. It gives the laps of the week's runs on the planned target and off
it, the drills that miss most, and how many runs it could not read (the page setting `workouts`
reads more of them). It ends with a short coach note. The summary has no split by sport for each
week, so the review has none. The prompt has no arguments.

### block-review

The assistant reads the server's summary of the block (a `writeDashboard` preview, which writes no
page file). The block is your last 4 to 12 whole weeks, Monday to Sunday, 8 by default. The week in
progress is not in it. The assistant gives a table of the weeks with their sessions, hours, km,
load, load ramp against the week before, monotony, strain, and the easy and hard share of the runs
and of the rides. It names the weeks that the page flags (a ramp above 10%, a monotony above 2) and
the strain of the first and the last week. It compares the easy and hard share of the first and the
last week. Then it compares the aerobic efficiency at the start and at the end of the block: the
metres per heartbeat of the runs and the normalized power per heartbeat of the rides, both below
zone 4. Each end is 4 weeks, or half of a shorter block. The change needs 3 sessions at each end, so
in a short block it is often "n/a", with the session count of each end. Both values need your HR
zones, and the ride value needs a power meter. It ends with a short coach note.

The argument `weeks` is optional (default 8): the number of whole weeks in the block. A value under
4 gives 4, a value over 12 gives 12, and a value that is not a whole number gives 8.
