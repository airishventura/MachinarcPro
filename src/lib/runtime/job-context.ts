import { AsyncLocalStorage } from "node:async_hooks";

/** Log metadata and a local abort signal; database leases remain the ownership authority. */
export const jobContext = new AsyncLocalStorage<{
  jobId: string; workerId: string; attempt: number; runId?: string; machineId?: string; signal: AbortSignal;
}>();
export const getJobContext = () => jobContext.getStore();
