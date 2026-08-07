import type { ScheduleSpec } from "./types.js";

/**
 * There is no real OS-level scheduler/notification backend in this repo
 * (no native toolchain), so — following the same convention as
 * `@ryper/voice-engine`'s audio/wake-word injection points — this module
 * defines the scheduling *contract* plus a real, tested in-process
 * implementation backed by an injectable clock. A platform shell later
 * supplies a real OS-timer/notification-backed `SchedulerBackend`;
 * `computeNextRun` and `PlannerScheduler`'s bookkeeping are honest,
 * fully-working logic today regardless of which backend sits underneath.
 */
export interface SchedulerHandle {
  readonly id: string;
}

export interface SchedulerBackend {
  now(): Date;
  /** Schedules `callback` to run at `at`; returns a handle usable with `cancel`. */
  scheduleAt(at: Date, callback: () => void): SchedulerHandle;
  cancel(handle: SchedulerHandle): void;
}

/** Real backend for a running process: `Date.now()` + `setTimeout`. Not wired to any OS notification/wake system. */
export function createSystemSchedulerBackend(): SchedulerBackend {
  let counter = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    now: () => new Date(),
    scheduleAt(at, callback) {
      counter += 1;
      const id = `timer-${counter}`;
      const delayMs = Math.max(0, at.getTime() - Date.now());
      const timer = setTimeout(callback, delayMs);
      timers.set(id, timer);
      return { id };
    },
    cancel(handle) {
      const timer = timers.get(handle.id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(handle.id);
      }
    },
  };
}

/**
 * Computes the next Date a `ScheduleSpec` fires, strictly after `from`. Pure — no I/O, easy to unit test.
 *
 * `schedule.atTime` is documented (see `ScheduleSpec` in `types.ts`) as a
 * local-time wall clock — "remind me daily at 7am" means 7am in the
 * caller's own timezone, not UTC — so this function deliberately uses
 * local-time `Date` methods (`setHours`/`getDate`/`getDay`, ...) rather
 * than their `setUTCHours`/`getUTCDate`/`getUTCDay` equivalents. That is
 * intentional and correct, not a bug: on any single host it is
 * self-consistent regardless of that host's configured timezone, because
 * both the input (`from`) and the local-time arithmetic below run in the
 * same timezone. Callers that serialize the result (e.g.
 * `PlannerScheduler.schedule()`'s `nextRunAt`, via `Date.toISOString()`)
 * get back a UTC-rendered instant, as `toISOString()` always does — code
 * that wants to check the local wall-clock hour/minute back out of that
 * string must parse it into a `Date` and read local getters again, not
 * string-match the ISO text (see `scheduler.test.ts`'s
 * "arms a job and reports the next run time" for a worked example).
 */
export function computeNextRun(schedule: ScheduleSpec, from: Date): Date {
  const next = new Date(from);

  if (schedule.recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
    if (schedule.atTime) {
      const [hourStr, minuteStr] = schedule.atTime.split(":");
      next.setHours(Number(hourStr), Number(minuteStr ?? "0"), 0, 0);
    }
    return next;
  }

  if (schedule.atTime) {
    const [hourStr, minuteStr] = schedule.atTime.split(":");
    next.setHours(Number(hourStr), Number(minuteStr ?? "0"), 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
  } else {
    next.setDate(next.getDate() + 1);
  }

  if (schedule.recurrence === "weekdays") {
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
  }
  return next;
}

export interface ScheduledPlanHandle {
  readonly jobId: string;
  /**
   * ISO-8601, UTC-rendered (`Date.toISOString()`) instant of the next
   * run. Represents the same absolute moment as the local-time
   * `ScheduleSpec.atTime` the job was scheduled with — parse it back into
   * a `Date` and read local getters (`getHours()`, ...) to recover the
   * local wall-clock time, rather than string-matching the ISO text.
   */
  readonly nextRunAt: string;
}

/**
 * Registers a callback to run according to a `ScheduleSpec`, re-arming
 * itself for every recurrence except `"once"`. The Planner Engine uses
 * this for `scheduled` and `recursive` intent shapes.
 */
export class PlannerScheduler {
  private readonly jobs = new Map<string, { schedule: ScheduleSpec; handle: SchedulerHandle }>();
  private counter = 0;

  constructor(private readonly backend: SchedulerBackend = createSystemSchedulerBackend()) {}

  schedule(schedule: ScheduleSpec, onDue: () => void): ScheduledPlanHandle {
    this.counter += 1;
    const jobId = `job-${this.counter}`;
    const nextRun = computeNextRun(schedule, this.backend.now());
    const arm = (spec: ScheduleSpec, from: Date): void => {
      const at = computeNextRun(spec, from);
      const handle = this.backend.scheduleAt(at, () => {
        onDue();
        if (spec.recurrence !== "once") {
          arm(spec, at);
        } else {
          this.jobs.delete(jobId);
        }
      });
      this.jobs.set(jobId, { schedule: spec, handle });
    };
    arm(schedule, this.backend.now());
    return { jobId, nextRunAt: nextRun.toISOString() };
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    this.backend.cancel(job.handle);
    this.jobs.delete(jobId);
    return true;
  }

  listJobs(): readonly string[] {
    return [...this.jobs.keys()];
  }
}

export function createPlannerScheduler(backend?: SchedulerBackend): PlannerScheduler {
  return new PlannerScheduler(backend);
}
