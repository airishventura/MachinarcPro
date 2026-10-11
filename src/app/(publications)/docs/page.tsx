import { PublicationArticle } from "@/components/publications/article";
import { PUBLICATIONS } from "@/lib/content/publications";
import { publicationMetadata } from "@/lib/seo";

const publication = PUBLICATIONS.find((page) => page.category === "docs" && page.slug === "overview")!;
export const metadata = publicationMetadata(publication.title, publication.description, "/docs");
export default function DocsPage() { return <PublicationArticle publication={publication} />; }
