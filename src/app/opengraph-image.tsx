import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/seo";
import { BrandMark } from "@/components/brand-mark";

export const alt = "MachinArc — Accountable AI Machine operations";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", background: "#090909", color: "#f1efea", display: "flex", flexDirection: "column", padding: "58px 72px", fontFamily: "sans-serif", border: "1px solid #252726" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <BrandMark size={58} />
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: "-1px" }}>{SITE_NAME}</div>
        <div style={{ display: "flex", marginLeft: "auto", fontSize: 16, letterSpacing: "3px", color: "#8d908e" }}>MACHINES / ARCS / OPERATIONS</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 78, fontSize: 76, lineHeight: 1.06, letterSpacing: "-3px", fontWeight: 700 }}>
        <div style={{ display: "flex" }}>Accountable AI</div>
        <div style={{ display: "flex", color: "#d9c9a8" }}>Machine operations.</div>
      </div>
      <div style={{ display: "flex", marginTop: 32, fontSize: 24, color: "#8d908e", lineHeight: 1.45, maxWidth: 850 }}>Explicit permissions. Human approvals. A visible record of the work.</div>
      <div style={{ display: "flex", marginTop: "auto", paddingTop: 24, borderTop: "1px solid #252726", justifyContent: "space-between", color: "#8d908e", fontSize: 16 }}>
        <div style={{ display: "flex" }}>Build / deploy / observe</div>
        <div style={{ display: "flex" }}>machinarcpro.com</div>
      </div>
    </div>,
    size,
  );
}
