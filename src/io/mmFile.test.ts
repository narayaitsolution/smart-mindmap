import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortError, fakeHandle } from '../test-fs';
import { ensureWritable, isAbortError, pickOpenHandle, pickSaveHandle, supportsOpenPicker, supportsSavePicker, writeText } from './mmFile';

type Win = { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };
const win = window as unknown as Win;

afterEach(() => {
  delete win.showSaveFilePicker;
  delete win.showOpenFilePicker;
});

describe('feature detection', () => {
  it('reports unsupported browsers', () => {
    expect(supportsSavePicker()).toBe(false);
    expect(supportsOpenPicker()).toBe(false);
  });

  it('reports supported browsers', () => {
    win.showSaveFilePicker = vi.fn();
    win.showOpenFilePicker = vi.fn();
    expect(supportsSavePicker()).toBe(true);
    expect(supportsOpenPicker()).toBe(true);
  });
});

describe('isAbortError', () => {
  it('matches only AbortError', () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('pickSaveHandle', () => {
  it('asks for a .mm file with the suggested name and returns the handle', async () => {
    const handle = fakeHandle();
    const picker = vi.fn(async () => handle);
    win.showSaveFilePicker = picker;
    expect(await pickSaveHandle('Plan.mm')).toBe(handle);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'Plan.mm' }));
    const opts = (picker.mock.calls[0] as unknown[])[0] as { types: { accept: Record<string, string[]> }[] };
    expect(Object.values(opts.types[0].accept).flat()).toEqual(['.mm']);
  });

  it('returns null when the user cancels', async () => {
    win.showSaveFilePicker = vi.fn(async () => {
      throw abortError();
    });
    expect(await pickSaveHandle('Plan.mm')).toBeNull();
  });

  it('rethrows other errors', async () => {
    win.showSaveFilePicker = vi.fn(async () => {
      throw new Error('denied');
    });
    await expect(pickSaveHandle('Plan.mm')).rejects.toThrow('denied');
  });

  it('returns null when the browser has no picker', async () => {
    expect(await pickSaveHandle('Plan.mm')).toBeNull();
  });
});

describe('pickOpenHandle', () => {
  it('returns the first picked handle and offers .mm and .json', async () => {
    const handle = fakeHandle();
    const picker = vi.fn(async () => [handle]);
    win.showOpenFilePicker = picker;
    expect(await pickOpenHandle()).toBe(handle);
    const opts = (picker.mock.calls[0] as unknown[])[0] as { multiple: boolean; types: { accept: Record<string, string[]> }[] };
    expect(opts.multiple).toBe(false);
    expect(Object.values(opts.types[0].accept).flat().sort()).toEqual(['.json', '.mm']);
  });

  it('returns null on cancel and rethrows other errors', async () => {
    win.showOpenFilePicker = vi.fn(async () => {
      throw abortError();
    });
    expect(await pickOpenHandle()).toBeNull();
    win.showOpenFilePicker = vi.fn(async () => {
      throw new Error('nope');
    });
    await expect(pickOpenHandle()).rejects.toThrow('nope');
  });
});

describe('writeText', () => {
  it('writes the whole text and closes the stream', async () => {
    const handle = fakeHandle();
    await writeText(handle, '<map/>');
    expect(handle.writes).toEqual(['<map/>']);
  });

  it('aborts the stream and rethrows when the write fails', async () => {
    const handle = fakeHandle();
    handle.fail = new Error('disk full');
    await expect(writeText(handle, '<map/>')).rejects.toThrow('disk full');
    expect(handle.running).toBe(0);
    expect(handle.writes).toEqual([]);
  });
});

describe('ensureWritable', () => {
  const withPerms = (query: string, request?: string) => {
    const handle = fakeHandle() as ReturnType<typeof fakeHandle> & Record<string, unknown>;
    handle.queryPermission = vi.fn(async () => query);
    if (request) handle.requestPermission = vi.fn(async () => request);
    return handle;
  };

  it('trusts handles that cannot report permission', async () => {
    expect(await ensureWritable(fakeHandle())).toBe(true);
  });

  it('skips the prompt when write access is already granted', async () => {
    const handle = withPerms('granted', 'denied');
    expect(await ensureWritable(handle)).toBe(true);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('asks once and follows the answer', async () => {
    expect(await ensureWritable(withPerms('prompt', 'granted'))).toBe(true);
    expect(await ensureWritable(withPerms('prompt', 'denied'))).toBe(false);
  });

  it('treats a throwing permission API as no access', async () => {
    const handle = fakeHandle() as ReturnType<typeof fakeHandle> & Record<string, unknown>;
    handle.queryPermission = vi.fn(async () => {
      throw new Error('x');
    });
    expect(await ensureWritable(handle)).toBe(false);
  });
});
