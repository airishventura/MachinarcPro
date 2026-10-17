import { BRAND_ARC_PATH, BRAND_COLORS, BRAND_MACHINE_PATH } from "@/lib/brand";

/** A grounded Machine beneath a workflow arc. Inherits the surrounding text color. */
export function BrandMark({ size = 24, className = "", monochrome = false }: { size?: number; className?: string; monochrome?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <path d={BRAND_MACHINE_PATH} fill="currentColor" />
      <path d={BRAND_ARC_PATH} fill={monochrome ? "currentColor" : BRAND_COLORS.amber} />
    </svg>
  );
}
