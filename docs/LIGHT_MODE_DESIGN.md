# Light Mode — Color System & Design Guide

> **Status:** Active design guide. **Last updated:** September 5, 2026.
>
> Artifact of the light-mode overhaul. Defines the teal-accent palette, the
> token mechanism that switches gold↔teal per theme, and the rules for using it.

## Goals

- Light mode must be clean, readable, and free of the "too much gold" problem.
- Dark mode is the **flagship** look and stays **untouched** — real gold, neon
  accents, `#001b2e` navy.
- Swap the accent *per theme* through CSS custom properties, so every existing
  `text-gold` / `bg-gold` / `border-gold` utility recolors automatically with
  **zero JSX churn**.

## Mechanism (why it works)

All colors are space-separated RGB custom properties consumed by Tailwind via
`rgb(var(--color-...) / <alpha-value>)`.

| Scope | `--color-gold` | `--color-accent` | `--color-mist-900` (page bg) |
|-------|----------------|------------------|------------------------------|
| `:root` (light)  | `11 90 86` (deep teal) | `13 105 94` (teal) | `248 250 252` |
| `.dark` / `.force-dark` | `201 168 76` (gold) | `0 255 135` (neon) | `0 27 46` |

Because `--color-gold` is redefined per scope, the ~264 gold utility usages swap
teal↔gold automatically. Dark mode's `.dark` block was preserved verbatim.

## Light-mode palette

| Token | Value | Used for | Contrast on `#F8FAFC` |
|-------|-------|----------|------------------------|
| `mist-50`  | `248 250 252` | bright text on dark showcase cards | — |
| `mist-100` | `17 24 39`   | headings / primary text | 16.9:1 |
| `mist-300` | `51 65 85`   | body text | 9.9:1 |
| `mist-400` | `75 85 99`   | secondary text | 7.2:1 |
| `mist-500` | `107 114 128`| tertiary text / mid borders | 4.6:1 |
| `mist-700` | `226 232 240`| subtle fills / hover | — |
| `mist-800` | `241 245 249`| card fills | — |
| `mist-900` | `248 250 252`| page background | — |
| `mist-950` | `10 15 28`  | labels (see note) | — |
| `gold` (light accent) | `11 90 86` | accent text **and** CTA buttons | 7.7:1 |
| `gold-bright` / `accent-bright` | `20 184 166` | decorative bars/dots/icons | 2.4:1 (deco only) |

`mist-50` and `mist-950` were previously **undefined** → rendered transparent.
They are now defined in `:root`, `.dark`, `.force-dark`, and the Tailwind config.

## CTA button labels

`bg-gold` buttons use `text-white dark:text-mist-950`:

- **Light**: white label on deep teal → 8:1 (near-black on teal was only 2.4:1, so
  it was flipped to white).
- **Dark**: near-black label on real gold (`mist-950` stays near-black; it also
  serves as a dark *card background* in some components, so it cannot be white).

## Rule of thumb (blend it well)

- Use **deep teal `#0B5A56`** for anything meant to be *read* (headings, links,
  numbers, buttons).
- Use **teal-500 `#14B8A6`** only for *decoration* (thin bars, dots, chart accents,
  gradients, card step markers) — it is too faint to be small text on white.
- Keep a few **`force-dark` panels** (homepage token model / yield diagrams) even in
  light mode — they keep gold/neon accents and give the page contrast. These are
  intentional, not leaks.
- Preserve dark-mode tokens in `.dark`/`.force-dark`; never hardcode a hex accent in
  a light-background component.

## Hardcoded-gold cleanup

`#C9A84C` (gold hex) that sat on **light backgrounds** was converted to
theme-aware values so gold doesn't leak into light mode:

- `nv-nav-link-active` → `text-gold`
- `nv-btn-sharp-primary` / `nv-btn-sharp-ghost` → `bg-gold`/`text-gold` variants
- `.nv-code-block` border → `rgb(var(--color-gold))`
- Home hero stat bars → `var(--color-gold)`
- `HomeBackground` particles, `VisualCcpFlow`, `UseCaseCards`, `RoadmapSection`
  dots, `UpdatesSection`, blog tag colors, `not-found` → `#14B8A6` (decorative teal)

The remaining `#C9A84C` occurrences in `app/page.tsx` are all **inside
`force-dark` cards** and intentionally stay gold.

## Files touched

- `app/web/app/globals.css` — `:root`, `.dark`, `.force-dark` token blocks; fixed
  `mist-50`/`mist-950`; re-themed hardcoded-gold CSS rules
- `app/web/tailwind.config.js` — added `mist-50`/`mist-950` to the `mist` scale
- `app/web/app/page.tsx` — stat-bar `var(--color-gold)`, hero CTA label
- `app/web/app/token/page.tsx`, `app/web/app/investors/page.tsx`,
  `components/AppShell.tsx`, `components/earn/EarnHome.tsx`,
  `components/ecosystem/EcosystemPage.tsx` — CTA labels `text-white dark:text-mist-950`
- `components/home/HomeBackground.tsx`, `VisualCcpFlow.tsx`, `UseCaseCards.tsx`,
  `RoadmapSection.tsx`, `UpdatesSection.tsx`, `app/more/blog/page.tsx`,
  `app/not-found.tsx` — decorative hex → teal

## Verification

- `tsc --noEmit` clean; `eslint` 0 errors; dev server serves 200
- Programmatic DOM audit (computed styles, element background resolved by walking
  ancestors): **0 gold leaks on light backgrounds** across home/investors/token/earn/ecosystem
- Contrast math computed for every pairing (all pass WCAG for their role)
- Dark mode confirmed intact via controlled injection: forcing `.dark` yields
  `--color-gold = 201 168 76` (gold) and `bg-gold` = `rgb(201,168,76)`.
