---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/app.js","public/styles.css"]
---

# Worklog dashboard

Scope: the whole local web app (public/index.html, app.js, styles.css): pages วันนี้, โปรเจค, บัญชี, ตั้งค่า, plus project and session detail. Visitor mode: Operate.

Audience and job: one developer with many projects and several AI accounts, glancing to choose the next task, or leaving the window open beside the Claude app, often at night. Success: pick the next task and get back into it within seconds.

Constraints: Thai interface, plain HTML/CSS/JS, no framework, light on memory, local fonts only (no outside requests), standard web controls.

Chosen direction: Thai rubberwood toys (seed 7d6fc0dd, assigned). Memorable moment: the account usage tubes, one painted tube per usage window filled with what is left (changed from the abacus at the user's request on 17 Oct 2026).

Unresolved: in-app editing of settings (the settings page is read-only for now); English later.

## Direction contract

THESIS: Each project is a rounded painted wooden block you can pick up; state is told by shape as well as colour. It refuses the grey dev dashboard with one accent and the cream editorial page.

OWN-WORLD: Light birch ground and a honey-wood rail with a carved bottom edge; walnut ink. Water-based toy paints, matte: sage, sky, butter, coral, lilac. Dark theme is walnut wood with the same paints dimmed. Every piece has a thick rounded edge and a 4 to 6 px darker "block depth" under it. Mitr for headings, Noto Sans Thai Looped and Nunito for text.

STORY: The visitor sees the three blocks worth picking up, reads one line of next step on each, and presses the coral ทำต่อ. Accounts, open sessions and overlap warnings sit beside it; everything else is one nav step away.

FIRST VIEWPORT: Left honey rail with logo and four nav pills. Main column: heading วันนี้ทำอะไรต่อดี, a tagged box holding three project blocks (colour band, shape icon, name, summary, next step, reason chips, account note, coral button), then a tagged box of other projects with stamps. Right column: tagged boxes for the account usage tubes, sessions open now, and the overlap warning when there is one.

FORM: Thai rubberwood toy workshop, candidate 7 of 7, seed key 7d6fc0dd. Raises: state by shape (emission rail), a tag on every section (dense Japanese web), stamped finished work that never disappears (ticket wallet), coral reserved for ทำต่อ only (orienteering), one 8 px grid with three radii (Crouwel). Signature interaction: tube fills ease from empty to their level on page load; the ทำต่อ button presses down 4 px into its edge.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
