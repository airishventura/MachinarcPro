/** Coalesce wakeups while a poll is awaiting I/O, so only one poll can claim capacity. */
export function startWorkerLoop(poll: (isStopped: () => boolean) => Promise<void>, pollMs: number, onError: (error: unknown) => void) {
  let stopped = false, running = false, requested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let immediate: ReturnType<typeof setImmediate> | null = null;

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
      if (!stopped) {
        if (requested) wake();
        else timer = setTimeout(() => { timer = null; wake(); }, pollMs);
      }
    }
  }

  wake();
  return { wake, stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (immediate) clearImmediate(immediate);
  } };
}
