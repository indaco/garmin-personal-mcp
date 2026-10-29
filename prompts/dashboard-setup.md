Set up a Garmin training dashboard for me: ask what it shows, then write it. Use the tools of the
`garmin-personal` MCP server. The page covers the last **{{weeks}} weeks** (today is {{today}}). Answer in
my language.

Ask every question below each time this prompt runs, also when the conversation already has answers
from an earlier run. If your client has a tool for questions with choices (in Claude Code:
AskUserQuestion), use it: at most 4 questions in one call, and each question has 2 to 4 options. The
tool adds an option where I can type my own answer: say in the question when I can type one. Without
such a tool, ask the questions in chat as numbered lists, with the default first.

1. First round:
   - **For**: me (default: all data), or a person I share the page with, for example my coach.
   - **File**: options `garmin-dashboard.html` (default) and `garmin-dashboard-coach.html`. Say in
     the question that I can type any other name or path: a name or relative path is in the data
     folder, a full path or a path that starts with `~/` can be anywhere. It must end in `.html`.
   - **Title**: options "{{title}}" (default) and "Type my own".
   - **Headline** (the line under the title): options "{{headline}}" (default) and "Type my own".
   When I choose "Type my own" and give no text, ask for the text in chat.
2. Second round:
   - **Data** (multiple choice): recovery (sleep, HRV, stress, body battery, resting HR), fitness age,
     HR zones, activity names. For me, all are selected by default; for a shared page, ask about each
     one. The server leaves out of the file what I do not select.
   - **Coach notes**: include (default) or leave out.
   - **Languages**: options "English and the language of my Garmin profile, opens in the profile
     language" (default), "All: {{languageNames}}", "English only" and "Italian only". Say that I can
     type another choice, for example "English and Italian, opens in Italian".
   - **Themes**: options "All 11 themes, opens in midnight" (default), "Midnight only" and "Paper
     only". Say that I can type other themes and the one it opens in: {{themes}}.
3. Call `writeDashboard` with `preview` = true, `weeks` = {{weeks}} and the `path`. It writes nothing.
   Ask which sports to keep (multiple choice) from the boards of `boards`, with their number of
   activities. With more than 4 boards, show the 3 largest and say that I can type the others.
   Default: all.
4. Call `writeDashboard` with `weeks` = {{weeks}}, the `path` and `settings`:
   `title`, `headline`, `sports` (the boards to keep), `exclude` (from `recovery`, `fitnessAge`,
   `zones`, `names`, `notes`), `languages` (the codes to keep: {{languages}}), `language` (the one it
   opens in), `themes`, `theme`. Leave out a setting that keeps its default. If there is no page at
   the path, also give `layout` = "preset".
5. Unless I left out the coach notes: write at most 5 coach notes from the digest. Each note names a
   specific number of the digest. Training suggestions only, no medical advice. Plain text, in my
   language. Then call `writeDashboard` again with the same `weeks`, `path` and the `notes`, without
   `settings`: the page keeps them.

If a `writeDashboard` result has `missingWidgetTexts`, call `editDashboard` with the same `path` without
changes, translate the English texts of those widgets (`customWidgets[].texts.en`) into the listed
languages, keeping each `{placeholder}`, and call `editDashboard` with `widgetTexts` =
{ "<widget id>": { "<code>": { "<key>": "<text>", ... } } }.

Use only numbers of the digest. **Never invent, interpolate or estimate missing values.** If a value
is missing, write "n/a". If a call fails, say which one and why in one line.

Do not write or change the page yourself. Settings need a page from the template: a page designed with
layout freeform cannot keep them.

Automatic refresh: call `scheduleDashboardRefresh` without arguments. If its `pages` do not have
the `path` of the page, ask me once whether to update the page automatically. If your client has a
tool for questions with choices, use it: "No" (the default), every day, weekdays (Monday to Friday)
or once a week (then ask the day), at 07:00 unless I give another time. If `scheduled` is true, the
schedule is for all the pages: offer `schedule` as the first choice after "No". Say that each
automatic refresh replaces the data and removes the coach notes, and that the computer must be on.
On a yes, call `scheduleDashboardRefresh` with `every`, `time`, `day` (once a week only) and the
`path` of the page, and tell me the result in one line.

Finish with two lines in chat: the path of the page with the command to open it (`open` on macOS,
`xdg-open` on Linux, `start` on Windows), and the settings that the page keeps. Later updates keep
the settings: for a page with another file name, ask your assistant to update that file.
If the last reply has `missingProfileLanguage`, add one line: my Garmin profile uses that language,
the page has no texts in it and shows English, and the `dashboard-language` prompt adds the language.
