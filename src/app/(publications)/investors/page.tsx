import { PublicationArticle } from "@/components/publications/article";
import { PUBLICATIONS } from "@/lib/content/publications";
import { publicationMetadata } from "@/lib/seo";

const publication = PUBLICATIONS.find((page) => page.category === "investors")!;
export const metadata = publicationMetadata(publication.title, publication.description, "/investors");
export default function InvestorsPage() { return <PublicationArticle publication={publication} />; }
