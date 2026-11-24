import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AUTOSAVE_MS, createSerialQueue } from '../io/autosave';
import { exportFreeMind } from '../io/freemind';
import { safeFileName } from '../io/download';
import { isAbortError, pickSaveHandle, writeText, type FileHandleLike } from '../io/mmFile';
import type { Mindmap } from '../model/mindmap';

interface Binding {
  handle: FileHandleLike;
  mapId: string;
  /** What the file is known to contain. Null until the first successful write. */
  lastMap: Mindmap | null;
  lastText: string | null;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface FileSaveError {
  file: string;
  reason: string;
}

const isDirty = (b: Binding, map: Mindmap) => map !== b.lastMap && exportFreeMind(map) !== b.lastText;

/** Keeps one map linked to a local .mm file and writes it without dialogs. Writes are serialized. */
export function useMmFile(maps: Mindmap[]) {
  const mapsRef = useRef(maps);
  const binding = useRef<Binding | null>(null);
  const queue = useRef<ReturnType<typeof createSerialQueue> | null>(null);
  queue.current ??= createSerialQueue();
  const [error, setError] = useState<FileSaveError | null>(null);

  useLayoutEffect(() => {
    mapsRef.current = maps;
  }, [maps]);

  /** Writes the bound map. Periodic calls skip a clean file; explicit saves always write. Resolves true on success, never rejects. */
  const write = useCallback(
    (force: boolean) =>
      (queue.current as ReturnType<typeof createSerialQueue>).run(async () => {
        const b = binding.current;
        if (!b) return false;
        const map = mapsRef.current.find((m) => m.id === b.mapId);
        if (!map) {
          binding.current = null;
          setError(null);
          return false;
        }
        if (!force && !isDirty(b, map)) return true;
        const text = exportFreeMind(map);
        try {
          await writeText(b.handle, text);
          b.lastMap = map;
          b.lastText = text;
          setError(null);
          return true;
        } catch (e) {
          if (!isAbortError(e)) setError({ file: b.handle.name, reason: reason(e) });
          return false;
        }
      }),
    [],
  );

  useEffect(() => {
    const id = setInterval(() => void write(false), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [write]);

  /** Link an opened file. The map already matches the file, so nothing is written until it changes. */
  const attach = useCallback((handle: FileHandleLike, map: Mindmap) => {
    binding.current = { handle, mapId: map.id, lastMap: map, lastText: exportFreeMind(map) };
    setError(null);
  }, []);

  /** Ask for a file, link it to the map and write it. Returns the file name, or null when cancelled or the write failed (the error is then in `error`). */
  const saveAs = useCallback(
    async (map: Mindmap): Promise<string | null> => {
      const handle = await pickSaveHandle(safeFileName(map.title, 'mm'));
      if (!handle) return null;
      binding.current = { handle, mapId: map.id, lastMap: null, lastText: null };
      return (await write(true)) ? handle.name : null;
    },
    [write],
  );

  return {
    error,
    isBound: useCallback(() => binding.current !== null, []),
    fileName: useCallback(() => binding.current?.handle.name ?? null, []),
    attach,
    saveAs,
    save: useCallback(() => write(true), [write]),
    /** True when the linked file lacks changes that exist in the app. */
    unsaved: useCallback(() => {
      const b = binding.current;
      const map = b && mapsRef.current.find((m) => m.id === b.mapId);
      return Boolean(b && map && isDirty(b, map));
    }, []),
  };
}
