# Security Policy

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

The README section "Security" describes how the server protects the key, the token and your data.
