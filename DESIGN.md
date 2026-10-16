---
name: Worklog
description: A local dashboard that tells one developer where each project stopped and what to pick up next.
colors:
  birch-ground: "#F4EEE4"
  honey-rail: "#E2C9A0"
  honey-rail-edge: "#C9A877"
  panel-cream: "#FFFDF8"
  panel-edge: "#E6DCCB"
  block-white: "#FFFFFF"
  block-line: "#EFE6D8"
  walnut-ink: "#3B2F2A"
  walnut-ink-2: "#6B5A4F"
  walnut-ink-3: "#76665B"
  sage: "#8DB596"
  sage-soft: "#DCEBDF"
  sage-ink: "#3F6A49"
  sky: "#8FBFE0"
  sky-soft: "#DCEBF6"
  sky-ink: "#2F5F80"
  butter: "#F2CF6B"
  butter-soft: "#FBEFC9"
  butter-ink: "#7A5A06"
  lilac: "#B9A6E0"
  lilac-soft: "#E9E2F6"
  lilac-ink: "#5A4590"
  coral: "#F09A84"
  coral-edge: "#D9785F"
  coral-ink: "#3A1E16"
  alert-soft: "#F1E1DC"
  alert-ink: "#8E3B33"
  walnut-ground-dark: "#231B17"
  walnut-rail-dark: "#3A2C22"
  walnut-panel-dark: "#2C221D"
  walnut-panel-edge-dark: "#19110D"
  walnut-block-dark: "#342923"
  walnut-block-line-dark: "#45372F"
  walnut-sunk-dark: "#261E19"
  linen-ink-dark: "#F1E7DA"
  linen-ink-2-dark: "#CDBDAD"
  linen-ink-3-dark: "#A39182"
  coral-dark: "#E8907A"
  coral-edge-dark: "#A85A47"
  alert-soft-dark: "#3E2824"
  alert-ink-dark: "#F0B0A4"
typography:
  display:
    fontFamily: "Mitr, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.25
  headline:
    fontFamily: "Mitr, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.3
  title:
    fontFamily: "Mitr, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Nunito, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  body-small:
    fontFamily: "Nunito, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Mitr, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.6
  meta:
    fontFamily: "Nunito, Noto Sans Thai Looped, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, Cascadia Code, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "12px"
  inner: "16px"
  md: "20px"
  block: "24px"
  lg: "28px"
  rail: "32px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "48px"
components:
  button-go:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.coral-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "10px 24px"
  button-soft:
    backgroundColor: "{colors.panel-cream}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-copy:
    backgroundColor: "{colors.block-white}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  section-tag:
    backgroundColor: "{colors.walnut-ink}"
    textColor: "{colors.birch-ground}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 16px"
  section-tag-alert:
    backgroundColor: "{colors.butter}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.pill}"
    padding: "4px 16px"
  tagged-box:
    backgroundColor: "{colors.panel-cream}"
    rounded: "{rounded.lg}"
    padding: "36px 24px 24px"
  project-block:
    backgroundColor: "{colors.block-white}"
    rounded: "{rounded.block}"
    padding: "16px 20px 20px"
  nav-item:
    textColor: "{colors.walnut-ink-2}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  nav-item-active:
    backgroundColor: "{colors.panel-cream}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.md}"
  chip:
    backgroundColor: "{colors.birch-ground}"
    textColor: "{colors.walnut-ink-2}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  chip-hot:
    backgroundColor: "{colors.butter-soft}"
    textColor: "{colors.butter-ink}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  search-field:
    backgroundColor: "{colors.block-white}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
  usage-tube:
    backgroundColor: "{colors.birch-ground}"
    rounded: "{rounded.pill}"
    height: "18px"
---

# Design System: Worklog

## Overview

**Creative North Star: "The Rubberwood Toy Workshop"**

Worklog is a shelf of painted wooden toys. Each project is a rounded block you could pick up, each section of the page is a box with a tag on its lid, and each account keeps its usage in painted tubes. The ground is pale birch, the navigation is a honey wood rail, the ink is walnut. At night the whole workshop turns to walnut wood and the same paints come back dimmed, because the person leaves this window open beside the Claude app for hours in a dim room.

The paints are matte and water based: sage, sky, butter and lilac. They identify things (a project, an account) and never decorate. Coral is not one of the identity paints; it belongs to a single action, ทำต่อ, so the eye always lands on the next thing to do. State is told twice, by shape as well as colour, so a glance works without colour vision and without reading.

Density is moderate. The first viewport answers what to do next with three blocks, and everything else sits one nav step away. The world rejects the grey developer dashboard with one accent colour, and it rejects the cream editorial page with serif headlines.

**Key Characteristics:**
- Birch and honey wood by day, walnut wood by night, one walnut ink throughout.
- Four identity paints assigned per project and per account, picked from the name so a colour never moves.
- Coral used for one control only.
- Every piece has a thick rounded edge and a darker block edge under it.
- Every section wears a tag on its top edge.
- Status read by shape first: circle, square, triangle, ring, dashed ring.

## Colors

A warm wood palette with four soft toy paints and one reserved coral; every paint comes as a trio of fill, soft wash and readable ink.

### Primary
- Coral Toy Paint (coral, with coral-edge under it and coral-ink on it): the ทำต่อ button and nothing else. In the dark theme it becomes coral-dark over coral-edge-dark.

### Secondary
- Sage, Sky, Butter and Lilac (each with a soft and an ink partner): identity paints. A project gets one from a hash of its name, an account gets one from its stored colour index, and the paint shows up as the block's top band, its edge, account dots, timeline segments and tube fills. Soft washes sit behind text; ink partners carry text on those washes.
- Sage also means healthy (account ready, pill on, stamped finished work, live pulse). Butter also means caution (overlap warnings, low tubes, the working pulse).

### Tertiary
- Alert Pair (alert-soft behind, alert-ink on top): errors, paused summaries, accounts that are low or waiting, settings that are off. It is a muted brick, deliberately not coral, so a problem never looks like the call to action.

### Neutral
- Birch Ground: the page and every sunken well (next step, chips, tube channel, live session rows).
- Honey Rail with Honey Rail Edge: the navigation rail and the edge under its pressable pieces.
- Panel Cream with Panel Edge: tagged boxes and the depth edge under them.
- Block White with Block Line: project blocks, rows, mini cards, the 2px line around them and dashed dividers.
- Walnut Ink, Walnut Ink 2, Walnut Ink 3: primary text, secondary text, faint marks such as placeholders, idle pegs and the no-summary ring.
- Dark theme: Walnut Ground, Walnut Rail, Walnut Panel and its edge, Walnut Block and its line, Walnut Sunk, and the three Linen inks replace their light partners one for one. Section tags flip to honey on walnut.

### Named Rules
**The One Coral Rule.** Coral appears on the ทำต่อ button only. No other control, chart, badge or warning may use it.

**The Problem Is Not The Button Rule.** Errors and warnings use the alert pair or butter, never coral, so a red-looking thing on screen is never mistaken for the action.

**The Paint Is Identity Rule.** Sage, sky, butter and lilac name a project or an account. Assign them from the name or account index so they stay put between visits; never pick one for looks.

## Typography

Display Font: Mitr (with Noto Sans Thai Looped, system-ui)
Body Font: Nunito for Latin with Noto Sans Thai Looped for Thai (system-ui fallback)
Mono Font: system monospace (ui-monospace, Cascadia Code, Consolas)

Character: Mitr is round and sturdy like a stamped toy label; Nunito and the looped Thai face are soft and friendly at reading sizes and hold Thai vowels well at a 1.65 line height. All fonts are self-hosted, nothing loads from outside.

### Hierarchy
- Display (Mitr 500, 36px, 1.25; 28px under 820px): the page heading, for example วันนี้ทำอะไรต่อดี.
- Headline (Mitr 500, 21px, 1.3): the project name on a block, cut to one line.
- Title (Mitr 500, 19px, 1.3): group headings inside a box; 17px Mitr for nav items and the ทำต่อ label (600).
- Body (Nunito and Looped 400, 16px, 1.65): running text; 14.5px for block ledes, summaries and help text.
- Label (Mitr 500, 13 to 14px): section tags, buttons, counts, the small heading above the next step.
- Meta (13 to 13.5px, Walnut Ink 2): times, account notes, sub lines.
- Mono (13 to 13.5px): file paths and commands only.

### Named Rules
**The Mitr Speaks Rule.** Anything that names, labels or presses is set in Mitr; anything you read is set in Nunito and Looped.

**The Mono Is For Machines Rule.** Monospace appears only on file paths and commands the person will paste. Never on numbers, times or labels; numbers use tabular figures in the text face.

## Layout

A two column shell: a 240px sticky honey rail on the left and the main area on the right, 24px apart, inside 24px of padding, capped at 1600px. Today and detail pages split the main area again into a flexible column and a 320px side column (accounts, open sessions, overlaps). Under 1180px the side column drops below. Under 820px the rail becomes a top bar with the nav pills scrolling sideways, padding tightens to 16px, and boxes go to 16px inner padding.

Spacing follows a 4px base used mostly in steps of 4, 8, 12, 16, 24 and 48. Boxes stack 24px apart; pieces inside a box sit 8 to 16px apart. Project blocks sit in an auto-fit grid with a 210px minimum, mini cards in an auto-fill grid with a 200px minimum.

## Elevation & Depth

Depth is physical, not ambient. Each raised piece sits on a solid edge offset straight down in a darker tone of its own wood, plus a soft warm blur, the way a painted block sits on a table. Pressing a button pushes it down onto that edge. Wells (next step, chips, tube channel) are sunk into the birch instead of raised.

### Shadow Vocabulary
- Block Depth (`box-shadow: 0 6px 0 var(--panel-edge), 0 12px 24px rgb(90 64 40 / 8%)`): tagged boxes and loading skeletons. Dark theme blur is `rgb(0 0 0 / 28%)`.
- Small Depth (`box-shadow: 0 4px 0 var(--panel-edge), 0 8px 16px rgb(90 64 40 / 6%)`): the back pill.
- Paint Edge (`box-shadow: 0 6px 0 var(--c-soft), 0 10px 20px rgb(90 64 40 / 6%)`): project blocks, edged in their own paint's soft wash.
- Rail Edge (`box-shadow: 0 6px 0 var(--rail-edge), 0 12px 24px rgb(90 64 40 / 10%)`): the rail; the active nav pill uses `0 4px 0` of the same edge.
- Press Edge (`0 4px 0` coral-edge on ทำต่อ, `0 3px 0` on soft and copy buttons): collapses to zero with a matching translateY when pressed.
- Tube Channel (`inset 0 2px 0 rgb(0 0 0 / 8%)` on the channel, `inset 0 -3px 0 rgb(0 0 0 / 12%)` on the fill).

### Named Rules
**The Block Edge Rule.** Raised pieces get a solid downward edge in a darker tone of their own surface (3 to 6px) plus a soft blur. Never a grey drop shadow alone, never a black edge, never a sideways offset.

**The Press Down Rule.** A pressable piece moves down by exactly its edge height when pressed, so it lands on the table.

## Shapes

Everything is rounded like sanded wood; there are no square corners on any surface. The radius steps the code actually uses are 12px (chips, code wells, focus ring), 16px (inner pieces such as the next step well, how-to panel, summary blocks, live rows, warnings), 20px (nav items, rows, mini cards, empty and error states), 24px (project blocks, and boxes under 820px), 28px (tagged boxes) and 32px (the rail). Buttons, tags, the search field, counts and tubes are full pills. The stamp is the one small 8px corner.

Status shapes are the second form language: a filled circle for in progress, a softly squared square for waiting, a rounded triangle for blocked, a 3px ring for done and abandoned, a dashed ring for no summary yet. Borders are 2px solid in Block Line around white pieces, and 2px dashed Block Line divides content inside them.

## Components

### Buttons
Chunky and tactile, they sit on an edge and press into it.
- ทำต่อ: coral pill, Mitr 600 17px, 10px by 24px, a 4px coral-edge underneath; pressing or opening its panel moves it down 4px and the edge disappears. Hover brightens slightly. It opens a disclosure with how to continue and copyable commands.
- Soft button: panel cream pill on the rail, Mitr 500 14px, 3px rail edge, presses 3px. Disabled drops to 60% opacity. The icon variant is square padded at 8px with an inline SVG.
- Copy button: block white pill with a 3px block line edge, beside a command well.
- Focus: a 3px sky outline offset 3px with a 12px radius, on every focusable thing.

### Chips
- Reasons behind a suggestion: 13px text on a birch well, 12px radius, two lines at most.
- Hot reason: butter soft wash with butter ink.
- Quiet reason: transparent with a 1.5px dashed block line border.

### Cards / Containers
- Tagged box: panel cream, 28px radius, 36px top padding to clear the tag, Block Depth. Every section is one.
- Project block: block white, 24px radius, 2px block line border, a 16px paint band across the top, Paint Edge underneath. Holds the status shape and name, a two line lede, the next step well, reason chips, then behind a dashed divider the account note and ทำต่อ.
- Mini card and row: block white, 20px radius, 2px block line border; on hover the border takes the project's paint and the mini lifts 2px.

### Inputs / Fields
- Search: a block white pill with a 2px block line border and an inline SVG magnifier in Walnut Ink 3. Focus within turns the border sky.

### Navigation
- The honey rail holds the logo (a walnut tile with three stepped bars), four nav pills and a foot with the scan time, the rescan button and the theme toggle.
- Nav pill: Mitr 500 17px in Walnut Ink 2, 20px radius, led by a small peg (circle or rounded square). Hover gives a half transparent cream wash; the current page is a cream pill on a 4px rail edge with a walnut peg.
- Under 820px the rail becomes a horizontal bar and the pills scroll sideways.

### Section Tag (signature)
A walnut pill (honey in the dark theme) sitting on the top edge of its box, 14px above it and 24px in, set in Mitr 500 14px. It is the section's h2. When the overlap section has warnings its tag turns butter with walnut text.

### Usage Tubes (signature)
Each account shows one painted tube per usage window (5 ชั่วโมง, รายสัปดาห์), filled with what is left. The channel is an 18px birch pill with an inset top shadow; the fill is the account's paint, inset 3px, with a darker lower lip. Under 20% left the fill turns butter and the percentage turns alert ink; at zero the percentage turns alert ink and the account state says when it frees up. Fills ease from empty to their level on page load over 0.9s, and the tube is a labelled meter for assistive tech. The account's state line reads from its emptiest tube.

### Stamp
Finished and abandoned projects keep their place with a small rubber stamp: 2px border in currentColor, 8px radius, tilted 3 degrees, sage ink for done and Walnut Ink 3 for abandoned.

### Timeline Lane
One lane per account: a birch pill track with session segments in the account's paint; automated sessions are hollow with a 2px Walnut Ink 3 border.

## Do's and Don'ts

### Do:
- Do keep coral on the ทำต่อ button only.
- Do tell status by shape as well as colour, using the five shapes in Shapes.
- Do put every section in a tagged box with its tag on the top edge.
- Do give raised pieces a solid downward edge in a darker tone of their own surface (3 to 6px) plus a soft blur, and press them down by that height.
- Do assign sage, sky, butter and lilac from the project name or account index so a colour never moves.
- Do use the alert pair for errors and low or waiting accounts, and butter for overlap warnings and low tubes.
- Do keep the dark theme as walnut wood with the same paints dimmed, never pure black.
- Do keep stamped finished work in the list instead of hiding it.
- Do draw icons and disclosure markers as inline SVG or CSS shapes in currentColor.

### Don't:
- Don't use coral for warnings, errors, charts or any second button.
- Don't use a grey dashboard surface with a single accent colour, or a cream editorial page with serif headlines.
- Don't use monospace outside file paths and commands.
- Don't use square corners on surfaces.
- Don't load fonts or images from outside the machine.
- Don't use emoji, middle dots, arrows or em dashes as separators in interface text.
