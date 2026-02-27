export interface PollOptions {
  intervalMs: number;
  maxWaitMs: number;
  onPoll?: (elapsed: number) => void;
}

export async function pollUntil<T>(
  check: () => Promise<{ done: boolean; result?: T; error?: string }>,
  opts: PollOptions,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed > opts.maxWaitMs) {
      throw new Error(`Polling timed out after ${Math.round(opts.maxWaitMs / 1000)}s`);
    }
    opts.onPoll?.(elapsed);
    const status = await check();
    if (status.error) {
      throw new Error(status.error);
    }
    if (status.done && status.result !== undefined) {
      return status.result;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}
