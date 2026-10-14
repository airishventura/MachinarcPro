/** Coalesce wakeups while a poll is awaiting I/O, so only one poll can claim capacity. */
export function startWorkerLoop(poll: (isStopped: () => boolean) => Promise<void>, pollMs: number, onError: (error: unknown) => void) {
  let stopped = false, running = false, requested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let immediate: ReturnType<typeof setImmediate> | null = null;
  const idleWaiters = new Set<() => void>();

  function wake() {
    if (stopped) return;
    requested = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!running && !immediate) immediate = setImmediate(() => { immediate = null; void loop(); });
  }

  async function loop() {
    if (stopped || running) return;
    running = true;
    requested = false;
    try { await poll(() => stopped); }
    catch (error) { onError(error); }
    finally {
      running = false;
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
      if (!stopped) {
        if (requested) wake();
        else timer = setTimeout(() => { timer = null; wake(); }, pollMs);
      }
    }
  }

  wake();
  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (immediate) clearImmediate(immediate);
  }
  return { wake, stop, async stopAndWait() {
    stop();
    if (running) await new Promise<void>(resolve => idleWaiters.add(resolve));
  } };
}
