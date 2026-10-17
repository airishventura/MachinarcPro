"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icon";

/** Camera motion for conceptual artwork, paused outside the viewport. */
export function MotionArtwork({ src, variant = "hero", priority = false }: { src: string; variant?: "hero" | "auth" | "closing"; priority?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={ref} aria-hidden="true" className={`motion-artwork motion-artwork-${variant} pointer-events-none absolute inset-0 overflow-hidden`} style={{ "--scene-play-state": visible && !paused ? "running" : "paused" } as CSSProperties}>
        <div className="scene-camera absolute inset-0">
          <Image src={src} alt="" fill priority={priority} sizes={variant === "auth" ? "50vw" : "100vw"} className="object-cover" />
        </div>
        <div className="scene-light absolute inset-0" />
      </div>
      <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? "Play artwork motion" : "Pause artwork motion"} aria-pressed={paused} className="scene-motion-toggle absolute bottom-4 right-5 z-10 inline-flex min-h-11 items-center gap-2 border border-line bg-bg/80 px-3 font-mono text-[10px] tracking-wider text-mute hover:text-fg">
        <Icon name={paused ? "play" : "pause"} size={13} />{paused ? "PLAY MOTION" : "PAUSE MOTION"}
      </button>
    </>
  );
}
