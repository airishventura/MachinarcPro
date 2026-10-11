import type { Metadata } from "next";

export const SITE_URL = "https://machinarcpro.com";
export const SITE_NAME = "MachinArc";
export const SITE_DESCRIPTION = "Build and operate AI Machines with explicit permissions, approval workflows, durable execution, and a visible record of their work.";

export function publicationMetadata(title: string, description: string, path: string): Metadata {
  const url = new URL(path, SITE_URL).toString();
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", locale: "en_US", siteName: SITE_NAME, title: `${title} | ${SITE_NAME}`, description, url, images: [{ url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630, alt: "MachinArc — Accountable AI Machine operations" }] },
    twitter: { card: "summary_large_image", title: `${title} | ${SITE_NAME}`, description, images: [`${SITE_URL}/opengraph-image`] },
  };
}

export function privatePageMetadata(title: string): Metadata {
  return { title, alternates: { canonical: null }, robots: { index: false, follow: false, googleBot: { index: false, follow: false, noimageindex: true } } };
}

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en",
};
