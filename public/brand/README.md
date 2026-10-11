# MachinArc identity

The geometric **M** identifies a Machine. The overhead arc and endpoint node represent a connected workflow.

- `machinarc-mark.svg`: transparent symbol, 32-unit viewBox; use at 16px or larger on dark backgrounds.
- `machinarc-logo.svg`: transparent horizontal lockup with vector lettering; no installed font required.
- `src/components/brand-mark.tsx`: decorative React version, paired with a visible text label by `Logo`.

Colors: ivory `#f1efea`, amber `#d9c9a8`, dark icon background `#090909`. Preserve the mark's proportions and leave at least 4 units of clear space around it.

The favicon contains 16px, 32px, and 48px PNG entries. `icon.svg`, `favicon-16.png`, `favicon-32.png`, and `apple-touch-icon.png` use the same mark geometry on the dark background; the touch icon is 180px. Change the geometry consistently in the SVG files and the React component before rerendering the raster assets.
