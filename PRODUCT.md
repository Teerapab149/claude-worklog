# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: one developer who runs many projects at once through AI coding tools (Claude Code and Codex desktop apps), often across two or more Claude accounts that hit usage limits at different times. They do not use a terminal. The product is designed for this person first; other people with the same habits (several projects, several accounts) should be able to use it as is.

They use Worklog in three ways, all confirmed:
- a quick look, for example when a usage limit resets, to decide which project to pick up next, then close it;
- left open beside the Claude app for long stretches;
- often at night, in a dim room.

## Product Purpose

Worklog reads the session logs that Claude Code and Codex already keep on the computer and answers, at a glance: where did each project stop, which account did it, what should I do next, and is another session touching the same files. Success is that the person can choose their next task and get back into it within a few seconds, without rereading old chats.

## Positioning

It works from the local logs of several tools and several accounts together, so it sees work that no single tool or account can show on its own. Everything runs on the person's own machine; nothing is uploaded except the optional AI summaries, which go through the person's own Claude account.

## Operating Context

- Opened from a desktop shortcut as its own app window (Edge or Chrome app mode); closing the window stops it.
- Sits next to the Claude and Codex desktop apps. Picking work back up means finding a session in the app's sidebar or pasting a prompt into a new session.
- Optional Claude Code hooks warn a session before it edits a file another session just edited.

## Capabilities and Constraints

- Pages: a ranked "what to do next" list with reasons, account and limit status, open sessions, overlap warnings, project list, project timeline, session detail with summary, last prompt, last reply, edited files, and how to continue.
- AI summaries per session and per project (done, in progress, next steps, waiting on, deadlines); they use the person's Claude quota.
- Plain HTML, CSS and JavaScript served by a small Node server; no framework and no external packages. Must stay light on memory and CPU.
- Localhost only. No accounts, no login.
- Interface language: Thai only for now. English may come later, so text should not be baked into images.
- Settings page edits project folders, exclusions, account names, AI summaries and overlap warnings in the app.
- A Windows installer (Setup.exe with its own Node) is built by GitHub Actions for each release.
- A first-run setup page in the app, shown once after a fresh install.

## Brand Commitments

- Name: Worklog.
- Writing rule: plain, natural Thai the way a person writes it. No emoji or decorative symbols in the interface, no middle dot, arrow or em dash as separators, no "+" in place of "และ", no bold on every line.

## Evidence on Hand

- Real local data from the developer's own machine is used for testing, but it is private and must never appear in screenshots, docs or the public repo. There are no testimonials, user counts or benchmarks; do not invent any.

## Product Principles

- Answer "what next" first; everything else is one step away.
- Show the reason behind every suggestion, so the person can trust or overrule it.
- Calm enough to leave open all day and at night.
- Never get in the way of the work itself: light, local, quiet.

## Accessibility & Inclusion

Eye comfort is a stated need: long sessions and night use, so contrast must be readable without glare, and a comfortable dark theme matters as much as the light one. Thai text needs a font and line height that render Thai well.
