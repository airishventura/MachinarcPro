import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeSchedule, nextCron, scheduleTimezone } from "../src/lib/automation/cron";

test("existing cron schedules remain UTC and strictly after the start minute", () => {
  assert.equal(nextCron("0 9 * * *", new Date("2026-10-15T09:00:00Z")).toISOString(), "2026-10-16T09:00:00.000Z");
  assert.equal(describeSchedule({ kind: "cron", cron: "0 9 * * *" }), "Cron 0 9 * * * (UTC)");
});

test("cron matches the timezone's calendar day and local hour", () => {
  assert.equal(nextCron("0 9 * * 4", new Date("2026-10-14T23:00:00Z"), "Asia/Jakarta").toISOString(), "2026-10-15T02:00:00.000Z");
  assert.equal(nextCron("15 0 16 10 *", new Date("2026-10-15T12:00:00Z"), "Asia/Kathmandu").toISOString(), "2026-10-15T18:30:00.000Z");
});

test("spring DST skips nonexistent wall-clock time", () => {
  assert.equal(nextCron("30 2 * * *", new Date("2026-03-08T05:00:00Z"), "America/New_York").toISOString(), "2026-03-09T06:30:00.000Z");
});

test("fall DST fires at each actual occurrence of a repeated wall-clock minute", () => {
  const first = nextCron("30 1 * * *", new Date("2026-11-01T04:00:00Z"), "America/New_York");
  assert.equal(first.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(nextCron("30 1 * * *", first, "America/New_York").toISOString(), "2026-11-01T06:30:00.000Z");
});

test("invalid timezone and start date are rejected", () => {
  assert.throws(() => scheduleTimezone("Not/AZone"), RangeError);
  assert.throws(() => nextCron("* * * * *", new Date("invalid")), /Invalid schedule start time/);
});
