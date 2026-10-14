"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

const GridScan = dynamic(() => import("@/components/react-bits/grid-scan"), { ssr: false });
const QUERY = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

/** Static until hydration; mobile/reduced-motion never mount the WebGL renderer. */
export function HeroGrid() {
  const animated = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-hero-grid={animated ? "animated" : "static"}>
      <div className="grid-bg absolute inset-0 opacity-50" />
      {animated && <div className="absolute inset-y-0 right-0 w-3/5 opacity-55">
        <GridScan linesColor="#34352f" scanColor="#d9c9a8" cells={10} scanDuration={5} scanDelay={4} glow={0.2} trail={0.15} reflection={0} parallax={0} dpr={1} interactive={false} clickEffect="none" enableGyro={false} enableWebcam={false} intro={false} />
      </div>}
    </div>
  );
}
