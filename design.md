# Design — CalendarApp

A locked design system for this app. Every page/component redesign reads this file
before emitting code. Do not regenerate per page — extend or amend this file when
the system needs to grow.

## Genre
modern-minimal (B2B SaaS, multi-tenant shift/reward management tool)

## Macrostructure family
This is an application, not a marketing site — Hallmark's landing-page
macrostructures don't apply to its route pages. The structural discipline that
matters here is **token discipline**, not page rhythm:

- App pages (admin/*, cast/*, dashboard, settings): existing shadcn/ui component
  library + Tailwind, unchanged. Redesign scope = token correctness, not layout.
- Marketing page (`/apply`): plain form, typography only. No enrichment.
- Document page (`/admin/rewards/notice`): a formal printable payment notice.
  Deliberately outside this system — own print stylesheet, own layout.

## Theme
- `--background` / `--card`   oklch(1 0 0) — pure white (kept; app surfaces, not a marketing hero)
- `--foreground`              oklch(0.145 0 0)
- `--brand-accent`            #5A7C93 (slate-indigo — same hue family as the
                               Midnight/Admin Pro store dark themes, so the whole
                               app reads as one system instead of a generic blue)
- `--brand-accent-2`          #7B9BB0
- `--brand-accent-dark`       #435F73
- `--destructive`             oklch(0.577 0.245 27.325)
- `--positive`                oklch(0.527 0.145 152)
- `--note`                    oklch(0.6 0.14 75)
- `--status-draft/submitted/confirmed/rejected` — #A7AEB9 / #5E82A8 / #5CA084 / #C36F68

Store-level themes (`data-theme`: rose · midnight · emerald · gold · violet ·
admin-pro) override `--primary`/surface colors and, where the surface is dark,
also override `--destructive`/`--positive`/`--note` for contrast. They do not
override `--brand-accent` — that stays constant so FABs/nav stay recognizable
across store themes.

## Typography
- Default (all roles): Noto Sans JP 500/700 (`--font-sans`, `next/font/google`),
  falls back to `-apple-system, Hiragino Sans`.
- Per-cast personalization (opt-in, `accent_font` column): Zen Maru Gothic,
  M PLUS Rounded 1c, Kosugi Maru, Mochiy Pop One, Kiwi Maru, Hachi Maru Pop.
  Selectable independently of accent color in Settings → 着せ替え.

## Per-user allowance — the "着せ替え" system
Unlike a marketing site, this app deliberately lets each **cast** override
`--brand-accent`/`--brand-accent-2`/`--brand-accent-dark`/`--status-*`/
`--font-sans` via a personal skin + font pick (`src/lib/accent-skins.ts`,
`src/lib/accent-fonts.ts`, wired in `src/app/(app)/layout.tsx`). This is the
**one sanctioned per-page-role variance** in the system — admins and the
platform owner always see the base theme above; casts may personalize.
New casts (and anyone who never touched the setting) get `studio-indigo` +
`default` (Noto Sans JP) — i.e. the locked system, not a placeholder.

## Spacing / motion / microinteractions
Existing Tailwind defaults + `--elevation-*` custom properties (hairline-border
elevation, no coloured shadow glow). No motion library; keep it that way —
count-up/spring animations in the reward dashboard use raw `requestAnimationFrame`,
not a dependency. Confirmation dialogs (`window.confirm`) are still used for a
few reversible actions (shift cancel, store suspend) — flagged in the Hallmark
audit as a minor follow-up, not yet fixed.

## What every page/component MUST share
- Semantic color always through a token: `text-destructive`, `text-positive`,
  `text-note`, `var(--status-*)` — never a raw Tailwind `red-600`/`green-100`/
  `amber-50` etc. (This was the audit's critical finding; fixed app-wide in this pass.)
- The `Logo` component (angular "C" mark, no rounded corners by design) and
  "CalendarApp" wordmark.
- Button voice from `src/components/ui/button.tsx` (`default/outline/secondary/
  ghost/destructive/tonal/elevated`) — no ad-hoc color className overrides.

## What MAY differ
- Cast's personal accent skin + font (see above).
- Store's `data-theme` (chosen by the store admin in store settings).

## Known exception (intentional, not drift)
Sunday = red / Saturday = blue day-of-week coloring in the shift calendars
(`shift-calendar.tsx`, `shift-timeline.tsx`, `cast-shift-view.tsx`) stays as raw
Tailwind `red-500`/`blue-500`. This mirrors a paper-calendar convention rather
than a semantic app color and was deliberately kept as-is during the audit.
