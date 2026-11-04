# Step-by-step setup in Claude Desktop

This page connects the server to Claude Desktop without a terminal, and shows your training
dashboard. For other clients, see the [quick start](../README.md#quick-start).

You need:

- A computer with macOS or Windows. The Windows steps are not tested.
- A Garmin Connect account with access to the
  [Personal API](https://developer.garmin.com/gc-developer-program/personal/).

## 1. Install Node.js

1. Go to <https://nodejs.org>.
2. Download the LTS installer for your computer.
3. Open the installer and accept the default settings.

Claude Desktop uses Node.js to start the server. You do not open Node.js yourself.

## 2. Create a Garmin API key

1. Log in to Garmin Connect in a web browser.
2. Open <https://connect.garmin.com/app/settings/personalApiToken>.
3. Select _Create Key_ and accept the terms.
4. Select the expiry (1 year at most), then select _Create_.
5. Copy the key into a note. Garmin shows the key **only one time**.

## 3. Install Claude Desktop

Download Claude Desktop from <https://claude.ai/download>. Install it and log in.

## 4. Add the server to the configuration file

1. In Claude Desktop, select Settings → Developer → _Edit Config_.
2. Find the file `claude_desktop_config.json` in Finder (macOS) or File Explorer (Windows).
3. Open the file with TextEdit (macOS) or Notepad (Windows).

If the file is empty or has only `{}`, replace all the text with this text:

```json
{
  "mcpServers": {
    "garmin-personal": {
      "command": "npx",
      "args": ["-y", "@indaco/garmin-personal-mcp@latest"],
      "env": { "GARMIN_PERSONAL_API_KEY": "PASTE-YOUR-KEY-HERE" }
    }
  }
}
```

If the file has other keys, such as `preferences`, add `mcpServers` after them. Put a comma before
it:

```json
{
  "preferences": {
    "...": "keep this part as it is"
  },
  "mcpServers": {
    "garmin-personal": {
      "command": "npx",
      "args": ["-y", "@indaco/garmin-personal-mcp@latest"],
      "env": { "GARMIN_PERSONAL_API_KEY": "PASTE-YOUR-KEY-HERE" }
    }
  }
}
```

Then:

1. Replace `PASTE-YOUR-KEY-HERE` with your key. Keep the quotes.
2. Save the file.

Copy and paste the text. Do not type it: TextEdit can change straight quotes to curly quotes.

This file keeps your key as plain text, and the
[automatic dashboard update](dashboard.md#update-the-dashboard-on-a-schedule) cannot read it there.
If you can use a terminal, keep the key in a file that only you can read
([setup](cli.md#setup)):

1. Open Terminal (macOS) or Command Prompt (Windows).
2. Run `npx -y @indaco/garmin-personal-mcp@latest setup`.
3. Paste the key at the prompt. The key stays hidden, so you see nothing when you paste it.
4. In the configuration file, remove the `env` line. Also remove the comma at the end of the `args`
   line.
5. Save the file.

## 5. Restart Claude Desktop

Quit Claude Desktop fully, then start it again. To close the window is not sufficient. On macOS,
use Claude → _Quit Claude_. On Windows, also quit the tray icon.

## 6. Ask your first question

1. Start a new chat.
2. Ask "list my last 5 activities".
3. When Claude Desktop asks for permission for a garmin-personal tool, select **Allow always**.

The first start downloads the server, so the first reply can take longer.

## 7. See your training dashboard

**In the chat**: ask "show my training dashboard in the chat". The dashboard opens in the reply,
with boards and charts for your training and recovery. When the assistant writes a file instead,
ask again with "in the chat".

**As a page file**: in the **+** menu of the message box, select _garmin-personal_ →
_training-dashboard_. The assistant writes the page `garmin-dashboard.html` with coach notes, and
gives you its path. The page is in the folder `workspace/garmin-data` of your user folder. Open it
in a web browser. It works offline.

For a page for your coach, select the prompt _dashboard-setup_. The
[dashboard guide](dashboard.md) tells about the boards, the widgets, the themes and the languages.

## If it does not work

- Claude Desktop shows an error about the configuration file: check the commas and the quotes.
- The server does not start: open Settings → Developer and look at the status of garmin-personal.
- For other problems, see [Problems and solutions](troubleshooting.md).

## Limits of this setup

- The [automatic dashboard update](dashboard.md#update-the-dashboard-on-a-schedule) reads only the
  key file, not the configuration file. To use it, do the terminal steps at the end of
  [step 4](#4-add-the-server-to-the-configuration-file), then restart Claude Desktop. A key in the
  `env` line has priority over the key file, so remove that line.
- When the key expires, create a new key. If the key is in the configuration file, replace it there
  and restart Claude Desktop. If the key is in the key file, run
  `npx -y @indaco/garmin-personal-mcp@latest setup --force`. You do not restart.
