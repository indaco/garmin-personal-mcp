# Commands

The server is also a command for a terminal. Without arguments, it starts the MCP server on stdin
and stdout, as your MCP client starts it. With a command, it does one task, prints the result and
stops. It does not start the MCP server.

- [Run a command](#run-a-command)
- [info](#info)
- [doctor](#doctor)
- [setup](#setup)
- [refresh](#refresh)
- [schedule](#schedule)
- [--version and --help](#--version-and---help)
- [Exit codes](#exit-codes)

## Run a command

```bash
npx -y @indaco/garmin-personal-mcp@latest <command>
```

A command reads the same environment variables as the server (see
[Configuration](../README.md#configuration)). It reads them from your terminal, not from your MCP
client configuration. When your client configuration sets `GARMIN_DATA_DIR` or another variable,
set it in the terminal too:

```bash
GARMIN_DATA_DIR=/path/to/garmin-data npx -y @indaco/garmin-personal-mcp@latest info
```

`--help` lists the commands:

```text
Usage: garmin-personal-mcp [command]

Without a command, the MCP server starts on stdin and stdout.

Commands:
  info                                show the version, the settings, the pages and the schedule
  doctor                              test the API key, the folders, the data files and the schedule
  setup [--force]                     test the API key and save it in the key file
  refresh [page.html]                 update a dashboard page
                                      (default: <data-dir>/garmin-dashboard.html)
  refresh --auto                      update the pages that have a schedule
  schedule                            show the schedule
  schedule [daily|weekdays|weekly <day>] [HH:MM] [page.html]
                                      update a page automatically
  schedule "<cron>" [page.html]       the same, with a cron expression
  schedule off [page.html]            stop the automatic update
  -v, --version                       show the version
  -h, --help                          show this help

Run garmin-personal-mcp <command> --help to see the help of a command.
```

## info

`info` shows the version, the settings, where the server keeps its files, the last sync with Garmin,
the dashboard pages and the schedule:

```text
garmin-personal-mcp 0.15.0

Node.js:                v24.22.1 on darwin
API host:               https://personal.connectapi.garmin.com (default)
API key:                from the key file
Key file:               ~/.config/garmin-mcp/api-key (found, default)
Data folder:            ~/my-data (found, from GARMIN_DATA_DIR)
  .FIT files:           42
  last sync:            2026-11-20 18:12
  activities:           2025-11-21 to 2026-11-20
  HRV:                  2025-11-21 to 2026-11-20
  pages:                2
    - coach.html: updated 2026-11-20 18:12, by 0.14.0
    - garmin-dashboard.html: updated 2026-11-16 07:00, by 0.15.0, scheduled
  exercises.json:       found
  dashboard-cache.json: found
  widgets.json:         none
  auto-refresh.json:    found
Server log:             ~/.cache/garmin-personal-mcp/garmin-personal-mcp.log
Refresh log:            ~/.cache/garmin-personal-mcp/refresh.log
Schedule:               Automatic refresh "0 7 * * 1" with launchd
  last run:             2026-11-23 07:00, failed:
    - ~/my-data/garmin-dashboard.html: Network error obtaining token: fetch failed
  last success:         2026-11-16 07:00
  next:                 2026-11-30 07:00, 2026-12-07 07:00, 2026-12-14 07:00
```

- A setting is the default, or it comes from the variable that the line names. `info` reads the
  variables of the terminal: your MCP client can have other ones.
- `API key` says where the key comes from. When `GARMIN_PERSONAL_API_KEY` is set, the key comes
  from the variable. When it is not set, the key comes from the key file.
- `info` never reads or shows the key. It shows your home folder as `~` (your user folder on
  Windows), so that you can share the output without your user name. A path outside the home
  folder stays as it is.
- `info` always shows `Key file`, because the automatic update reads the key only from that file.
- `last sync` is the last time that the dashboard data was fetched. `activities` and `HRV` are the
  days that the cache has.
- `pages` are the `.html` files in the data folder, and the scheduled pages that are in another
  folder. Each line has the time of the last update and the version of the server that made it. A
  scheduled page that is gone shows as `missing`. A file that is not a page of the server shows as
  `not a dashboard page`.
  [The data folder](tools.md#the-data-folder) tells what each file has.
- `last run` is the last automatic update. A run with gaps in the data of Garmin is a success: the
  lines below it give the gaps. `last success` appears only after a run that failed.
- `info` cuts an error of the last run, because the rest can have data that you do not want to share.
  `schedule` and `doctor` show the full error. `info` cuts:
  - all the text after a status (`HTTP 502`) or after `Response is not JSON`.
  - all the text from ` (Content-Type`, in an error about the token.
  - the cause of a network error, in brackets, which can have the host or its address. Only its code
    stays (`ENOTFOUND`), when it has one.
- The times are in local time. A value that is missing or not correct shows as `n/a`.
- `last success` is `n/a` when the server does not know it, until the next success. The job of an
  older version does not save it, so it is not known after a failed run of that job. A success with
  a time in the future does not count, because the clock of the computer was ahead.
- When `auto-refresh.json` is damaged, `Schedule` gives the error.
- A `.json` file that shows `none`, or a data folder that is missing, is not an error. The server makes
  them when it needs them.
- `info` does not connect to the network. To test the key, see
  [Test the key](troubleshooting.md#test-the-key).

## doctor

`doctor` tests the setup and tells how to fix what fails:

```text
ok      Key file: ~/.config/garmin-mcp/api-key
failed  API key: Token request failed: HTTP 401 (...) - the personal API key is incorrect, expired or revoked. ...
ok      Data folder: ~/workspace/garmin-data
ok      Log folder: ~/.cache/garmin-personal-mcp
ok      Data files: readable
failed  Schedule: no run since 2026-11-16 07:00, expected 2026-11-23 07:00. The computer was perhaps off. If no update is in progress, update the pages with: npx -y @indaco/garmin-personal-mcp@latest refresh --auto
2 checks failed.
```

- `Key file` is missing without a problem only when `GARMIN_PERSONAL_API_KEY` is set and no schedule
  is on, because the automatic update reads only the key file. On macOS and Linux, other users must
  not be able to read the file. On Windows, `doctor` does not check this.
- `API key` sends the key to Garmin in a token request. It is the only network call, except for
  `Key of the schedule`. `doctor` never shows the key or the token.
- `Key of the schedule` appears only when a schedule is on, `GARMIN_PERSONAL_API_KEY` is set and the
  key file exists. The automatic update reads only the key file, so `doctor` also tests this key in
  a second token request.
- `Data folder` and `Log folder` make a test folder and remove it. A missing folder is not an error
  when the server can make it.
- `Data files` reads `exercises.json`, `dashboard-cache.json` and `widgets.json`. It fails on a file
  that it cannot read, or that the server cannot use. A missing file is not an error.
- `Schedule` gives the first problem that it finds:
  - The job is missing from the system scheduler, or its Node.js or server file is gone.
  - A scheduled page is gone.
  - The last run could not update a page. A page that was updated after that run, or that is no
    longer scheduled, does not count.
  - A run is more than 1 hour late, and a page was not updated since. The note on the page uses the
    same limit.
- A run with gaps in the data of Garmin does not fail. The line gives the pages and the gaps.
- The exit code is 1 when a check fails.

`doctor` runs on macOS, Linux and Windows, and CI tests it on each one.

## setup

```bash
npx -y @indaco/garmin-personal-mcp@latest setup          # a new key file
npx -y @indaco/garmin-personal-mcp@latest setup --force  # replace the key in the key file
```

`setup` asks for the key, tests it with Garmin and saves it in the key file (default
`~/.config/garmin-mcp/api-key`, or `GARMIN_API_KEY_FILE`). It makes the folder when it is missing.
At the end, it tells how to connect your MCP client.

- The key stays hidden when you paste it. You can also give it on stdin. `setup` does not take the
  key as an argument, because your shell keeps its arguments in the history.
- Only you can read the file: mode 600 on macOS and Linux, an ACL with `icacls` on Windows. As on
  each system, an administrator of the computer can still read it. When `icacls` fails, the key is
  saved and the output gives the command to run.
- When the key file exists, `setup` stops before it asks for the key. Garmin shows a key only one
  time, so `--force` loses the old key. A key file that appears while `setup` runs also stays, and
  the new key is not saved.
- When Garmin refuses the key (HTTP 401 or 403), the key is not saved and an old key stays.
- When the test fails for another reason, such as no network, the key is saved so that you do not
  lose it. The exit code is 1. Run [`doctor`](#doctor) later to test it.
- When `GARMIN_PERSONAL_API_KEY` is set, it has priority over the file. `setup` tells you. When you
  set `GARMIN_API_KEY_FILE` in the terminal, set it in your MCP client too.

`setup` runs on macOS, Linux and Windows, and CI tests it on each one.

## refresh

```bash
npx -y @indaco/garmin-personal-mcp@latest refresh                              # garmin-dashboard.html
npx -y @indaco/garmin-personal-mcp@latest refresh garmin-dashboard-coach.html  # another page
```

`refresh` updates a dashboard page with new data, one time, as `training-dashboard-update` does. It
keeps the layout, the custom widgets, the languages and the page settings. It removes the coach
notes, because old notes do not agree with the new data. To get new notes, run the
`training-dashboard-update` prompt. A relative path is in the data folder. It needs the API key,
from `GARMIN_PERSONAL_API_KEY` or from the key file.

The job of the automatic update runs `refresh --auto`. It updates the pages that have a schedule,
only when a run time was missed. Run it yourself only when [`doctor`](#doctor) tells you to.

## schedule

```bash
npx -y @indaco/garmin-personal-mcp@latest schedule daily 07:00
npx -y @indaco/garmin-personal-mcp@latest schedule weekdays 06:30
npx -y @indaco/garmin-personal-mcp@latest schedule weekly monday 08:00 garmin-dashboard-coach.html
npx -y @indaco/garmin-personal-mcp@latest schedule "0 18 * * 1,4"  # a cron expression
npx -y @indaco/garmin-personal-mcp@latest schedule              # show the schedule
npx -y @indaco/garmin-personal-mcp@latest schedule off          # stop all
npx -y @indaco/garmin-personal-mcp@latest schedule off garmin-dashboard-coach.html
```

`schedule` does what the `scheduleDashboardRefresh` tool does. Without a time, `daily`, `weekdays`
and `weekly` use 07:00. Without a day, `weekly` uses Monday. Without a page, `schedule` uses
`garmin-dashboard.html`. The page must exist, and the API key must be in the key file. All the pages
that update automatically use the same schedule.

A cron expression has 5 fields in local time: minute, hour, day of the month, month and weekday
(0 is Sunday), with numbers, lists (`1,4`), ranges (`1-5`) and steps (`*/6`). A file name ends in
`.html`. A relative path is in the data folder.

The output gives the schedule, the next updates, the pages, the last run and the log. After a run that
failed, it also gives the last success. The times are in local time. [Update the
dashboard on a schedule](dashboard.md#update-the-dashboard-on-a-schedule) tells how the job works on
each system.

## --version and --help

`--version` (or `-v`) prints the version. `--help` (or `-h`) prints the list above.

After a command, `--help` (or `-h`) prints the help of that command. The command does not do its
task, so `schedule off --help` does not stop the schedule:

```bash
npx -y @indaco/garmin-personal-mcp@latest schedule --help
```

## Exit codes

| Code | Meaning                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | the command worked                                                                                                                                                                                                   |
| `1`  | the command failed, and the error is on stderr. `refresh` also gives 1 when a page failed. `doctor` gives 1 when a check failed, with the checks on stdout. `setup` gives 1 when the key is not saved or not tested. |

A word or a flag that is not a command prints the error and the help on stderr and gives 1. It does
not start the MCP server.
