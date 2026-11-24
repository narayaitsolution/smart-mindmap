import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_MS } from '../io/autosave';
import { exportFreeMind } from '../io/freemind';
import { exportJson } from '../io/json';
import { addChild, createMindmap } from '../model/mindmap';
import { clearWorkspace, loadWorkspace } from '../storage/persistence';
import { abortError, fakeHandle } from '../test-fs';
import { App } from './App';

type Win = { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };
const win = window as unknown as Win;

let ticks: (() => void)[] = [];

beforeEach(async () => {
  localStorage.clear();
  await clearWorkspace();
  ticks = [];
  const real = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === AUTOSAVE_MS) {
      ticks.push(fn);
      return 0;
    }
    return (real as (...a: unknown[]) => number)(fn, ms, ...rest);
  }) as typeof setInterval);
});

afterEach(() => {
  delete win.showSaveFilePicker;
  delete win.showOpenFilePicker;
  vi.restoreAllMocks();
});

const tick = async () => {
  await act(async () => {
    for (const fn of [...ticks]) fn();
    await new Promise((r) => setTimeout(r, 20));
  });
};

const createMap = async () => {
  render(<App />);
  await screen.findByText('No mindmaps yet');
  fireEvent.click(screen.getAllByRole('button', { name: 'New mindmap' })[0]);
  return screen.findByRole('button', { name: 'Node: Core idea' });
};

const rename = (root: HTMLElement, text: string) => {
  fireEvent.doubleClick(root);
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: text } });
  fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Enter' });
};

const unload = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

const ctrlS = (init: KeyboardEventInit = { ctrlKey: true }) => {
  const e = new KeyboardEvent('keydown', { key: 's', cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(e);
  return e;
};

const installSavePicker = (handle: ReturnType<typeof fakeHandle>) => {
  const picker = vi.fn(async () => handle);
  win.showSaveFilePicker = picker;
  return picker;
};

describe('login removal', () => {
  it('has no Login or Logout button', async () => {
    await createMap();
    expect(screen.queryByRole('button', { name: 'Login' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
  });
});

describe('Save As with the File System Access API', () => {
  it('is offered only when the browser has a save picker', async () => {
    await createMap();
    expect(screen.queryByRole('button', { name: 'Save as' })).toBeNull();
  });

  it('keeps the handle and autosaves to it periodically without another dialog', async () => {
    const handle = fakeHandle();
    const picker = installSavePicker(handle);
    const root = await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));
    await waitFor(() => expect(handle.writes).toHaveLength(1));
    expect(handle.writes[0]).toContain('TEXT="Core idea"');
    expect(picker).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toContain('Saved to Mindmap-1.mm');

    rename(root, 'Edited');
    await screen.findByRole('button', { name: 'Node: Edited' });
    expect(handle.writes).toHaveLength(1);
    await tick();
    expect(handle.writes).toHaveLength(2);
    expect(handle.writes[1]).toContain('TEXT="Edited"');
    await tick();
    expect(handle.writes).toHaveLength(2);
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('stays silent and keeps the previous state when the dialog is cancelled', async () => {
    win.showSaveFilePicker = vi.fn(async () => {
      throw abortError();
    });
    await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports a failed write and retries it on the next autosave', async () => {
    const handle = fakeHandle();
    handle.fail = new Error('disk full');
    installSavePicker(handle);
    await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));
    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
    handle.fail = null;
    await tick();
    expect(handle.writes).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('serializes overlapping writes so the file is never written twice at once', async () => {
    const handle = fakeHandle();
    let release!: () => void;
    handle.gate = new Promise<void>((r) => (release = r));
    installSavePicker(handle);
    const root = await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));
    await waitFor(() => expect(handle.createWritable).toHaveBeenCalledTimes(1));
    rename(root, 'Second');
    ctrlS();
    await tick();
    await tick();
    expect(handle.createWritable).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(handle.writes.at(-1)).toContain('TEXT="Second"'));
    expect(handle.maxRunning).toBe(1);
  });
});

describe('Ctrl/Cmd+S', () => {
  it('writes to the selected file and blocks the browser dialog, with Ctrl or Cmd', async () => {
    const handle = fakeHandle();
    const picker = installSavePicker(handle);
    const root = await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));
    await waitFor(() => expect(handle.writes).toHaveLength(1));
    rename(root, 'One');
    await screen.findByRole('button', { name: 'Node: One' });
    expect(ctrlS().defaultPrevented).toBe(true);
    await waitFor(() => expect(handle.writes).toHaveLength(2));
    rename(screen.getByRole('button', { name: 'Node: One' }), 'Two');
    await screen.findByRole('button', { name: 'Node: Two' });
    ctrlS({ metaKey: true });
    await waitFor(() => expect(handle.writes).toHaveLength(3));
    expect(handle.writes[2]).toContain('TEXT="Two"');
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('opens Save As when no file is selected yet and the browser supports it', async () => {
    const handle = fakeHandle();
    const picker = installSavePicker(handle);
    await createMap();
    expect(ctrlS().defaultPrevented).toBe(true);
    await waitFor(() => expect(handle.writes).toHaveLength(1));
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('persists to the browser and downloads a .mm when there is no picker', async () => {
    await createMap();
    const names: string[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:s'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    expect(ctrlS().defaultPrevented).toBe(true);
    await waitFor(() => expect(names).toEqual(['Mindmap-1.mm']));
    expect((await loadWorkspace())?.maps).toHaveLength(1);
  });

  it('ignores other shortcuts and Ctrl+Shift+S', async () => {
    await createMap();
    expect(ctrlS({ ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(ctrlS({}).defaultPrevented).toBe(false);
  });

  it('still blocks the browser dialog and does not fail when there is no mindmap', async () => {
    render(<App />);
    await screen.findByText('No mindmaps yet');
    expect(ctrlS().defaultPrevented).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Open with the File System Access API', () => {
  const xml = exportFreeMind(createMindmap({ id: 'a', title: 'Disk map', rootText: 'From disk', at: { x: 0, y: 0 } }));

  it('retains the handle of an opened .mm file and autosaves edits back to it', async () => {
    const handle = fakeHandle('disk.mm', xml);
    const picker = vi.fn(async () => [handle]);
    win.showOpenFilePicker = picker;
    render(<App />);
    await screen.findByText('No mindmaps yet');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const root = await screen.findByRole('button', { name: 'Node: From disk' });
    await tick();
    expect(handle.writes).toHaveLength(0);
    rename(root, 'Changed on disk');
    await screen.findByRole('button', { name: 'Node: Changed on disk' });
    await tick();
    expect(handle.writes).toHaveLength(1);
    expect(handle.writes[0]).toContain('TEXT="Changed on disk"');
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('does not bind a .json file to a .mm writer', async () => {
    let map = createMindmap({ id: 'j', title: 'J', rootText: 'Json root', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c', 'Kid');
    const handle = fakeHandle('p.json', exportJson([map]));
    win.showOpenFilePicker = vi.fn(async () => [handle]);
    render(<App />);
    await screen.findByText('No mindmaps yet');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const root = await screen.findByRole('button', { name: 'Node: Json root' });
    rename(root, 'Edited json');
    await screen.findByRole('button', { name: 'Node: Edited json' });
    await tick();
    expect(handle.createWritable).not.toHaveBeenCalled();
  });

  it('does not bind the file when write access is refused, and says so', async () => {
    const handle = Object.assign(fakeHandle('disk.mm', xml), {
      queryPermission: vi.fn(async () => 'prompt'),
      requestPermission: vi.fn(async () => 'denied'),
    });
    win.showOpenFilePicker = vi.fn(async () => [handle]);
    render(<App />);
    await screen.findByText('No mindmaps yet');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const root = await screen.findByRole('button', { name: 'Node: From disk' });
    expect(screen.getByRole('status').textContent).toContain('without file autosave');
    rename(root, 'Nope');
    await screen.findByRole('button', { name: 'Node: Nope' });
    await tick();
    expect(handle.createWritable).not.toHaveBeenCalled();
  });

  it('ignores a cancelled dialog without an error', async () => {
    win.showOpenFilePicker = vi.fn(async () => {
      throw abortError();
    });
    render(<App />);
    await screen.findByText('No mindmaps yet');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('unsaved-changes warning', () => {
  it('does not warn on a fresh page or after changes are persisted', async () => {
    const root = await createMap();
    rename(root, 'Persisted');
    await waitFor(async () => {
      expect(Object.values((await loadWorkspace())?.maps[0].nodes ?? {}).map((n) => n.text)).toContain('Persisted');
    });
    await tick();
    expect(unload()).toBe(false);
  });

  it('warns while the selected file has changes it has not received, then stops', async () => {
    const handle = fakeHandle();
    installSavePicker(handle);
    const root = await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));
    await waitFor(() => expect(handle.writes).toHaveLength(1));
    await tick();
    expect(unload()).toBe(false);
    rename(root, 'Dirty');
    await screen.findByRole('button', { name: 'Node: Dirty' });
    expect(unload()).toBe(true);
    await tick();
    expect(unload()).toBe(false);
  });

  it('warns while browser storage failed, and retries on the periodic autosave', async () => {
    const root = await createMap();
    await waitFor(async () => expect((await loadWorkspace())?.maps).toHaveLength(1));
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('quota');
    });
    rename(root, 'Retry me');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save to this browser');
    expect(unload()).toBe(true);
    open.mockRestore();
    await tick();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(Object.values((await loadWorkspace())?.maps[0].nodes ?? {}).map((n) => n.text)).toContain('Retry me');
    expect(unload()).toBe(false);
  });
});
