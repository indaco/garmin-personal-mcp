# Security Policy

## How the server protects your data

- **API key**: the server reads the key from an environment variable or from a file. Give the
  file the permission `600`, so that only you can read it. The server sends the key only to the
  Garmin token endpoint.
- **Access token**: the server keeps the token in memory only. It never writes the key or the
  token to the log, and no tool returns them.
- **Ids**: tool results leave out your Garmin user id, name and profile image, and the ids of
  your devices and daily records. This applies also to `raw` answers and to `garminGet`.
- **Read-only**: the server sends only GET requests to the Personal API. It sends one POST request
  to get the token.
- **Exercise catalogue**: the server gets the catalogue from `connect.garmin.com` without your
  token.
- **Dashboard page**: a page from the template has a Content-Security-Policy. It blocks the
  requests that the page and its custom widgets send in the background with fetch or
  XMLHttpRequest, and images, scripts and styles from the web. It does not cover WebRTC
  connections, and it cannot stop code that opens another web address. Add only custom widgets
  that you asked for. A freeform page is code that the assistant writes. The prompt asks for a
  policy and for a Chart.js tag with a hash. The server does not check this code, so a freeform
  page can have no policy and can load any script from the web. A freeform page from an older
  version has no policy until you build it again.
- **Dashboard in the chat**: each tool tells the client that only the assistant can call it (MCP
  Apps visibility `model`). A client that obeys this rule does not let the page in the chat, or a
  custom widget in it, call a tool.
- **Key file**: `setup` reads the key from a hidden prompt or from stdin, never from an argument,
  because a shell keeps its arguments in the history. It saves the file so that only you can read
  it: mode 600 on macOS and Linux, an ACL with `icacls` on Windows. An administrator of the computer
  can still read it. When `icacls` fails, the key is saved and the output gives the command to run.
- **Local data**: the data folder has your .FIT files, the dashboard cache and the page, with your
  health data. A .FIT file can have your GPS track. The server creates these files so that only you
  can read them: mode 600 in folders of mode 700 on macOS and Linux. A file that exists keeps its
  mode. On Windows, the files get the access of their folder. On macOS and Linux, a new page with
  the `shared` setting (a page for your coach) gets mode 644, so that other users of the computer can
  read it, for example through a shared folder or a web server. A folder that the server makes stays
  700, so put the page in a folder that others can already open. To share another page in this way,
  give it mode 644 yourself. `.gitignore` excludes `api-key`,
  `*.fit` and `*.zip` files.
- **Paths**: `garminGet` accepts only a relative API path. It refuses a full URL and `..`, so
  the token goes only to the Personal API host.
- **Revoke the key**: you can revoke the key at any time on the Garmin Connect page where you
  created it.

## Reporting a Vulnerability

Report a vulnerability in private through GitHub:
[open a draft security advisory](https://github.com/indaco/garmin-personal-mcp/security/advisories/new).

Do not open a public issue, pull request or discussion for a possible vulnerability.

Give these details when you have them:

- the server version and your MCP client
- the steps to reproduce the problem, or a proof of concept
- what an attacker can get, for example the API key, the access token or personal data

Do not send your own API key, access token or health data in the report.

## What to Expect

- an acknowledgement in 7 days or less
- a fix, or a decision about the report, before the advisory is published
- credit in the advisory, if you want it

## Scope

The server handles a personal API key, an access token and personal health data. These are
examples of problems in scope:

- the key or the token goes to a log, to stdout, to a tool result or to a host other than Garmin
- a tool argument makes the server send the token to a different host
- the server reads or writes a file other than: the key file, the log, the files in the data
  folder, a dashboard page at the path that a tool or a command gets (an `.html` file, the file
  that it links to, and its `.bak`), and the job of the automatic refresh (a launchd plist, a
  crontab line, or a Task Scheduler task and its script). A write also makes a temporary file next
  to the file that it writes, for a short time. `doctor` also makes and removes an empty test
  folder, in the data and log folders or in their nearest parent that exists
- the server sends a request that changes data in Garmin Connect
