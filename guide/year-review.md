# Year review

`getYearReview` gives the recap of a calendar year in the chat. Ask, for example, "give me my year
in review". The server reads its local cache. A day that the cache does not have is not a rest day:
the answer lists it in `coverage.missing`.

| Argument | Values                                               | Default                                      |
| -------- | ---------------------------------------------------- | -------------------------------------------- |
| `year`   | a year from 2000 to this year                        | this year; until 14 January, the year before |
| `path`   | a dashboard page: its sports and excluded data apply | `garmin-dashboard.html` in the data folder   |

A `path` to a page that does not exist is an error.

When a day of the year before today is missing, the server asks you in a form before it fetches the
activity list. It asks for at most 20 pages of the list, and it does not fetch HRV and resting HR. A
page that Garmin refuses can be asked for again. The cache keeps one range of days, so the first day
in the form can be in an earlier year. When the earlier days would need more than about 20 requests,
the fetch starts in the year itself. The form then names the earlier days that the cache no longer
covers after the fetch.

A dashboard update fetches only the days of the dashboard. It can drop the earlier days that a
review fetched: after an update of the server that changes the cache, or when the dashboard starts
more than one day after the last cached day. The next review shows the missing days and asks again.
A page with the [`yearReview` setting](dashboard.md#page-settings) shows the same recap in its
Year tab.

In the answer, `fill.asked` tells what it did:

| `fill.asked` | What the server did                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `notNeeded`  | no day before today is missing: no question and no request                                     |
| `yes`        | you said yes: it fetched the list. If this fails, it saves no activity: `fill.error` tells why |
| `no`         | you said no: no request                                                                        |
| `unasked`    | your client has no form: no request                                                            |
| `tooLarge`   | the days need more than about 20 requests: no question and no request                          |

A fetch stops at 20 requests and saves no activities when the days need more. `fill.error` then
tells if another try asks for fewer days, and the form of that try names the days that it drops.

After `tooLarge` for a year before this year, review a newer year first, then this one. Each yes
adds earlier days to the cache, so the next review needs fewer requests. This works only in a client
with a form.

When only today is missing, the server does not ask. A workout that came to Garmin after the last
update of the cache is then not in the recap, and its day can look like a rest day. `lastDayOpen` is
true in the answer when the last cached day is in the year: a later workout of that day can be
missing. For a recap of the current year with all workouts, update the dashboard first, but only
when no day before today is missing.

Claude Code shows this form (tested with 2.1.331). The MCP Inspector shows the forms of other tools
(tested with 2.16.0). The form of this tool in the MCP Inspector: not tested. Claude Desktop shows no
form (tested with 6.6395.1).

## year-review prompt

The assistant calls `getYearReview` and gives the year in a fixed order: the totals, the sports, the
months, the biggest month and week, the best 4 weeks, the most consistent month, the streaks, the
longest and the biggest session, the new bests of each running distance, the weekdays and the time
of day, and the HRV and the resting HR of each month. When days are missing, the answer names the
days that the recap covers, and the other days are "n/a". It says why nothing was fetched, and it
offers no other fetch. When `unlikelyTimes` is above 0, it says how many sessions have a time that
is not likely (over 12 h at under 1 km/h). This time and a load estimate from it do not count.

The argument `year` is optional: the calendar year, 2000 to this year. The default is this year, and
until 14 January the year before. A value under 2000 gives 2000, a value over this year gives this
year.

The argument `path` is optional: the dashboard page whose sports and excluded data apply, for
example `/mcp__garmin-personal__year-review 2025 garmin-dashboard-coach.html`. The default page
applies without it. The name of a page alone, or before the year, works too. Text that is not a
year is read as the page. When this page does not exist or is not a `.html` file, the answer names
it, says what the prompt takes, and asks you to correct it. It gives no review before that, so a
mistyped name does not show the data that the page excludes. After a year, Claude Code cuts a page
name at its first space: name such a page in the chat.
