import Link from "next/link";
import { PUBLICATIONS, publicationHref, type Publication } from "@/lib/content/publications";
import { PublicationTools } from "./navigation";

const categoryLabels = { docs: "Documentation", whitepaper: "Whitepaper", investors: "For investors" };

export function PublicationArticle({ publication }: { publication: Publication }) {
  const position = PUBLICATIONS.indexOf(publication);
  const previous = PUBLICATIONS[position - 1];
  const next = PUBLICATIONS[position + 1];
  return <main className="book-reading-layout">
    <article id="main" className="book-article" tabIndex={-1}>
      <nav className="book-breadcrumb" aria-label="Breadcrumb"><Link href="/">MachinArc</Link><span aria-hidden="true">/</span><Link href={`/${publication.category}`}>{categoryLabels[publication.category]}</Link>{publication.slug !== "overview" && <><span aria-hidden="true">/</span><span>{publication.title}</span></>}</nav>
      <div className="book-eyebrow"><span aria-hidden="true" />{publication.category === "docs" ? "Product guide" : publication.category === "whitepaper" ? "Working paper · v0.1" : "Product & company thesis"}</div>
      <h1>{publication.title}</h1>
      <p className="book-description">{publication.description}</p>
      <PublicationTools />
      <nav className="book-inline-toc" aria-label="On this page"><strong>On this page</strong>{publication.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
      <div className="book-prose">{publication.sections.map((section) => <section key={section.id} id={section.id} className="book-section">
        <h2><a href={`#${section.id}`}>{section.title}<span aria-hidden="true"> #</span></a></h2>
        {section.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        {section.bullets && <ul>{section.bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}</ul>}
        {section.code && <div className="book-code"><div>Example</div><pre><code>{section.code}</code></pre></div>}
        {section.callout && <aside className="book-callout"><strong>{section.callout.title}</strong><p>{section.callout.body}</p></aside>}
      </section>)}</div>
      <div className="book-page-bottom"><span>Living documentation · October 2026</span><Link href="/docs/operations">Product status & limits ↗</Link></div>
      <nav className="book-pagination" aria-label="Adjacent pages">
        {previous ? <Link href={publicationHref(previous)}><span>← Previous</span><strong>{previous.title}</strong></Link> : <Link href="/"><span>← Back to</span><strong>MachinArc</strong></Link>}
        {next && <Link href={publicationHref(next)} className="book-next"><span>Next →</span><strong>{next.title}</strong></Link>}
      </nav>
    </article>
    <aside className="book-toc"><nav aria-label="On this page"><p>On this page</p>{publication.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav><div className="book-toc-note"><span>From intent to execution.</span><p>Start in an isolated demo. Connect real tools when you are ready.</p><Link href="/docs/quickstart">Quickstart ↗</Link></div></aside>
  </main>;
}
