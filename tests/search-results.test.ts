import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSearchHits } from "../src/lib/tools/search-results";

const hit = (url: string) => ({ title: url, url });

test("search results honor site host and path operators even when Bing returns unrelated hits", () => {
  const results = filterSearchHits([
    hit("https://www.postgresql.org/docs/current/app-pgdump.html"),
    hit("https://stackoverflow.com/questions/71731966/edge-visual-search"),
    hit("https://postgresql.org/about"),
    hit("https://postgresql.org.evil.test/docs/current/app-pgdump.html"),
  ], undefined, "site:postgresql.org/docs pg_dump");

  assert.deepEqual(results.map(result => result.url), ["https://www.postgresql.org/docs/current/app-pgdump.html"]);
});

test("search results intersect explicit domain filters with site operators", () => {
  const hits = [hit("https://www.postgresql.org/docs/current/app-pgdump.html"), hit("https://stackoverflow.com/questions/1")];
  assert.deepEqual(filterSearchHits(hits, ["postgresql.org"], "site:postgresql.org/docs pg_dump"), [hits[0]]);
  assert.deepEqual(filterSearchHits(hits, ["stackoverflow.com"], "site:postgresql.org/docs pg_dump"), []);
});

test("search results reject invalid filters, non-web URLs and credential-bearing URLs", () => {
  const hits = [hit("https://example.com/docs"), hit("javascript:alert(1)"), hit("https://user:pass@example.com/docs")];
  assert.deepEqual(filterSearchHits(hits, undefined, "site:bad host"), []);
  assert.deepEqual(filterSearchHits(hits), [hits[0]]);
});
