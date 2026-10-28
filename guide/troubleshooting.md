# Problems and solutions

| Problem                                  | Solution                                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The server does not start                | Make sure that Node.js is version 22 or later: `node --version`.                                                                                                                                                                          |
| Claude Desktop does not find `npx`       | GUI apps do not read your shell profile. Use the absolute path of `npx` (`which npx`) as the `command`.                                                                                                                                   |
| Changes have no effect                   | The client keeps the old server process. Restart the client: a new Claude Code session, or quit and start Claude Desktop again.                                                                                                           |
| `Token request failed: HTTP 401/403`     | The key is incorrect, expired or revoked. Create a new key. The error shows the Content-Type and the body from Garmin.                                                                                                                    |
| An endpoint answers 400                  | A query parameter has a different name. Use `garminGet` with the correct query string.                                                                                                                                                    |
| `Settings need a page from the template` | The page is a `freeform` page that the assistant designed. It cannot keep settings. Give the settings with a new page from the template: `layout` = `preset`.                                                                             |
| You need more details                    | Read the server log: `~/.cache/garmin-personal-mcp/garmin-personal-mcp.log`. Claude Desktop also writes `~/.config/Claude/logs/mcp-server-garmin-personal.log` (Linux) or `~/Library/Logs/Claude/mcp-server-garmin-personal.log` (macOS). |

## Test the key

This command shows only the HTTP status. `200` means that the key is correct:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token' \
  -H "Authorization: ApiKey $(cat ~/.config/garmin-mcp/api-key)"
```

## Test the server

The server must answer with one JSON line:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | npx -y @indaco/garmin-personal-mcp@latest
```
