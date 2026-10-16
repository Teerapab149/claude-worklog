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
- For AI summaries, the `claude` command, signed in.

## Install

```bash
git clone https://github.com/Teerapab149/claude-worklog.git
cd claude-worklog
npm run setup
npm start
```

`npm run setup` reads your logs, finds the folders that hold your projects and the Claude accounts you have used, and asks what to call each account. The answers go into `config.local.json`, which git ignores. `npm start` then serves the page at http://localhost:4317.

To start it at every login:

```bash
npm run autostart:install
```

On Windows this puts a launcher in the Startup folder and adds Worklog to the Start menu. On macOS it uses launchd and on Linux a systemd user service. Undo it with `npm run autostart:uninstall`.

## Claude Code hooks

```bash
npm run install-hooks
```

This adds three hooks to `~/.claude/settings.json` and backs the file up to `data/backups` first. They apply to every account on the machine, from the next session you open.

- `PreToolUse`: before Claude edits a file that another session edited in the last 30 minutes, the first attempt is stopped with a note saying who edited it and when. Claude rereads the file and tells you. The retry goes through.
- `SessionStart`: tells a new session about other sessions open in the same project and gives it the latest project summary.
- `SessionEnd`: asks the dashboard to read the session that just ended.

Each hook takes about 200 ms. If one fails it writes to `data/hook.log` and never blocks your work. Remove them with `npm run uninstall-hooks`.

## Privacy

- The page only accepts connections from this machine (`127.0.0.1`) and refuses requests addressed to any other host name.
- What it reads is stored in `data/index.db` in this folder and goes nowhere else.
- The one thing that leaves your machine is the AI summary, which sends part of a conversation to Claude through `claude -p` on your own account. Keys, tokens and passwords it can spot are masked first. Summaries use that account's quota. On first start it summarizes every session with new messages in the last 7 days (set with `summary.autoDays`), one at a time with Haiku, and it waits when every account is limited. Turn them off with `"summary": { "enabled": false }`.

## Resource use

The server takes about 80 MB of memory. It reads the logs only when a log file changes (at most once every 30 seconds) and picks up where it left off, so a scan takes about 0.1 seconds. An idle machine sees almost no CPU use.

## Configuration

Settings live in `config.local.json`. See [config.example.json](config.example.json).

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

If you change `roots` later, run `npm run scan -- --full` to regroup projects (existing AI summaries will be redone).

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

## License

[MIT](LICENSE)
