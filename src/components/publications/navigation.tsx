"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type PublicationLink = { title: string; description: string; category: string; href: string; text: string };
const categories = [{ id: "docs", title: "Documentation" }, { id: "whitepaper", title: "Whitepaper" }, { id: "investors", title: "For investors" }];

export function PublicationNavigation({ items }: { items: PublicationLink[] }) {
  const pathname = usePathname();
  return <nav aria-label="Publication chapters" className="book-nav">{categories.map((category) => <div key={category.id} className="book-nav-group">
    <p>{category.title}</p>
    {items.filter((item) => item.category === category.id).map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); }}>{item.title}</Link>)}
  </div>)}</nav>;
}

export function PublicationSearch({ items }: { items: PublicationLink[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  function open() { if (!dialog.current?.open) dialog.current?.showModal(); input.current?.focus(); }
  function close() { dialog.current?.close(); setQuery(""); }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (!dialog.current?.open) dialog.current?.showModal(); input.current?.focus(); } }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = items.filter((item) => terms.every((term) => item.text.includes(term)));
  return <>
    <button type="button" className="book-search-button" onClick={open} aria-haspopup="dialog"><span aria-hidden="true">⌕</span><span>Search</span><kbd>⌘ / Ctrl K</kbd></button>
    <dialog ref={dialog} className="book-search-dialog" aria-label="Search MachinArc publications" onCancel={() => setQuery("")}>
      <div className="book-search-heading"><label htmlFor="publication-search">Search the library</label><button type="button" onClick={close} aria-label="Close search">×</button></div>
      <input ref={input} id="publication-search" type="search" placeholder="Try approvals, tools, or roadmap…" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
      <p className="book-search-count" role="status">{results.length} {results.length === 1 ? "page" : "pages"}{query ? " found" : " in the library"}</p>
      <div className="book-search-results">{results.length ? results.map((item) => <Link key={item.href} href={item.href} onClick={close}><span className="book-search-category">{item.category === "investors" ? "For investors" : item.category}</span><strong>{item.title}</strong><span>{item.description}</span><span className="book-search-arrow" aria-hidden="true">↗</span></Link>) : <p className="book-search-empty">No pages match that search. Try a shorter phrase, such as “approval” or “Machine”.</p>}</div>
    </dialog>
  </>;
}

export function PublicationTools() {
  const [status, setStatus] = useState("Copy link");
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setStatus("Link copied"); }
    catch { setStatus("Copy from address bar"); }
  }
  return <div className="book-tools"><button type="button" onClick={copy}><span aria-live="polite">{status}</span><span aria-hidden="true"> ↗</span></button><button type="button" onClick={() => window.print()}>Print / Save PDF</button></div>;
}
