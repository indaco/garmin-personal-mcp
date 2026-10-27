# The training dashboard

The training dashboard is one HTML file. It shows your training load next to HRV, sleep and resting
heart rate. The server writes the file, and Claude writes the coach notes.

- [Make the dashboard](#make-the-dashboard)
- [Update the dashboard](#update-the-dashboard)
- [Boards and widgets](#boards-and-widgets)
- [Change the layout](#change-the-layout)
- [Themes and languages](#themes-and-languages)
- [How the page keeps your changes](#how-the-page-keeps-your-changes)

## Make the dashboard

Run the `training-dashboard` prompt. It has two optional arguments:

| Argument | Values                          | Default  |
| -------- | ------------------------------- | -------- |
| `weeks`  | 1 to 52                         | 12       |
| `layout` | `preset`, `blank` or `freeform` | `preset` |

| Layout     | What you get                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `preset`   | The built-in widgets on each board, in a fixed order. A build takes less than a minute.                                    |
| `blank`    | An empty grid on each board. You add the widgets that you want.                                                            |
| `freeform` | Claude designs the whole page from a long description. A build can take 25 minutes or more, and each page looks different. |

With `preset` and `blank`, Claude does not write the page. The server writes the page from its
template, and Claude writes only the coach notes. The page is the same in Claude Code and Claude
Desktop.

The server writes `garmin-dashboard.html` in the data folder. Claude gives you the path and the
command to open the file. An existing page stays as `garmin-dashboard.html.bak`. To write the page in
a different place, ask Claude for a path. A relative path is in the data folder.

The page works offline. It has Chart.js inside, and it sends no requests.

## Update the dashboard

Run the `training-dashboard-update` prompt. The server replaces only the data and the coach notes.
Your layout, your custom widgets and your languages stay. Leave `weeks` empty to keep the weeks of
the page.

When a new version of the server has a newer page template, the update writes the new template. It
keeps your layout, custom widgets and languages, and it keeps the old page as a `.bak` file.

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
tabs show only when you have activities of that sport.

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
readiness, fitness age and the 14-day recovery widgets.

The URL keeps the board, the window and an open exercise. A reload or a shared link opens the same
view.

In a chart, a click on a legend item shows only that series. A second click on it shows all the
series again. Shift-click, or Cmd-click on a Mac, hides or shows only that series.

## Change the layout

Select **Edit layout**. Each widget then has these controls:

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

You can also ask Claude to change the layout, for example "hide the bedtime widget and move HRV to
the top". Claude uses the `editDashboard` tool.

To make your own widget, see [Custom widgets](custom-widgets.md).

## Themes and languages

The **Theme** menu has 11 themes: System, five dark themes, three light themes and two
high-contrast themes. Midnight is the default.

The **Language** menu has English, Italian and the languages that you add. _Auto_ follows the
language of the browser. [Languages](languages.md) tells how to add a language.

## How the page keeps your changes

The page keeps its state in four blocks of the file: the data, the layout, the custom widgets and the
languages. An update replaces only the data block.

The browser saves the layout when you select **Done**, but only in that browser. To keep the layout in the page,
select **Copy layout** and give the text to Claude. Claude saves it with `editDashboard`. When Claude
saves a layout, the page shows the new layout and asks which one to use: **Keep mine** goes back to
the layout of the browser, **Use the new one** deletes it from the browser.

The choice of theme and language stays in the browser.
