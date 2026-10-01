# Store / brand assets (PROPOSED)

Logo: concept A (ghost + » chevron), `logo-ghost-chevron.svg` (master).

`proposed/` holds **proposed, unpublished** Chrome Web Store assets built from the logo per the design direction:
- `store-icon-128-proposed.png` — 128×128 (96px art + 16px transparent padding, as the store recommends)
- `small-promo-tile-440x280-proposed.png`
- `marquee-promo-tile-1400x560-proposed.png` (text-only; swap in a real widget screenshot when available)

Nothing here is bundled in the extension zip (the deploy workflow zips `extension/` only).
`build-assets.py` regenerates the tiles and the site OG image (`web/public/og-image.png`).
`pr-preview/` has before/after site screenshots for the logo PR.
