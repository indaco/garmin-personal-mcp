Update my Garmin **training + recovery dashboard** with the new data (today is {{today}}). Use the
tools of the `garmin-personal` MCP server. Answer in my language.

1. Call `writeDashboard` with {{weeksArgument}}{{pathArgument}}, without `layout` and without
   `page`. The server keeps the page with its layout, widgets and languages, and replaces only its
   data. A page from an older template gets the new template and keeps all of these. If there is no
   page yet, the server writes one from the template.
2. Write at most 5 coach notes from the digest of the reply. Each note names a specific number of the
   digest. Training suggestions only, no medical advice. Plain text, in my language.
3. Call `writeDashboard` again with the same `weeks`{{pathArgument}} and the `notes`.
4. If the reply lists `languages` with `missing` texts, translate them as the `dashboard-language`
   prompt says, and call `editDashboard`{{pathWith}} to save them.

Use only numbers of the digest. **Never invent, interpolate or estimate missing values.** If a value
is missing, write "n/a". If a call fails, say which one and why in one line.

If the reply has `missingProfileLanguage`, add one line: my Garmin profile uses that language, the
page shows English, and the `dashboard-language` prompt adds the language.

Finish with two lines in chat: the period that the dashboard covers now, with the number of new
activities (`sync.newActivities`), and anything that was missing. If `sync.failedDays` is more than
0, name the dates in `sync.failedDates`. If `sync.failedSections` is not empty, name those sections
(HR zones, fitness age, HRV) and say that they show as "n/a".
