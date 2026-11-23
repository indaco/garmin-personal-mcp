Make a Garmin training dashboard for me: ask what it shows, then write it. Use the tools of the
`garmin-personal` MCP server. The page covers the last **{{weeks}} weeks** (today is {{today}}).
Answer in my language.

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
   - **Data** (multiple choice): recovery (sleep, HRV, stress, body battery, resting HR), fitness
     age, HR zones, activity names. For me, the default is all of them. For a shared page, ask about
     each one. A shared page has no default here: a reply such as "defaults", or no reply, does not
     answer this question. Ask it again at once, and go to step 3 only with my answer. A selection
     answers for all four, also "none". The server removes from the file the data that I do not
     select.
   - **Coach notes**: include (default) or exclude.
   - **Languages**: options "English and the language of my Garmin profile, opens in the profile
     language" (default), "All: {{languageNames}}", "English only" and "Italian only". Say that I can
     type another choice, for example "English and Italian, opens in Italian".
   - **Themes**: options "All 13 themes, opens in midnight" (default), "Midnight only" and "Paper
     only". Say that I can type other themes and the one it opens in: {{themes}}.
3. Call `writeDashboard` with `preview` = true, `weeks` = {{weeks}} and the `path`. It writes no
   page file. Ask which sports to keep (multiple choice) from the boards of `boards`, with their
   number of activities. With more than 4 boards, show the 3 largest and say that I can type the
   others. Default: all.
   In the same call, ask about the **Workout comparison**, only when `repeatedRuns` of the `digest`
   is not empty and I kept the activity names. Name the workouts of `repeatedRuns` with their number
   of runs. Options "No" (default) and "Yes, compare them across weeks". Say that a yes adds the
   Workout trend widget for those runs (when I keep the running board), and that the page then
   downloads the laps of the last 8 runs of each workout, once: this build takes longer.
   In the same call, ask about the **Recovery trend**, only when I kept the recovery data. Options
   "No" (default) and "Yes, add the Recovery trend". Say that a yes adds a widget with the weekly
   average of sleep, sleep score and resting HR for the whole period, and that the page file then
   holds these values for each day: this matters for a page that I share.
   In the same call, ask about the **Period**: options "The last {{weeks}} weeks" (default), "Since
   1 January" with the year of today (for example "Since 1 January 2026") and "From a day I choose".
   Say that I can type the day in my own words. Say that with a day, the page starts in the week of
   that day and gets one more week at each update, up to 52 weeks; after that it shows the last 52
   weeks. Say that the page does not start again on 1 January: in a new year it keeps its start day.
   Then ask, in a call of its own, about the **Year tab**, only when the `settings` of the preview
   have no `yearReview` = true and its `pageFrom` is not "assistant" (a designed page has no Year
   tab). Options "No" (default) and "Yes, add a Year tab with the recap of the calendar year". Say
   that the page file then holds data of days before its period: this matters for a page that I
   share.
4. Call `writeDashboard` with `weeks` = {{weeks}}, the `path` and `settings`. The settings are
   `title`, `headline`, `sports` (the boards to keep), `exclude` (from `recovery`, `fitnessAge`,
   `zones`, `names`, `notes`), `languages` (the codes to keep: {{languages}}), `language` (the one
   it opens in), `themes`, `theme`, `workouts` (true when I said yes to the workout comparison),
   `recoveryHistory` (true when I said yes to the Recovery trend), `yearReview` (see below),
   `shared` (true when the page is for a person I share it with), `since` (the start day, when I
   chose one; then no `weeks`). These settings replace those of the page: a setting that you leave
   out goes back to its default. Give `settings` also when they are {}. Leave out each setting that
   keeps its default, also `title` or `headline` when I chose the text that the question offers: the
   page then shows its own text in each language. The exception is `yearReview` = false, which is
   saved. If there is no page at the path, also give `layout` = "preset".
   `yearReview` is the first of these that applies:
   - true: I said yes to the Year tab or asked for it, or the page is for me, the `settings` of the
     preview have it as true and I did not say no.
   - left out: `pageFrom` is "assistant".
   - false: I said no, you asked and I replied "defaults", or the page is for a person I share it
     with and the `settings` of the preview have it as true. The answer is saved: no update asks
     again.
   - no answer, in all other cases: as the `settings` of the preview have it, or left out when they
     do not have it.
   After this call, when the `settings` of the preview have `yearReview` = true, tell me, without a
   question, whether the page keeps the recap of the calendar year, which holds days before its
   period, and that I can change this. A page for a person I share it with does not keep it without
   my yes. With `pageFrom` = "assistant", speak of the recap in the file of the page, not of a Year
   tab: a designed page has none. Tell me also when those settings have a `title` or `headline` that
   the page does not keep.
   If the reply has `addedWidgets` (board -> widget ids), tell me which widgets it added to which
   board, as the reply gives them; do not make up a title. Without it, say nothing about them.
   If the reply of this call has `offers`, I gave no answer about the Year tab: do not ask again and
   say nothing about the tab, the `training-dashboard-update` prompt asks later. If I answer after
   this call, save the answer with `answers`: in the call of step 5, or in one more `writeDashboard`
   call with the same `weeks` and `path`, and the same `notes` if there are any.
5. Unless I excluded the coach notes: write at most 5 coach notes from the digest. Each note names a
   specific number of the digest. Training suggestions only, no medical advice. Plain text, in my
   language. Then call `writeDashboard` again with the same `weeks`, `path` and the `notes`, without
   `settings`: the page keeps them.

Start day: turn the day I chose into `since` = yyyy-MM-dd ("Since 1 January" is 1 January of the
year of today). If I typed only numbers that can be read as day/month and as month/day (01/09 is 1
September or 9 January), ask which one. If my day does not exist (31 April) or is after today, tell
me what is wrong and ask again. When I typed the day, tell me the day with the weekday and the month
as words, in my language (for example "Tuesday 1 September 2026"), and the Monday that the page
starts on, and wait for my yes before you write the page. With `since`, the `writeDashboard` calls
that write the page give no `weeks`.

If a `writeDashboard` result has `missingWidgetTexts`, call `editDashboard` with the same `path` without
changes, translate the English texts of those widgets (`customWidgets[].texts.en`) into the listed
languages, keeping each `{placeholder}`, and call `editDashboard` with `widgetTexts` =
{ "<widget id>": { "<code>": { "<key>": "<text>", ... } } }.

Do not mention in the notes the data or the sports that the `settings` of the reply exclude. This
rule applies also to data that another tool showed earlier in this chat.

Use only numbers of the digest. **Never invent, interpolate or estimate missing values.** If a value
is missing, write "n/a". If a call fails, say which one and why in one line.
If `estimatedLoads` is more than 0, say that a part of the load is an estimate from heart rate. Do
not compare a week with `partial: true` with whole weeks.

Do not write or change the page yourself. Settings need a page from the template,
or a page designed with layout freeform that has a `garmin-settings` block.

Automatic refresh: call `scheduleDashboardRefresh` without arguments. If its `pages` do not have
the `path` of the page, ask me once whether to update the page automatically. If your client has a
tool for questions with choices, use it: "No" (the default), every day at 07:00, weekdays at 07:00,
every Monday at 07:00. Say that I can also tell you when in my own words, in any language, for
example "Monday and Thursday at 18" or "the first day of each month at 8". If `scheduled` is true,
the schedule is for all the pages: offer `cron`, in words, as the first choice after "No". Say that
each automatic refresh replaces the data and removes the coach notes, and that the computer must be
on. On a yes, turn the answer into a cron expression and call `scheduleDashboardRefresh` with `cron`
and the `path` of the page. Tell me the schedule and the `next` runs of the reply in my language, in
one line. If its `pages` already have the `path`, do not ask: tell me in one line, in my language,
the schedule in words and the first `next` run, and that I can ask you to change or stop it.

Finish with two lines in chat: the path of the page with the command to open it (`open` on macOS,
`xdg-open` on Linux, `start` on Windows), and the settings that the page keeps. Later updates keep
the settings: for a page with another file name, ask your assistant to update that file.
If the last reply has `missingProfileLanguage`, add one line: my Garmin profile uses that language,
the page has no texts in it and shows English, and the `dashboard-language` prompt adds the language.
