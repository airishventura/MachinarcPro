type SearchDomain = { host: string; path: string };

function parseSearchDomain(value: string): SearchDomain | null {
  try {
    const raw = value.trim().replace(/^site:/i, "").replace(/^\*\./, "").replace(/[),;]+$/, "");
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!url.hostname.includes(".") || url.username || url.password || url.port || url.search || url.hash) return null;
    return { host: url.hostname.toLowerCase(), path: url.pathname.replace(/\/+$/, "") };
  } catch { return null; }
}

function matches(url: URL, domain: SearchDomain) {
  const hostMatches = url.hostname.toLowerCase() === domain.host || url.hostname.toLowerCase().endsWith(`.${domain.host}`);
  const pathMatches = !domain.path || url.pathname === domain.path || url.pathname.startsWith(`${domain.path}/`);
  return hostMatches && pathMatches;
}

/** Keep only public web URLs matching explicit domain filters and any `site:` query operators. */
export function filterSearchHits<T extends { url: string }>(hits: T[], domains?: string[], query = "") {
  const requested = (domains ?? []).map(parseSearchDomain);
  const siteHints = [...query.matchAll(/(?:^|\s|\()site:(\*?[a-z\d.-]+(?:\/[a-z\d_./*-]*)?)/gi)].map(match => parseSearchDomain(match[1]));
  const invalidFilter = requested.some(domain => !domain) || siteHints.some(domain => !domain);

  return hits.filter(hit => {
    try {
      const url = new URL(hit.url);
      return !invalidFilter && (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !!url.hostname
        && (!requested.length || requested.some(domain => domain && matches(url, domain)))
        && (!siteHints.length || siteHints.some(domain => domain && matches(url, domain)));
    } catch { return false; }
  });
}
