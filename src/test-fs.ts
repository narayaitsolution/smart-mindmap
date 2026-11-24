import { vi } from 'vitest';

/** In-memory stand-in for a File System Access file handle. A write becomes visible in `writes` on close. */
export function fakeHandle(name = 'Mindmap-1.mm', content = '') {
  const h = {
    name,
    writes: [] as string[],
    running: 0,
    maxRunning: 0,
    gate: null as Promise<void> | null,
    fail: null as Error | null,
    createWritable: vi.fn(async () => {
      h.running += 1;
      h.maxRunning = Math.max(h.maxRunning, h.running);
      let buffer = '';
      return {
        write: async (data: string) => {
          if (h.fail) throw h.fail;
          buffer += data;
        },
        close: async () => {
          await h.gate;
          h.writes.push(buffer);
          h.running -= 1;
        },
        abort: async () => {
          h.running -= 1;
        },
      };
    }),
    getFile: vi.fn(async () => new File([content], name)),
  };
  return h;
}

export const abortError = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
