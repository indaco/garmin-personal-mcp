Add {{language}} to my Garmin training dashboard. Use the tools of the `garmin-personal` MCP server.

1. Call `editDashboard` with `englishTexts: true`{{pathArgument}}. If there is no dashboard,
   call `writeDashboard`{{pathWith}} first.
2. Translate every English text into {{language}}:
   - Keep each `{placeholder}` as it is.
   - A text with `|` has two forms, the singular and the plural. Keep the `|` and translate both.
   - Keep units (km, h, bpm, ms) and names (Garmin, Epley, Riegel, Foster, SWOLF, HRV) as they are.
3. Call `editDashboard` with `languages` = { "<code>": { "<key>": "<text>", ... } }{{pathArgument}}.
   The code is the language code, for example `de`, `fr` or `pt-BR`. Send at most 150 texts in one
   call.
4. If the reply lists `missing` texts for the language, translate them and call again.

Finish with one line in chat: the language code, and that the Language menu of the page shows the
language after a reload.
