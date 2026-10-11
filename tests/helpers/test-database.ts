/** Validate without including connection strings or credentials in errors. */
export function requireTestDatabaseUrl(testUrl?: string, appUrl?: string) {
  if (!testUrl) throw new Error("TEST_DATABASE_URL must explicitly select a disposable test database.");
  const parse = (value: string) => {
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
      return url;
    } catch { throw new Error("Database URL must be a valid PostgreSQL connection URL."); }
  };
  const test = parse(testUrl);
  const name = decodeURIComponent(test.pathname.slice(1));
  if (!/(^|[_-])test(?:ing)?([_-]|$)/i.test(name)) throw new Error("TEST_DATABASE_URL database name must contain a separate test or testing segment.");
  const identity = (url: URL) => {
    const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "localhost" : url.hostname;
    return `${host}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
  };
  if (appUrl && identity(test) === identity(parse(appUrl))) throw new Error("TEST_DATABASE_URL must differ from the application DATABASE_URL.");
  return testUrl;
}
