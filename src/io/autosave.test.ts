import { describe, expect, it } from 'vitest';
import { AUTOSAVE_MS, createSerialQueue } from './autosave';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('createSerialQueue', () => {
  it('runs jobs one at a time in submission order', async () => {
    const q = createSerialQueue();
    const log: string[] = [];
    const gate = deferred();
    const first = q.run(async () => {
      log.push('a:start');
      await gate.promise;
      log.push('a:end');
      return 'a';
    });
    const second = q.run(async () => {
      log.push('b:start');
      return 'b';
    });
    await Promise.resolve();
    expect(log).toEqual(['a:start']);
    gate.resolve();
    expect(await first).toBe('a');
    expect(await second).toBe('b');
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('keeps running later jobs after one rejects, and still rejects that caller', async () => {
    const q = createSerialQueue();
    const bad = q.run(() => Promise.reject(new Error('boom')));
    const good = q.run(async () => 'ok');
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBe('ok');
  });
});

describe('AUTOSAVE_MS', () => {
  it('is a sane periodic interval', () => {
    expect(AUTOSAVE_MS).toBeGreaterThanOrEqual(5_000);
    expect(AUTOSAVE_MS).toBeLessThanOrEqual(60_000);
  });
});
