# Commands

The server is also a command for a terminal. Without arguments, it starts the MCP server on stdin
and stdout, as your MCP client starts it. With a command, it does one task, prints the result and
stops. It does not start the MCP server.

- [Run a command](#run-a-command)
- [info](#info)
- [doctor](#doctor)
- [refresh](#refresh)
- [schedule](#schedule)
- [--version and --help](#--version-and---help)
- [Exit codes](#exit-codes)

## Run a command

```bash
npx -y @indaco/garmin-personal-mcp@latest <command>
```

After `npm install -g @indaco/garmin-personal-mcp`, the command is shorter:

```bash
garmin-personal-mcp <command>
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
  info                                show the version, the settings and where the files are
  doctor                              test the API key, the folders and the schedule
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

`info` shows the version, the settings and where the server keeps its files:

```text
garmin-personal-mcp 0.8.1
Node.js:      v22.12.0 on darwin
API host:     https://personal.connectapi.garmin.com
API key:      from the key file
Key file:     ~/.config/garmin-mcp/api-key (found)
Data folder:  ~/workspace/garmin-data (found)
  .FIT files: 42
  pages:      garmin-dashboard-coach.html, garmin-dashboard.html
  exercises.json: found
  dashboard-cache.json: found
  widgets.json: missing
  auto-refresh.json: found
Server log:   ~/.cache/garmin-personal-mcp/garmin-personal-mcp.log
Refresh log:  ~/.cache/garmin-personal-mcp/refresh.log
Schedule:     Automatic refresh "0 7 * * *" with launchd, next: 2026-11-04 07:00, ...
```

- `API key` says where the key comes from. When `GARMIN_PERSONAL_API_KEY` is set, the key comes
  from the variable. When it is not set, the key comes from the key file.
- `info` never reads or shows the key. It shows your home folder as `~` (your user folder on
  Windows), so that you can share the output without your user name. A path outside the home
  folder stays as it is.
- `info` always shows `Key file`, because the automatic update reads the key only from that file.
- `pages` are the `.html` files in the data folder. [The data folder](tools.md#the-data-folder)
  tells what each file has.
- `Schedule` is the first line of [`schedule`](#schedule). When `auto-refresh.json` is damaged,
  this line gives the error.
- A file or a folder that is missing is not an error. The server makes them when it needs them.
- `info` does not connect to the network. To test the key, see
  [Test the key](troubleshooting.md#test-the-key).

## doctor

`doctor` tests the setup and tells how to fix what fails:

```text
ok      Key file: ~/.config/garmin-mcp/api-key
failed  API key: Token request failed: HTTP 401 (...) - the personal API key is incorrect, expired or revoked. ...
ok      Data folder: ~/workspace/garmin-data
ok      Log folder: ~/.cache/garmin-personal-mcp
ok      Schedule: Automatic refresh "0 7 * * *" with launchd, next: 2026-11-04 07:00, ...
1 check failed.
```

- `Key file` is missing without a problem only when `GARMIN_PERSONAL_API_KEY` is set and no schedule
  is on, because the automatic update reads only the key file. On macOS and Linux, other users must
  not be able to read the file. On Windows, `doctor` does not check this.
- `API key` sends the key to Garmin in a token request. This is the only network call. `doctor`
  never shows the key or the token.
- `Data folder` and `Log folder` make a test folder and remove it. A missing folder is not an error
  when the server can make it.
- `Schedule` fails when the job is missing from the system scheduler, or when the last run could not
  update a page.

`doctor` runs on macOS, Linux and Windows. The Windows steps are not tested.

## refresh

```bash
npx -y @indaco/garmin-personal-mcp@latest refresh                              # garmin-dashboard.html
npx -y @indaco/garmin-personal-mcp@latest refresh garmin-dashboard-coach.html  # another page
```

`refresh` updates a dashboard page with new data, one time, as `training-dashboard-update` does. It
keeps the layout, the custom widgets, the languages and the page settings. A relative path is in
the data folder. It needs the API key, from `GARMIN_PERSONAL_API_KEY` or from the key file.

The job of the automatic update runs `refresh --auto`. It updates the pages that have a schedule,
only when a run time was missed. Do not run it yourself.

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

The output gives the schedule, the next updates, the pages, the last run and the log. [Update the
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

| Code | Meaning                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | the command worked                                                                                                                                          |
| `1`  | the command failed, and the error is on stderr. `refresh` also gives 1 when a page failed. `doctor` gives 1 when a check failed, with the checks on stdout. |

A word or a flag that is not a command prints the error and the help on stderr and gives 1. It does
not start the MCP server.
