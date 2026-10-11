import { test } from "node:test";
import assert from "node:assert/strict";
import { requireTestDatabaseUrl } from "./helpers/test-database";

test("requires an explicitly named disposable test database", () => {
  assert.throws(() => requireTestDatabaseUrl(), /TEST_DATABASE_URL/);
  assert.throws(() => requireTestDatabaseUrl("postgres://u:secret@localhost/machinarc"), /name must contain/);
  const url = "postgres://u:secret@localhost/machinarc_test";
  assert.equal(requireTestDatabaseUrl(url), url);
});

test("rejects the application database even with different credentials or loopback spelling", () => {
  assert.throws(() => requireTestDatabaseUrl("postgresql://test:secret@127.0.0.1/machinarc_test", "postgres://app:other@localhost:5432/machinarc_test"), /must differ/);
  assert.doesNotThrow(() => requireTestDatabaseUrl("postgres://u:secret@localhost/machinarc_test", "postgres://u:secret@localhost/machinarc"));
});

test("invalid URLs never leak credentials", () => {
  assert.throws(() => requireTestDatabaseUrl("secret-credential"), (error: Error) => !error.message.includes("secret-credential"));
});
