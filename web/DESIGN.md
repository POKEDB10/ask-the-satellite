# Ask the Satellite: design tokens (dark only)

Feel: quiet Google-Earth chrome plus Linear-style restraint. The globe is the hero; the chrome is thin, dense and precise.

## Colour (CSS variables in style.css)
- Surfaces: `--bg #0B0F19` (page), `--bg-1 #101924` (chat pane, sampled from v1), `--bg-2 #172033` (raised rows, inputs), `--glass rgba(11,15,25,.78)` (top bar and globe chips only).
- Lines: `--line #222B3D`, `--line-2 #2F3A52` (hover, focus edge). Borders instead of shadows.
- Text: `--fg #E6EAF2` (15.6:1 on bg), `--fg-2 #A6B0C3` (8.4:1), `--fg-3 #7D879B` (4.9:1, minimum for any text).
- One accent: `--acc #06B6D4` (v1 teal, sampled from reference/v1), `--acc-ink #03222A` for text on the accent. Page bg `#0B0F19` also sampled from v1.
- Trust: `--hi #3FB950`, `--med #D29922`, `--lo #F85149`. Change pixels: gain `#1E90FF`, loss `#FF8C00` (they match `change.py`). Mask: grey stripes.
- No gradients on text or surfaces. Glow only on the globe atmosphere (Cesium's).

## Type
- IBM Plex Sans 400/500/600 for UI and reading, IBM Plex Mono 400/500 for data and eyebrows, IBM Plex Sans Arabic for Arabic (local woff2, system fallbacks).
- Scale: 11 (mono eyebrow, uppercase, +0.08em), 12 (meta, chips), 13 (body), 15 (titles), 20 (figures), 28 (projector headline).
- Data uses `font-variant-numeric: tabular-nums`.

## Space and shape
- 4/8 grid: 4, 8, 12, 16, 24, 32. Top bar 56 px. Chat column `clamp(380px, 30vw, 520px)`.
- One radius family: 10 px controls and chips, 12 px globe chips, cards and modals. No 99 px pills.
- Panes are full height with no gaps, margins or card borders around the globe or chat.

## Motion
- 160 ms ease-out for hover and press, 240 ms for the chat open/close, 600 ms for layer fade-in, 5–7 s for an orbit flight, 2–3 s for a hop.
- `prefers-reduced-motion`: no auto-rotate, flights 0.8 s, no fades.

## Icons and copy
- Inline SVG, 1.5 px stroke, 16 px box. No emoji, no sparkles.
- Copy names the real thing: "Landsat 7 ETM+ · 30 m · 22 May 2001", never "Welcome!".
- Focus: 2 px accent outline, 2 px offset, on every interactive element.

## Projector mode (P)
- Base 17 px, figures 28 px, `--fg-2` raised to `#C9D1DF`, overlay alpha 0.92, chips 14 px.
