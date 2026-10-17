import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, websiteSchema } from "@/lib/seo";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const jet = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jet" });

export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — Accountable AI Machine operations`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: SITE_URL },
  applicationName: SITE_NAME,
  other: { "ory-verify": "orynth-f9645dc88b6a42818637c3e16066b4df" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "en_US", siteName: SITE_NAME, title: `${SITE_NAME} — Accountable AI Machine operations`, description: SITE_DESCRIPTION, url: SITE_URL },
  twitter: { card: "summary_large_image", title: `${SITE_NAME} — Accountable AI Machine operations`, description: SITE_DESCRIPTION, images: ["/opengraph-image"] },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/favicon-16.png", sizes: "16x16", type: "image/png" }],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${jet.variable}`}>
      <body className="min-h-screen">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema).replace(/</g, "\\u003c") }} />
        {children}
      </body>
    </html>
  );
}
