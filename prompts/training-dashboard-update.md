Update my Garmin **training + recovery dashboard** with the new data since its last build (today
is {{today}}). Use the Garmin tools of the `garmin-personal` MCP server. Answer in my language.

## 1. Find the dashboard

- In Claude Code: the file `garmin-dashboard.html` in the current directory.
- In Claude Desktop or claude.ai: the dashboard artifact in this conversation.

If you cannot find the dashboard, build a new one with the build instructions at the end, and do
not continue with sections 2 and 3.

## 2. Get the new data

Find the data block between `/* garmin-data:start */` and `/* garmin-data:end */`. Build a new
dashboard with the build instructions at the end, and say why in chat, if one of these is true:

- the page has no such block;
- the block has no `v`, or its `v` is not {{dashboardVersion}}. The page is from older build
  instructions and does not have their newest features.

Call `getDashboardData` with `weeks` = {{weeks}}. The server keeps a local cache, so it asks Garmin
only for the days after its last call.

## 3. Update the page

- Replace the data block with the new `getDashboardData` result, without changes, plus
  `"v": {{dashboardVersion}}` and new `notes`. Write `<\/` for every `</` inside it.
- Write the coach notes again for the new numbers, as the build instructions say.
- Keep all other code, layout and styles unchanged. Do not write the page again from the start.
- In Claude Code, write the file in place. In Claude Desktop or claude.ai, update the artifact.

Finish with two lines in chat: the period that the dashboard now covers with the number of new
activities (`sync.newActivities`), and anything that was missing. If `sync.failedDays` is more than
0, name the dates in `sync.failedDates`.

## Build instructions

Use these only when sections 1 and 2 tell you to build a new dashboard. Their sections are B1 to B3.
If the old data block has a `weeks` value, use it in B1. The periods then come from the
`getDashboardData` result (`start`, `end`, `prevStart`, `prevEnd`), not from the dates in B1.

{{build}}
