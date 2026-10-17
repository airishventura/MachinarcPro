# MachinArc identity

The grounded **M** identifies a Machine. The open overhead arc represents a workflow. Broad filled geometry replaces the thin strokes and endpoint detail so the silhouette remains clear in small interface slots.

Designed for builders and operators of accountable AI Machines: precise, restrained, and structural. This refines the existing identity rather than introducing unrelated AI sparkles, circuitry, or shields. Shape and color associations are design intentions, not measured audience findings.

The supplied Satori Graphics transcript, *The NEW Logo Design Knowledge You Need In 2026!*, informed the audience-first brief, silhouette-first refinement, monochrome variants, and size presentation. Source: https://www.youtube.com/watch?v=-0kt008QsUY

- `machinarc-mark.svg`: transparent symbol, 32-unit viewBox; use at 16px or larger on dark backgrounds.
- `machinarc-logo.svg`: transparent horizontal lockup with vector lettering; no installed font required.
- `src/components/brand-mark.tsx`: decorative React version, paired with a visible text label by `Logo`.
- `*-light.svg`: ink-colored transparent exports for light backgrounds.
- `*-mono.svg`: ivory single-color transparent exports for dark backgrounds and one-color reproduction.
- `identity-preview.png` / `.svg`: presentation with light, monochrome, and actual 16/24/32/48px samples.

Colors: ivory `#f1efea`, amber `#d9c9a8`, dark icon background `#090909`. Preserve the mark's proportions and leave at least 4 units of clear space around it.

The favicon contains 16px, 32px, and 48px PNG entries. `icon.svg`, `favicon-16.png`, `favicon-32.png`, and `apple-touch-icon.png` use the same mark geometry on the dark background; the touch icon is 180px with additional clear space.

Geometry and colors live in `src/lib/brand.ts`. Regenerate exports with `node node_modules/tsx/dist/cli.mjs scripts/generate-brand.ts`. The React mark inherits text color; use `monochrome` for a single-color context. Exported lettering retains the existing custom vector wordmark and needs no installed font.

Keep the logo static in persistent navigation. If used in an introduction, reveal the M first and the arc second once, within 320ms; reduced motion should show the complete mark immediately. Do not imply runtime health through logo animation.
