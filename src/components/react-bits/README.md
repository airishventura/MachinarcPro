SpotlightCard and GridScan are vendored from:
https://github.com/julienseven/react-bits/tree/main/src/ts-tailwind

Copyright (c) 2026 David Haz. See LICENSE.md for the full MIT + Commons Clause notice.

SpotlightCard's default rounding/padding were removed so existing MachinArc panels
retain their geometry. The landing wrapper supplies the existing colors and spacing.
GridScan is loaded only on desktop without reduced motion, at DPR 1. Camera,
gyroscope, pointer interactions, and click effects are explicitly disabled.
