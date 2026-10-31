# The training dashboard

The training dashboard is one HTML file. It shows your training load next to HRV, sleep and resting
heart rate. The server writes the file, and the assistant writes the coach notes.

- [Make the dashboard](#make-the-dashboard)
- [Update the dashboard](#update-the-dashboard)
- [Update the dashboard on a schedule](#update-the-dashboard-on-a-schedule)
- [Show the dashboard in the chat](#show-the-dashboard-in-the-chat)
- [Boards and widgets](#boards-and-widgets)
- [Change the layout](#change-the-layout)
- [Themes and languages](#themes-and-languages)
- [Page settings](#page-settings)
- [How the page keeps your changes](#how-the-page-keeps-your-changes)

## Make the dashboard

Run the `training-dashboard` prompt. It has two optional arguments:

| Argument | Values                          | Default  |
| -------- | ------------------------------- | -------- |
| `weeks`  | 1 to 52                         | 12       |
| `layout` | `preset`, `blank` or `freeform` | `preset` |

| Layout     | What you get                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `preset`   | The built-in widgets on each board, in a fixed order. A build takes less than a minute.                                           |
| `blank`    | An empty grid on each board. You add the widgets that you want.                                                                   |
| `freeform` | The assistant designs the whole page from a long description. A build can take 25 minutes or more, and each page looks different. |

With `preset` and `blank`, the assistant first asks for the title and the headline (the line under
the title). Keep them or type your own. Later updates keep them, also the automatic update. When the
page has other settings, for example only one sport or no sleep data, the assistant tells you these
settings. When the page excludes data, for example on a page for your coach, the assistant names
that data. It also tells you that the defaults add that data to the page again. Keep the settings
(the default), or use the defaults. The defaults are all sports, all data, all themes, and English
and the language of your Garmin profile. With the defaults, the page opens in midnight. You can also
type your own choice, for example "all sports, keep the rest".

To set the sports and the data of the page too, for example for a page that you share with your
coach, run `dashboard-setup`. See [Page settings](#page-settings).

With `preset` and `blank`, the assistant does not write the page. The server writes the page from
its template, and the assistant writes only the coach notes. The page is the same in every client.

The server writes `garmin-dashboard.html` in the data folder. The assistant gives you the path and
the command to open the file. An existing page stays as `garmin-dashboard.html.bak`. To write the
page in a different place, ask your assistant for a path. A relative path is in the data folder.

The page works offline. It has Chart.js inside, and its own code sends no requests. Its footer tells the date and
time when the server wrote the data, in the time zone of the browser. When Garmin did not give some days, the footer also gives their number: their
values show "n/a". The footer also shows the version of the server that wrote the page, with a link
to its release notes. Give this version when you report a problem.

## Update the dashboard

Run the `training-dashboard-update` prompt. The server replaces only the data and the coach notes.
Your layout, your custom widgets, your languages and your page settings stay. Leave `weeks` empty to keep the weeks of
the page.

When a new version of the server has a newer page template, the update writes the new template. It
keeps your layout, custom widgets, languages and page settings, and it keeps the old page as a
`.bak` file.

The first update sends approximately 35 requests to Garmin. Later updates use the local cache and
send approximately 8.

Reload the page in the browser to see the new data.

## Update the dashboard on a schedule

This is optional. The server can update the data of your page at fixed times, also when no
assistant is open.

When you make a page with `training-dashboard` (all layouts) or `dashboard-setup`, the assistant
asks one time if the page must update automatically:

| Choice                | Schedule                   |
| --------------------- | -------------------------- |
| No (default)          | no automatic update        |
| Every day at 07:00    | each day                   |
| Weekdays at 07:00     | Monday to Friday           |
| Every Monday at 07:00 | once a week                |
| Your own words        | any schedule that you type |

When a schedule is already set, the assistant offers it first, after "No". When the page already
updates automatically, the assistant does not ask. It tells you the schedule and the next update.
You can ask it to change or stop the schedule. The `training-dashboard-update` prompt does not ask:
it only reminds you that you can ask.

You can also ask at any time. Say when in your own words, in any language, for example:

- "Update my dashboard every day at 7."
- "Update my dashboard on Monday and Thursday at 18."
- "Aggiorna la mia dashboard ogni lunedì alle 8."
- "Update my coach page on the first day of each month at 8."
- "Stop the automatic update of my dashboard."
- "When does my dashboard update?"

The assistant turns your words into a cron expression and tells you the next three updates, so you
can check that it understood you. Two updates must be at least 1 hour apart. Without a time, the
update is every day at 07:00. All the pages that update automatically use the same schedule.

- The update replaces the data of the page. It keeps the weeks, the layout, the custom widgets, the
  languages and the settings.
- It removes the coach notes, because old notes do not agree with the new data. To get new notes,
  run the `training-dashboard-update` prompt.
- The computer must be on at that time. A Mac that was asleep updates the page when it wakes up. A
  Mac that was off updates the page when you log in. A Windows computer that was asleep or off
  updates the page when it starts again. Linux skips that time. A missed time runs one time only.
- When the network is not ready, for example right after you log in, the update tries again after 30
  seconds, 1 minute and 2 minutes.
- When an update is more than 1 hour late, the page shows a note. Ask your assistant "when does my
  dashboard update?": the reply gives the last update and the pages that it could not update.
- The server adds one job to the scheduler of your computer: launchd on macOS, your crontab on
  Linux, and Task Scheduler on Windows. The job reads the API key from the key file
  (`GARMIN_API_KEY_FILE`), never from your MCP client configuration. Save the key in that file
  first.
- The job runs the server as you installed it. A server that `npx` or `pnpm dlx` starts schedules
  the latest release through `npx`. The server also looks for the folders of `bunx` and `yarn dlx`
  (not tested). A server installed with `npm install -g` schedules that copy. After you change the
  Node.js version, set the schedule again. Ask your assistant "when does my dashboard update?": the
  reply says when the job cannot start.
- Each update writes one line to `~/.cache/garmin-personal-mcp/refresh.log`.

## Show the dashboard in the chat

In Claude Desktop, the dashboard can open inside the chat. The page has the same boards, charts and
themes as the page file, with new data. You do not open a file or a browser.

There is no prompt for this. Ask in your own words, and say "in the chat":

| You ask                                                | The chat shows                                 |
| ------------------------------------------------------ | ---------------------------------------------- |
| "Show my training dashboard in the chat."              | your saved page, with the weeks of the page    |
| "Show my dashboard in the chat for the last 26 weeks." | the same page, with 26 weeks                   |
| "Show garmin-dashboard-coach.html in the chat."        | that page, for example the page for your coach |

The assistant calls the `showDashboard` tool. When it writes a file instead, ask again with "in the
chat". The tool has two optional arguments:

| Argument | Values                                                | Default                        |
| -------- | ----------------------------------------------------- | ------------------------------ |
| `weeks`  | 1 to 52                                               | the weeks of the page, else 12 |
| `path`   | the page file. A relative path is in the data folder. | `garmin-dashboard.html`        |

- The page has the layout, the custom widgets, the languages and the settings of your saved page.
  Without a saved page, it has the preset widgets.
- The server writes no file, and the page has no coach notes.
- When the client can show the page full screen, a button next to **Settings** does it. The same
  button goes back to the chat.
- The data goes only to the page. The assistant gets the digest of the data, as with
  `writeDashboard`.
- A layout that you change in the chat is not saved in the file.
- A client can block the code of custom widgets. Then a custom widget shows an error, and the other
  widgets show as usual. Claude Desktop runs custom widgets. The page file always runs them.
- The page in the chat calls no tool of the server. Each tool tells the client that only the
  assistant can call it. A client that obeys the MCP Apps rules does not let the page, or a custom
  widget in it, call a tool.

| Client                                                | What you get                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Claude Desktop                                        | the page in the chat (tested)                                            |
| Claude Code, the Codex CLI and other terminal clients | a short text reply. Run `training-dashboard` to write the page as a file |
| Codex in the ChatGPT desktop app                      | not tested yet                                                           |
| The ChatGPT chat, Claude on the web                   | not available: they connect only to servers on the internet              |

The page in the chat is an MCP App. An MCP server gives this page to the client, and the client
shows it in the chat. Other clients that show MCP Apps can also work, but they are not tested. The
ChatGPT chat and Claude on the web show MCP Apps too, but they cannot start a server on your
computer.

### From a terminal

```bash
npx -y @indaco/garmin-personal-mcp@latest schedule daily 07:00
npx -y @indaco/garmin-personal-mcp@latest schedule weekdays 06:30
npx -y @indaco/garmin-personal-mcp@latest schedule weekly monday 08:00 garmin-dashboard-coach.html
npx -y @indaco/garmin-personal-mcp@latest schedule "0 18 * * 1,4"  # a cron expression
npx -y @indaco/garmin-personal-mcp@latest schedule              # show the schedule
npx -y @indaco/garmin-personal-mcp@latest schedule off          # stop all
npx -y @indaco/garmin-personal-mcp@latest schedule off garmin-dashboard-coach.html
npx -y @indaco/garmin-personal-mcp@latest refresh               # update now, once
```

A cron expression has 5 fields in local time: minute, hour, day of the month, month and weekday
(0 is Sunday), with numbers, lists (`1,4`), ranges (`1-5`) and steps (`*/6`). A file name ends in
`.html`. A relative path is in the data folder. `refresh` with a file name
updates that page.

## Boards and widgets

Each tab is a board: a grid of widgets with up to 3 columns. A board has 2 columns on a tablet and 1
column on a phone. Each widget is 1, 2 or 3 columns wide.

The page uses the training load, HR zones and training effect from Garmin. It labels each value that
it calculates as an estimate, and a missing value shows as "n/a".

The All board shows all types. The Recovery board shows readiness, fitness age, load against
recovery and the 14-day recovery widgets: HRV, resting HR, sleep, sleep need, bedtime and Body
Battery. Each type board shows one sport. The board of an activity is its
sport in the Garmin FIT SDK. Garmin sends that sport as a number with each activity. The server
gives it the SDK name, for example `running` or `racket`.

The All, Recovery, Run, Strength, Walk, Bike and Racket sports tabs are always there. The Hike, Swim and Other
tabs show only when you have activities of that sport. [Page settings](#page-settings) can keep
fewer sport tabs, and remove the Recovery tab.

| Tab           | Board key          | Activities                                       |
| ------------- | ------------------ | ------------------------------------------------ |
| Recovery      | `recovery`         | all; its widgets show the days, not activities   |
| Run           | `running`          | SDK sport `running`                              |
| Strength      | `strengthTraining` | Garmin type `strength_training`                  |
| Walk          | `walking`          | SDK sport `walking`                              |
| Hike          | `hiking`           | SDK sport `hiking`                               |
| Bike          | `cycling`          | SDK sport `cycling`                              |
| Swim          | `swimming`         | SDK sport `swimming`                             |
| Racket sports | `racket`           | SDK sport `racket`, and Garmin type `pickleball` |
| Other         | `generic`          | activities without a sport                       |

Two Garmin types are exceptions, because their SDK sport does not fit:

- Garmin sends strength training as the sport `training` or `fitnessEquipment`.
- Garmin sends pickleball as the sport `hiit`.

Each other sport gets a tab of its own, with the widgets of the Other board. The tab shows the name
of the sport in the page language: `alpineSkiing` is "Alpine skiing" in English and "Sci alpino" in
Italian. The tabs of other sports come after Racket sports,
in the order of their keys. Other is always the last tab.

[The widget catalogue](widgets.md) lists every widget, with what it shows and how it calculates.

Above the boards is **the week window**: the last 4, 8 or 12 weeks, all the weeks, or a first and a
last week. Every widget about training follows the window. The widgets about today do not follow it:
readiness, fitness age and the 14-day recovery widgets. On a phone the window folds into one control,
for example **Weeks: Last 12**, and the header stays at the top while you scroll.

Below the window, **Activity names** shows only the activities with the names you choose, for
example the sessions of a training plan. It opens a list of the names of the window on the current
board, the most frequent first, with a search. The chosen names show next to the button: ✕ removes
one. The training widgets and the tab counts follow it. The load widgets of the body
do not: load safety, the load ratio and the share of all load count every activity.

The URL keeps the board, the window, the chosen names and an open exercise. A reload or a shared link opens the same
view.

In a chart, a click on a legend item shows only that series. A second click on it shows all the
series again. Shift-click, or Cmd-click on a Mac, hides or shows only that series.

## Change the layout

Open the settings menu (the sliders button at the top right) and select **Edit layout**. An empty
board has its own **Edit layout** button. Each widget then has these controls:

| Control             | Action                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⠿                   | Drag the widget to a new place. A dashed slot shows where it lands, and the page scrolls near the top or the bottom. This works with touch too. Escape cancels. |
| ⠿ from the keyboard | Press Space to pick the widget up, the arrow keys, Home or End to move it, and Space to drop it. Escape puts it back.                                           |
| The right edge      | Drag it to set the width: it snaps to 1, 2 or 3 columns. From the keyboard it is a slider: the arrow keys, Home and End. A tablet has 2 columns, a phone 1.     |
| The eye             | Hide the widget. **Add widget** lists the hidden widgets: show one again, or remove it.                                                                         |

Some widgets have a narrowest width: Activities and Period comparison need 2 columns.

The edit bar stays at the top of the window while you scroll. It has:

- **Add widget**: opens the catalogue: the built-in widgets, your custom widgets and the hidden
  widgets of the board. Type in the search field to find a widget by its title, in the page
  language or in English.
- **Reset board**: puts the preset widgets back on the board.
- **Copy layout**: gives the layout as text.
- **Discard**: puts the layout back as it was before you selected **Edit layout**, on every board.
  When you have changes, the page asks first. Escape does the same.
- **Done**: saves the changes and shows the board.

Your changes are a draft until you select **Done**. The bar says "Unsaved changes" when you have
some, and the browser asks before you close the page with them.

You can also ask your assistant to change the layout, for example "hide the bedtime widget and move
HRV to the top". The assistant uses the `editDashboard` tool.

To make your own widget, see [Custom widgets](custom-widgets.md). Your widgets stay in your widget
library on your computer, and each page that you make gets them.

## Themes and languages

The settings menu has **Language** and **Theme**. The **Theme** menu has 13 themes: System, six dark themes, four light themes and two
high-contrast themes. Midnight is the default.

The **Language** menu has English, the language of your Garmin profile when it is built in, and the
languages that you add. The built-in languages are English, Italian, German, French, Spanish and
Portuguese. The [page settings](#page-settings) can keep other built-in languages in the file. The
page opens in the language of your Garmin profile until you choose one in the menu. _Auto_ follows
the language of the browser. The page can have no texts in the language of your Garmin profile, for
example Russian. Then it shows English, and the settings menu gives the name of that language. When
the assistant makes the page, it tells you this. It offers to add that language and asks if you want
one more. [Languages](languages.md) tells how to add a language.

## Units

The page uses the units of your Garmin profile (in Garmin Connect, the measurement units of your
user settings). The server reads them each time it writes the page. There is no units menu on the
page: change the setting in Garmin Connect, then update the dashboard.

| Value     | Metric | Statute US | Statute UK |
| --------- | ------ | ---------- | ---------- |
| Distance  | km     | mi         | mi         |
| Pace      | /km    | /mi        | /mi        |
| Speed     | km/h   | mph        | mph        |
| Elevation | m      | ft         | m          |
| Weight    | kg     | lb         | lb         |
| Swim pace | /100 m | /100 yd    | /100 m     |

Race names such as 5 km and 10 km stay the same in every system. If Garmin does not answer with
the setting, the page uses metric.

## Page settings

The `dashboard-setup` prompt asks you questions and writes a page with your answers. You can also
ask your assistant directly, for example "make a dashboard for my coach without my sleep data". The
assistant calls `writeDashboard` with `settings`:

| Setting     | What it does                                                               | Default                                                |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `title`     | replaces the title in every language                                       | the built-in title                                     |
| `headline`  | replaces the line under the title in every language                        | the built-in headline                                  |
| `sports`    | the boards to keep, for example `running` and `cycling`                    | all                                                    |
| `exclude`   | the data to leave out: `recovery`, `fitnessAge`, `zones`, `names`, `notes` | none                                                   |
| `languages` | the built-in languages to keep: `en`, `it`, `de`, `fr`, `es`, `pt`         | English and the language of the Garmin profile         |
| `language`  | the language that the page opens in: `auto` or a language code             | the profile language when the page has it, else `auto` |
| `themes`    | the themes to keep                                                         | all                                                    |
| `theme`     | the theme that the page opens in                                           | `midnight`                                             |
| `workouts`  | compare the same run workout across weeks (the Workout trend widget)       | off                                                    |

The server leaves the excluded data and sports out of the file, and out of the digest for the coach
notes. The server cannot remove data from the chat. If another tool showed the data earlier in the
same chat, the assistant has it. Then only the prompt tells the assistant not to use that data in
the notes. Make a page for someone else in a new chat. A widget does not show when the settings
exclude its data. With `recovery` excluded, the page has no Recovery board. `names` removes the
names of the activities; the sport stays. The file holds only the chosen languages and the CSS of
the chosen themes. A page without English (`["it"]`) opens in Italian for every reader; English
stays in the file only for a text that has no translation. With one language or one theme, the page
has no menu to choose it.

Each page keeps its own settings, so a personal page and a page for your coach can be two files, for
example `garmin-dashboard.html` and `garmin-dashboard-coach.html`. In the `dashboard-setup`
questions, you can type any file name or path, for example `~/Desktop/coach.html`. A name or
relative path is in the data folder. An update without `settings` keeps the settings of the page. To
update a page with another file name, give its file to the prompt:
`/mcp__garmin-personal__training-dashboard-update garmin-dashboard-coach.html`. The prompt
`dashboard-language` takes the file in the same way. New settings replace all the old settings, and
the server keeps the old page as `.bak`.

`workouts` is for a training plan whose sessions have the same name, for example "Tempo Run" every
week. Garmin names a run "<place> - <workout>", and the place does not count: "Riverside - Drill
Workout" and "Hillview - Drill Workout" are one workout. Every prompt that makes a page asks about
it when your runs repeat a name. With `workouts`, the server also loads the laps of the last 8 runs
of each repeated name. It downloads the .FIT file of each of those runs once, so the first build
takes longer, and keeps it in the data folder. An older run whose file is already there keeps its
laps. The history grows with each update, but an update downloads at most 8 files for each workout.
The Workout trend widget compares those sessions: pace, HR, efficiency and running form, and for
intervals the work laps, the reps and the fade. Without `workouts`, the page has no Workout trend
widget.

Settings need a page from the template, or a page that the assistant designed (`freeform`) with a
`garmin-settings` block. The freeform prompt adds that block when you set `workouts`.

## Keyboard and screen readers

- The first Tab gives **Skip to the board**.
- On the tabs, the arrow keys, Home and End select a board.
- The consistency calendar is one Tab stop: the arrow keys move one day (up and down) or one week
  (left and right). Escape closes the day details.
- Each chart has its data as a table that screen readers read instead of the picture.
- In edit mode the grip and the right edge of a widget work from the keyboard too: see
  [Change the layout](#change-the-layout).

## How the page keeps your changes

The page keeps its state in blocks of the file. The blocks hold the data, the layout, the custom
widgets, the languages that you add and the [page settings](#page-settings). An update replaces only
the data block and the block of the built-in languages. It also adds the widgets of your widget
library (`widgets.json` in the data folder).

The browser saves the layout when you select **Done**, but only in that browser. To keep the layout
in the page, select **Copy layout** and give the text to your assistant. The assistant saves it with
`editDashboard`. When the assistant saves a layout, the page shows the new layout and asks which one
to use. **Keep mine** goes back to the layout of the browser. **Use the new one** deletes the layout
from the browser.

The choice of theme and language stays in the browser.
