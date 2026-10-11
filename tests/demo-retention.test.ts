import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_RETENTION_MS, visitorDemoExpiresAt } from "../src/lib/seed/demo-retention";

const visitor = { email: "demo-00000000-0000-4000-8000-000000000000@machinarc.invalid", passwordHash: null, googleId: null, createdAt: new Date("2026-10-01T12:00:00Z") };

test("visitor expiry is seven days from creation, independent of sign-in time", () => {
  assert.equal(DEMO_RETENTION_MS, 604_800_000);
  assert.equal(visitorDemoExpiresAt(visitor)?.toISOString(), "2026-10-08T12:00:00.000Z");
});

test("registered, Google, legacy seed, and malformed demo identities retain normal sessions", () => {
  for (const override of [{ passwordHash: "registered-test-hash" }, { googleId: "test-google-id" }, { email: "demo@machinarcpro.com" }, { email: "demo-not-a-uuid@machinarc.invalid" }, { email: "owner@example.test" }]) {
    assert.equal(visitorDemoExpiresAt({ ...visitor, ...override }), null);
  }
});
