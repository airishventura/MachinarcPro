import Link from "next/link";
import { Logo } from "@/components/ui";
import { PublicationNavigation, PublicationSearch } from "@/components/publications/navigation";
import { PUBLICATIONS, publicationHref } from "@/lib/content/publications";
import "./publications.css";

export default function PublicationsLayout({ children }: { children: React.ReactNode }) {
  const items = PUBLICATIONS.map((publication) => ({ title: publication.title, description: publication.description, category: publication.category, href: publicationHref(publication), text: [publication.title, publication.description, ...publication.sections.flatMap((section) => [section.title, ...section.paragraphs, ...(section.bullets ?? []), section.code ?? "", section.callout?.body ?? ""])].join(" ").toLowerCase() }));
  return <div className="book-shell">
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="book-header"><div className="book-header-inner"><Link href="/" aria-label="MachinArc home"><Logo pro={false} /></Link><span className="book-header-divider" aria-hidden="true" /><span className="book-library-label">LIBRARY</span><div className="book-header-actions"><PublicationSearch items={items} /><Link href="/app" className="book-app-link">Open app <span aria-hidden="true">↗</span></Link></div></div></header>
    <details className="book-mobile-navigation"><summary>Browse the library<span aria-hidden="true">＋</span></summary><PublicationNavigation items={items} /></details>
    <div className="book-workspace"><aside className="book-sidebar"><div className="book-sidebar-intro"><span className="book-status-dot" aria-hidden="true" /><span>THE MACHINARC LIBRARY</span><p>A field guide to accountable autonomy.</p></div><PublicationNavigation items={items} /><div className="book-sidebar-footer"><span>Beta product</span><Link href="/docs/status">What works today ↗</Link></div></aside>{children}</div>
    <footer className="book-footer"><Link href="/">MACHINARC</Link><span>Create. Deploy. Observe. Evolve.</span><a href="/brand/machinarc-logo.svg" download>Download logo ↗</a></footer>
  </div>;
}
