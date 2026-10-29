# The training dashboard

The training dashboard is one HTML file. It shows your training load next to HRV, sleep and resting
heart rate. The server writes the file, and the assistant writes the coach notes.

- [Make the dashboard](#make-the-dashboard)
- [Update the dashboard](#update-the-dashboard)
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

To set the title, the sports and the data of the page first, for example for a page that you share
with your coach, run `dashboard-setup`. See [Page settings](#page-settings).

With `preset` and `blank`, the assistant does not write the page. The server writes the page from
its template, and the assistant writes only the coach notes. The page is the same in every client.

The server writes `garmin-dashboard.html` in the data folder. The assistant gives you the path and
the command to open the file. An existing page stays as `garmin-dashboard.html.bak`. To write the
page in a different place, ask your assistant for a path. A relative path is in the data folder.

The page works offline. It has Chart.js inside, and its own code sends no requests. Its footer tells when the
data was written. When Garmin did not give some days, the footer also gives their number: their
values show "n/a".

## Update the dashboard

Run the `training-dashboard-update` prompt. The server replaces only the data and the coach notes.
Your layout, your custom widgets, your languages and your page settings stay. Leave `weeks` empty to keep the weeks of
the page.

When a new version of the server has a newer page template, the update writes the new template. It
keeps your layout, custom widgets, languages and page settings, and it keeps the old page as a
`.bak` file.

Reload the page in the browser to see the new data.

## Boards and widgets

Each tab is a board: a grid of widgets with up to 3 columns. A board has 2 columns on a tablet and 1
column on a phone. Each widget is 1, 2 or 3 columns wide.

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

The URL keeps the board, the window and an open exercise. A reload or a shared link opens the same
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
  widgets of the board.
- **Reset board**: puts the preset widgets back on the board.
- **Copy layout**: gives the layout as text.
- **Discard**: puts the layout back as it was before you selected **Edit layout**, on every board.
  When you have changes, the page asks first. Escape does the same.
- **Done**: saves the changes and shows the board.

Your changes are a draft until you select **Done**. The bar says "Unsaved changes" when you have
some, and the browser asks before you close the page with them.

You can also ask your assistant to change the layout, for example "hide the bedtime widget and move
HRV to the top". The assistant uses the `editDashboard` tool.

To make your own widget, see [Custom widgets](custom-widgets.md).

## Themes and languages

The settings menu has **Language** and **Theme**. The **Theme** menu has 11 themes: System, five dark themes, three light themes and two
high-contrast themes. Midnight is the default.

The **Language** menu has English, the language of your Garmin profile when it is built in, and the
languages that you add. The built-in languages are English, Italian, German, French, Spanish and
Portuguese. The [page settings](#page-settings) can keep other built-in languages in the file. _Auto_ follows the
language of the browser. [Languages](languages.md) tells how to add a language.

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

| Setting     | What it does                                                               | Default                                        |
| ----------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `title`     | replaces the title in every language                                       | the built-in title                             |
| `headline`  | replaces the line under the title in every language                        | the built-in headline                          |
| `sports`    | the boards to keep, for example `running` and `cycling`                    | all                                            |
| `exclude`   | the data to leave out: `recovery`, `fitnessAge`, `zones`, `names`, `notes` | none                                           |
| `languages` | the built-in languages to keep: `en`, `it`, `de`, `fr`, `es`, `pt`         | English and the language of the Garmin profile |
| `language`  | the language that the page opens in: `auto` or a language code             | `auto`                                         |
| `themes`    | the themes to keep                                                         | all                                            |
| `theme`     | the theme that the page opens in                                           | `midnight`                                     |

The server leaves the excluded data and sports out of the file, and out of the digest for the coach
notes. A widget whose data is left out does not show. With `recovery` excluded, the page has no
Recovery board. `names` removes the names of the activities; the sport stays. The file holds only
the chosen languages and the CSS of the chosen themes. A page without English (`["it"]`) opens in
Italian for every reader; English stays in the file only for a text that has no translation. With
one language or one theme, the page has no menu to choose it.

Each page keeps its own settings, so a personal page and a page for your coach can be two files, for
example `garmin-dashboard.html` and `garmin-dashboard-coach.html`. In the `dashboard-setup`
questions, you can type any file name or path, for example `~/Desktop/coach.html`. A name or
relative path is in the data folder. An update without `settings` keeps the settings of the page. To
update a page with another file name, give its file to the prompt:
`/garmin-personal:training-dashboard-update garmin-dashboard-coach.html`. The prompt
`dashboard-language` takes the file in the same way. New settings replace all the old settings, and
the old page is kept as `.bak`.

Settings need a page from the template: a page that the assistant designed (`freeform`) cannot keep
them.

## Keyboard and screen readers

- The first Tab gives **Skip to the board**.
- On the tabs, the arrow keys, Home and End select a board.
- The consistency calendar is one Tab stop: the arrow keys move one day (up and down) or one week
  (left and right). Escape closes the day details.
- Each chart has its data as a table that screen readers read instead of the picture.
- In edit mode the grip and the right edge of a widget work from the keyboard too: see
  [Change the layout](#change-the-layout).

## How the page keeps your changes

The page keeps its state in blocks of the file: the data, the layout, the custom widgets, the
languages that you add and the [page settings](#page-settings). An update replaces only the data
block and the block of the built-in languages.

The browser saves the layout when you select **Done**, but only in that browser. To keep the layout
in the page, select **Copy layout** and give the text to your assistant. The assistant saves it with
`editDashboard`. When the assistant saves a layout, the page shows the new layout and asks which one
to use: **Keep mine** goes back to the layout of the browser, **Use the new one** deletes it from
the browser.

The choice of theme and language stays in the browser.
