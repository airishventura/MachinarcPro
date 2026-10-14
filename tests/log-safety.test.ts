import { test } from "node:test";
import assert from "node:assert/strict";
import { errorSummary } from "../src/lib/security/redact";

test("database error summaries do not expose query parameter payloads", () => {
  const error = new Error("Failed query: insert into tool_executions values ($1)\nparams: {password: private-example-value}");
  assert.equal(errorSummary(error), "Database operation failed.");
  assert.equal(errorSummary(new Error("Provider unavailable")), "Provider unavailable");
  assert.equal(errorSummary(new Error("Bearer secret-test-token-value")), "[REDACTED]");
});
