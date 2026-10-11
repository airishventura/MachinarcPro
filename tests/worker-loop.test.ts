import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { startWorkerLoop } from "../src/lib/queue/worker-loop";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("wakeups during a pending claim cannot exceed worker concurrency", { timeout: 5000 }, async () => {
  const started = deferred(), releaseClaim = deferred(), repolled = deferred();
  const concurrency = 2;
  let active = 0, maximum = 0, claims = 0, polls = 0;
  const worker = startWorkerLoop(async () => {
    polls++;
    const free = concurrency - active;
    if (free > 0) {
      claims++;
      started.resolve();
      await releaseClaim.promise;
      active += free;
      maximum = Math.max(maximum, active);
    }
    if (polls === 2) repolled.resolve();
  }, 60_000, (error) => { throw error; });
  try {
    await started.promise;
    for (let i = 0; i < 20; i++) worker.wake();
    await nextTurn();
    assert.equal(claims, 1, "only one claim can inspect the available slots");
    releaseClaim.resolve();
    await repolled.promise;
    assert.equal(claims, 1, "the follow-up poll sees occupied capacity");
    assert.equal(maximum, concurrency);
    assert.equal(polls, 2, "wakeups coalesce into one follow-up poll");
  } finally { releaseClaim.resolve(); worker.stop(); }
});

test("a wakeup starts polling immediately instead of waiting for the timer", { timeout: 5000 }, async () => {
  const first = deferred(), second = deferred();
  let polls = 0;
  const worker = startWorkerLoop(async () => { (++polls === 1 ? first : second).resolve(); }, 60_000, (error) => { throw error; });
  try {
    await first.promise;
    await nextTurn();
    worker.wake();
    await second.promise;
    assert.equal(polls, 2);
  } finally { worker.stop(); }
});

test("stopping during I/O suppresses pending wakeups and exposes stop state", { timeout: 5000 }, async () => {
  const started = deferred(), release = deferred(), finished = deferred();
  let polls = 0, claims = 0;
  const worker = startWorkerLoop(async (isStopped) => {
    polls++;
    started.resolve();
    await release.promise;
    if (!isStopped()) claims++;
    finished.resolve();
  }, 60_000, (error) => { throw error; });
  try {
    await started.promise;
    worker.wake();
    worker.stop();
    release.resolve();
    await finished.promise;
    worker.wake();
    await nextTurn();
    assert.equal(polls, 1);
    assert.equal(claims, 0);
  } finally { release.resolve(); worker.stop(); }
});

test("a failed poll releases the single-flight guard and can be woken again", { timeout: 5000 }, async () => {
  const failed = deferred(), recovered = deferred();
  let polls = 0;
  const errors: unknown[] = [];
  const worker = startWorkerLoop(async () => {
    if (++polls === 1) throw new Error("claim failed");
    recovered.resolve();
  }, 60_000, (error) => { errors.push(error); failed.resolve(); });
  try {
    await failed.promise;
    worker.wake();
    await recovered.promise;
    assert.equal(errors.length, 1);
    assert.equal(polls, 2);
  } finally { worker.stop(); }
});
