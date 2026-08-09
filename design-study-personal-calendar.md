# Design study — personal calendar reference (2026-08-03)

Studied DNA from a screenshot, kept separate from `design.md` (CalendarApp's
own locked system). This file is a reference to draw from when redesigning
`shift-calendar.tsx` / `cast-shift-view.tsx` — it is not itself an active
system and nothing currently reads it automatically.

## Provenance
- Source mode: image (user-attached screenshot, own personal calendar app)
- Date: 2026-08-03
- Confidence: tokens are estimated from source-image colour bands (image
  mode); fonts are role-based with named candidates from the Hallmark canon,
  not the source's actual typeface; rhythm is from a direct vision pass on
  the source, so it's the most reliable axis here.

## System
- Genre: modern-minimal / utility (not a marketing genre — this is an app screen)
- Macrostructure: none of the 21 marketing macrostructures fit cleanly.
  Closest cousin: **Bento Grid** (visual rhythm from block-size variation,
  not card uniformity) — but the real shape is a **month grid with
  categorical color-coded event chips**, closer to a calendar utility
  pattern than any landing-page shape.
- Colour logic: **categorical, not single-accent.** Each calendar/category
  gets its own hue; there is no one "brand accent." This is the core
  structural difference from CalendarApp's current `--brand-accent` model.
- Axes: paper-band dark / display-style none (data-led, not display-led) / accent-hue multi

## Tokens (estimated OKLCH — image mode, treat as starting points not final)
```css
:root {
  --color-paper:       oklch(0.15 0.015 250);  /* near-black, faint cool tilt */
  --color-ink:         oklch(0.95 0 0);        /* near-white text */
  --color-rule:        oklch(0.30 0.01 250);   /* subtle grid lines between cells */

  /* Category colours — this is the DNA's real payload, not a single accent */
  --category-private:  oklch(0.55 0.15 350);   /* magenta/pink pill */
  --category-work:     oklch(0.55 0.12 240);   /* cyan-blue pill */
  --category-neutral:  oklch(0.45 0.02 260);   /* grey pill, muted category */
  --category-green:    oklch(0.55 0.13 150);   /* recurring task chip */
  --category-teal:     oklch(0.55 0.11 190);   /* recurring task chip, second hue */
  --banner-accent:     oklch(0.50 0.15 235);   /* cross-week banner strip */

  /* Calendar-convention colours, not brand semantics */
  --weekday-sunday:    oklch(0.55 0.20 25);
  --weekday-saturday:  oklch(0.55 0.15 240);

  --font-body: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; /* single family, weight-only hierarchy */
}
```

## Structural notes worth carrying over
- **Variable row height.** Weeks with more events get taller cells instead
  of clipping or scrolling within a fixed height. CalendarApp's
  `shift-calendar.tsx` currently fixes cell height (`h-[84px] md:h-[112px]`)
  and truncates with `•••` past 2–3 chips — the source's adaptive-height
  approach reads calmer at high density.
- **Category = colour, not a single accent.** If CalendarApp ever needs to
  distinguish more than the current 4 shift statuses (e.g. per-room colour,
  per-cast colour), this DNA's categorical-hue model is the pattern to
  reach for — assign a stable hue per category rather than reusing the one
  brand accent for everything.
- **Dark-elevation-lightness.** Chips read as "raised" purely by being
  brighter than the near-black paper, no drop shadow. Consistent with
  CalendarApp's own `--elevation-*` philosophy (hairline + faint shadow,
  no glow) — this source pushes it further by using lightness contrast
  as the *only* elevation cue on dark surfaces.
- **Grid-breaking banner.** A translucent horizontal strip spans multiple
  day cells in one week to mark a shared multi-day state ("free — must
  cancel"). CalendarApp's `periodDates` (整理日 dots) is a per-cell marker
  today; a spanning banner is a structurally different (and here, more
  legible) way to show a state that covers a date *range*.

## Notes — anti-patterns NOT to carry over
None observed in the source. No bouncy motion, no gradient chips, no
emoji-as-decoration (the emoji here are functional per-task category marks,
not sparkle-badge decoration) — the source is clean by Hallmark's own bar.

## What this is not
This is a diagnosis artifact, not an instruction to change CalendarApp's
color system. `design.md` remains the actual locked system; nothing here
overrides `--brand-accent` or the accent-skins. Apply selectively if/when
the shift calendar is redesigned.
