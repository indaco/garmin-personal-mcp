# Security Policy

## How the server protects your data

- **API key**: the server reads the key from an environment variable or from a file. Give the
  file the permission `600`, so that only you can read it. The server sends the key only to the
  Garmin token endpoint.
- **Access token**: the server keeps the token in memory only. It never writes the key or the
  token to the log, and no tool returns them.
- **Read-only**: the server sends only GET requests to the Personal API. It sends one POST request
  to get the token.
- **Exercise catalogue**: the server gets the catalogue from `connect.garmin.com` without your
  token.
- **Dashboard page**: the page has a Content-Security-Policy. It blocks the requests that the page
  and its custom widgets send in the background with fetch or XMLHttpRequest, and images, scripts
  and styles from the web. It does not cover WebRTC connections, and it cannot stop code that opens
  another web address. Add only custom widgets that you asked for.
- **Local data**: the data folder has your .FIT files. A .FIT file can have your GPS track, so
  keep the data folder private. `.gitignore` excludes `api-key`, `*.fit` and `*.zip` files.
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
- the server reads or writes a file other than the key file, the log and the files in the data folder
- the server sends a request that changes data in Garmin Connect
