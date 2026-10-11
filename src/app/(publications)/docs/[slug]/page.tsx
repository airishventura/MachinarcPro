import { notFound } from "next/navigation";
import { PublicationArticle } from "@/components/publications/article";
import { PUBLICATIONS, publicationHref } from "@/lib/content/publications";
import { publicationMetadata } from "@/lib/seo";

export function generateStaticParams() { return PUBLICATIONS.filter((page) => page.category === "docs" && page.slug !== "overview").map((page) => ({ slug: page.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publication = PUBLICATIONS.find((page) => page.category === "docs" && page.slug === slug);
  return publication ? publicationMetadata(publication.title, publication.description, publicationHref(publication)) : { title: "Page not found", robots: { index: false, follow: false } };
}
export default async function DocsChapter({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publication = PUBLICATIONS.find((page) => page.category === "docs" && page.slug === slug && slug !== "overview");
  if (!publication) notFound();
  return <PublicationArticle publication={publication} />;
}
