import { PublicationArticle } from "@/components/publications/article";
import { PUBLICATIONS } from "@/lib/content/publications";
import { publicationMetadata } from "@/lib/seo";

const publication = PUBLICATIONS.find((page) => page.category === "whitepaper")!;
export const metadata = publicationMetadata(publication.title, publication.description, "/whitepaper");
export default function WhitepaperPage() { return <PublicationArticle publication={publication} />; }
