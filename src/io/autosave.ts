/** Interval of the periodic autosave, for the selected file and for browser storage. */
export const AUTOSAVE_MS = 15_000;

/** Runs async jobs strictly one after another, in submission order. A failed job never blocks the next. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
