import { describe, expect, it, vi } from "vitest";
import {
  PlannerScheduler,
  computeNextRun,
  type SchedulerBackend,
  type SchedulerHandle,
} from "../src/scheduler.js";

describe("computeNextRun", () => {
  it("computes the next daily run at a given time, same day if not yet passed", () => {
    const from = new Date("2026-07-20T06:00:00");
    const next = computeNextRun({ recurrence: "daily", atTime: "07:00" }, from);
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(from.getDate());
  });

  it("rolls over to the next day when the time has already passed", () => {
    const from = new Date("2026-07-20T08:00:00");
    const next = computeNextRun({ recurrence: "daily", atTime: "07:00" }, from);
    expect(next.getDate()).toBe(from.getDate() + 1);
  });

  it("skips weekends for a weekdays recurrence", () => {
    const friday = new Date("2026-07-24T20:00:00"); // Friday
    const next = computeNextRun({ recurrence: "weekdays", atTime: "07:00" }, friday);
    expect(next.getDay()).not.toBe(0);
    expect(next.getDay()).not.toBe(6);
    expect(next.getDay()).toBe(1); // Monday
  });

  it("advances a week for a weekly recurrence", () => {
    const from = new Date("2026-07-20T06:00:00");
    const next = computeNextRun({ recurrence: "weekly" }, from);
    expect(next.getTime() - from.getTime()).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000);
  });
});

/** A deterministic fake scheduler backend — no real timers/hardware, per repo test conventions. */
function fakeBackend(now: Date): { backend: SchedulerBackend; fire: (id: string) => void } {
  const callbacks = new Map<string, () => void>();
  let counter = 0;
  const backend: SchedulerBackend = {
    now: () => now,
    scheduleAt: (_at, callback) => {
      counter += 1;
      const handle: SchedulerHandle = { id: `t${counter}` };
      callbacks.set(handle.id, callback);
      return handle;
    },
    cancel: (handle) => {
      callbacks.delete(handle.id);
    },
  };
  return { backend, fire: (id: string) => callbacks.get(id)?.() };
}

describe("PlannerScheduler", () => {
  it("arms a job and reports the next run time", () => {
    const { backend } = fakeBackend(new Date("2026-07-20T06:00:00"));
    const scheduler = new PlannerScheduler(backend);
    const onDue = vi.fn();
    const handle = scheduler.schedule({ recurrence: "daily", atTime: "07:00" }, onDue);
    // `nextRunAt` is an ISO string (UTC-serialized, per `Date.toISOString()`), but `atTime` is
    // documented as local time (`ScheduleSpec.atTime` in types.ts) — the same contract
    // `computeNextRun` implements. Asserting against the raw ISO string's digits (e.g.
    // `toContain("T07:00")`) only happens to pass on a host whose local timezone is UTC+0;
    // parsing it back into a Date and reading local getters checks the same local-time
    // instant `computeNextRun` produced, deterministically, on any host/timezone.
    const nextRun = new Date(handle.nextRunAt);
    expect(nextRun.getHours()).toBe(7);
    expect(nextRun.getMinutes()).toBe(0);
    expect(scheduler.listJobs()).toContain(handle.jobId);
  });

  it("re-arms itself after firing for a recurring schedule", () => {
    const { backend, fire } = fakeBackend(new Date("2026-07-20T06:00:00"));
    const scheduler = new PlannerScheduler(backend);
    const onDue = vi.fn();
    const handle = scheduler.schedule({ recurrence: "daily", atTime: "07:00" }, onDue);

    fire("t1");
    expect(onDue).toHaveBeenCalledTimes(1);
    // still registered under the same jobId since "daily" re-arms
    expect(scheduler.listJobs()).toContain(handle.jobId);
  });

  it("does not re-arm a 'once' schedule after firing", () => {
    const { backend, fire } = fakeBackend(new Date("2026-07-20T06:00:00"));
    const scheduler = new PlannerScheduler(backend);
    const handle = scheduler.schedule({ recurrence: "once" }, () => {});
    fire("t1");
    expect(scheduler.listJobs()).not.toContain(handle.jobId);
  });

  it("cancels a scheduled job", () => {
    const { backend } = fakeBackend(new Date("2026-07-20T06:00:00"));
    const scheduler = new PlannerScheduler(backend);
    const handle = scheduler.schedule({ recurrence: "weekly" }, () => {});
    expect(scheduler.cancel(handle.jobId)).toBe(true);
    expect(scheduler.listJobs()).not.toContain(handle.jobId);
    expect(scheduler.cancel(handle.jobId)).toBe(false);
  });
});
