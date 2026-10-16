# Worklog

[ภาษาไทย](README.md)

Worklog reads the Claude Code and Codex logs already on your computer and serves a local web page that shows where each project stopped, which account did the work, and what to pick up next. It is meant for people who keep several projects going at once, switch between accounts when one hits its usage limit, or use both Claude Code and Codex.

Everything runs on your machine. There is no outside server and nothing to sign up for.

## What it does

- What to do next: Projects are ranked by how the last session ended (cut off by a usage limit, interrupted), upcoming deadlines, how recently they were touched and whether they are waiting on someone. Every card says why it got its place.
- Which account to use: It reads when each account's limit resets and suggests the account to continue with.
- Picking work back up: For a session opened in the desktop app it names the session to find in the app's sidebar. For a terminal session it gives the resume command. Every card also has a prompt you can paste into a new session, with the summary of the old one, for when you have to change accounts.
- AI summaries: Each session and project is summarized: what is done, what is still open, the next step and any deadlines mentioned.
- Overlapping work: It flags two sessions editing the same file close together, and several sessions open in one project.
- Claude Code hooks (optional): Claude is warned before editing a file another session just edited, and a new session is given the latest summary of its project.

## Requirements

- Node.js 24 or newer. It uses the built in `node:sqlite`, so there are no packages to install.
- Claude Code or Codex, already used on this computer.
- For AI summaries, the `claude` command signed in, or an API key for Gemini, Groq or OpenRouter, or Ollama on this machine.

## Install

### Windows, without a terminal

1. Download `Worklog-Setup-<version>.exe` from the latest [release](https://github.com/Teerapab149/claude-worklog/releases).
2. Double-click it. If Windows shows "Windows protected your PC", press More info and then Run anyway (the file is not signed yet).
3. Choose whether to add a desktop icon and whether to install the Claude Code hooks, then press Install.

The installer brings its own Node, so nothing else needs installing, and it needs no administrator rights. It reads your logs to find your project folders and accounts; change them later on the settings page. Settings and data live in `%LOCALAPPDATA%Worklog` and stay there through updates and uninstall; delete that folder if you no longer want them. Uninstall from Apps in Windows Settings.

### From source

```bash
git clone https://github.com/Teerapab149/claude-worklog.git
cd claude-worklog
npm run setup
npm run shortcut:install
```

`npm run setup` reads your logs, finds the folders that hold your projects and the Claude accounts you have used, and asks what to call each account. The answers go into `config.local.json`, which git ignores.

`npm run shortcut:install` puts a Worklog icon on the Desktop and in the Start menu (Windows only for now). Double click it and Worklog opens in a window of its own through Edge or Chrome, with no tabs or address bar. Clicking it again while it is open brings the same window forward. About 10 seconds after you close the window everything stops, and nothing is left running. Remove the icons with `npm run shortcut:uninstall`. For a title bar in the page's own colour, press "ติดตั้งเป็นแอป" (install as an app) once on the settings page, then close the window and open it again from the icon. Elsewhere, `npm run app` opens the same window, or run `npm start` and visit http://localhost:4317 in any browser.

To keep the server running all the time instead, for example so AI summaries carry on in the background:

```bash
npm run autostart:install
```

On Windows this puts a launcher in the Startup folder. On macOS it uses launchd and on Linux a systemd user service. Undo it with `npm run autostart:uninstall`. While that server runs, the icon only opens a window, and closing the window leaves the server running.

## Claude Code hooks

```bash
npm run install-hooks
```

This adds three hooks to `~/.claude/settings.json` and backs the file up to `data/backups` first. They apply to every account on the machine, from the next session you open.

- `PreToolUse`: before Claude edits a file that another session edited in the last 30 minutes, the first attempt is stopped with a note saying who edited it and when. Claude rereads the file and tells you. The retry goes through.
- `SessionStart`: tells a new session about other sessions open in the same project and gives it the latest project summary.
- `SessionEnd`: asks the dashboard to read the session that just ended.

The same command also sets Claude Code's status line, unless you already have one. The status line receives how much of the 5-hour and weekly limits is used (Pro and Max accounts only), and Worklog stores it to draw the usage tubes on the accounts page, because Claude Code's logs never record it. Codex writes its usage into its logs already. If you keep your own status line, Worklog leaves it alone, and Claude percentages stay unknown.

The status line only runs in Claude Code in a terminal; the Claude desktop app does not call it. If you only use the desktop app, check its Usage page, then on the Worklog accounts page press "บอกว่าบัญชีนี้ติด limit" (mark this account as limited), pick the window (weekly or 5 hours) and when it resets. Worklog stops suggesting that account until then, or until you press "ใช้ได้แล้ว" (available again).

Each hook takes about 200 ms. If one fails it writes to `data/hook.log` and never blocks your work. Remove them with `npm run uninstall-hooks`.

## Privacy

- The page only accepts connections from this machine (`127.0.0.1`) and refuses requests addressed to any other host name.
- What it reads is stored in `data/index.db` in this folder and goes nowhere else.
- An installed copy asks GitHub whether a newer version exists each time it opens and every 6 hours while open; the request carries none of your data. When there is one, it downloads the installer from this repository's release, checks it against the SHA-256 GitHub publishes, and installs it after you close the window. Turn this off on the settings page. A copy run from source never asks and never updates itself.
- Apart from that, the one thing that leaves your machine is the AI summary, which sends part of a conversation to Claude through `claude -p` on your own account, or, if you pick "API แบบ OpenAI" (an OpenAI-style API) on the settings page, to the provider you chose instead (Gemini, Groq, OpenRouter or an address you enter). With Ollama nothing leaves the machine. API keys are kept in `config.local.json` on this machine, and the page never receives a key back. Some free tiers may use what you send to improve their models; read the provider's terms first. Keys, tokens and passwords it can spot are masked first. Summaries use that account's quota. On first start it summarizes every session with new messages in the last 7 days (set with `summary.autoDays`), one at a time with Haiku, and it waits when every account is limited. Turn them off with `"summary": { "enabled": false }`.

## Resource use

While the app is open the server takes about 70 MB of memory and the app window about 170 MB (GPU and unneeded browser features are turned off). Once the window is closed it uses nothing. While open, the server reads the logs only when a log file changes (at most once every 30 seconds) and picks up where it left off, so a scan takes about 0.1 seconds.

The Claude Code hooks keep working while the app is closed, since they read the database themselves. AI summaries only run while the app is open.

## Configuration

The settings page in Worklog edits the common ones: project folders, excluded folders, account names, AI summaries (Claude Code CLI or an OpenAI-style API, with a button to test the key) and overlap warnings. Saving applies them at once, except turning AI summaries back on, which starts the next time Worklog opens. Changing project folders regroups projects without reading every log again.

All settings live in `config.local.json`; anything the page does not show can be edited there. See [config.example.json](config.example.json).

| Setting | Meaning |
|---|---|
| `roots` | Folders that hold projects. Each folder directly inside is one project. Sessions outside every root are grouped by their own folder. |
| `exclude` | Folders to leave out, such as test fixtures. |
| `projectNames` | Display names, keyed by folder name. |
| `accounts` | Display names, keyed by account id. |
| `overlap.windowMinutes` | How close two edits must be to count as overlapping. Default 30. |
| `overlap.preToolUse` | What the hook does on an overlap: `deny_once` stops the first edit, `ask` lets you decide, `context` only tells Claude, `off` does nothing. |
| `summary.enabled` | Turns AI summaries on or off. |
| `summary.model` | Model used for summaries. Default `haiku`. |
| `summary.autoDays` | Sessions with new messages in this many days are summarized on their own. Older ones when you ask from the page. |
| `claudeDir`, `codexDir` | Where each tool keeps its data. Defaults to `~/.claude` and `~/.codex`. |
| `port` | Port for the page. Default 4317. |
| `app.browser` | Path to the browser used for the app window. Without it Edge is tried first, then Chrome. |

If you change `roots` in the file later, run `npm run scan -- --full` to regroup projects (existing AI summaries will be redone). Changing them on the settings page regroups on its own and keeps the summaries.

## Limitations

- The Claude Code and Codex log formats are not documented APIs. If a tool changes its format the readers may need work. They skip lines they cannot read instead of failing.
- Hooks exist for Claude Code only, not Codex yet.
- Start at login on macOS and Linux has not been tried on real machines yet. Please open an issue if it misbehaves.
- Cursor, Antigravity and other tools are not read yet.

## Development

```bash
npm test
```

Each tool's log reader lives in `src/sources/`. A new tool needs a reader that returns the same shape as the existing ones.

`node tools/build-installer.js` builds the installer and needs [Inno Setup 6](https://jrsoftware.org/isinfo.php); without it, it stops after preparing `dist/stage`. To release, set `version` in `package.json` and push a matching tag such as `v0.2.0`; GitHub Actions builds `Worklog-Setup-0.2.0.exe` and attaches it to the release.

## License

[MIT](LICENSE)
