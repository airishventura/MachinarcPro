/** The M represents a Machine; the connected arc represents its workflow. */
export function BrandMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <path d="M6 26V13L16 22L26 13V26" stroke="#f1efea" strokeWidth="3.5" strokeLinejoin="miter" />
      <path d="M6 8A14 14 0 0 1 26 8" stroke="#d9c9a8" strokeWidth="2.5" />
      <circle cx="26" cy="8" r="2.5" fill="#d9c9a8" />
    </svg>
  );
}
