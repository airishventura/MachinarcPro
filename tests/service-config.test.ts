import { test } from "node:test";
import assert from "node:assert/strict";
import { readServiceConfig } from "../src/lib/services/config";

test("private services reject missing configuration and unsafe limits without leaking secrets", () => {
  const original = { ...process.env };
  try {
    delete process.env.DATABASE_URL;
    assert.throws(() => readServiceConfig("worker"), /DATABASE_URL/);
    process.env.DATABASE_URL = "postgresql://test:disposable@localhost/test";
    process.env.MARC_ENCRYPTION_KEY = "disposable-test-key-with-32-characters";
    delete process.env.VERCEL;
    delete process.env.SERVER_PORT;
    delete process.env.PORT;
    delete process.env.MARC_WORKER_CONCURRENCY;
    delete process.env.MACHINARC_WORKER_CONCURRENCY;
    assert.equal(readServiceConfig("worker").concurrency, 2);
    assert.equal(readServiceConfig("scheduler").port, 3102);
    process.env.SERVER_PORT = "8080";
    assert.equal(readServiceConfig("integrations").port, 8080);
    process.env.MACHINARC_WORKER_CONCURRENCY = "0";
    assert.throws(() => readServiceConfig("worker"), /CONCURRENCY/);
    delete process.env.MACHINARC_WORKER_CONCURRENCY;
    process.env.VERCEL = "1";
    assert.throws(() => readServiceConfig("worker"), /outside Vercel/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
