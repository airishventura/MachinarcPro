import type { MetadataRoute } from "next";
import { PUBLICATIONS, publicationHref } from "@/lib/content/publications";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", ...PUBLICATIONS.map(publicationHref)].map((path) => ({ url: new URL(path, SITE_URL).toString() }));
}
