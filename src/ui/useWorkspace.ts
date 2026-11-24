import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { addChild, addSibling, createMindmap, deleteNode, deleteNodeKeepChildren, layoutTree, moveSubtree, newId, resizeNode, toggleCollapse, updateNode, type NodePatch, type NodeSizePatch, type Side } from '../model/mindmap';
import { AUTOSAVE_MS, createSerialQueue } from '../io/autosave';
import { mergeImported } from '../io/json';
import { addMap, emptyWorkspace, exceedsImageBudget, importExceedsImageBudget, nextMapPosition, removeMap, replaceAllMaps, replaceMap, type Viewport, type Workspace } from '../model/workspace';
import { loadWorkspace, saveWorkspace } from '../storage/persistence';
import type { Mindmap } from '../model/mindmap';

type Action =
  | { type: 'load'; ws: Workspace }
  | { type: 'create'; title: string; rootText: string }
  | { type: 'merge'; maps: Mindmap[] }
  | { type: 'replaceAll'; maps: Mindmap[] }
  | { type: 'remove'; mapId: string }
  | { type: 'activate'; mapId: string }
  | { type: 'rename'; mapId: string; title: string }
  | { type: 'mutate'; mapId: string; fn: (m: Mindmap) => Mindmap }
  | { type: 'viewport'; viewport: Viewport };

function reducer(ws: Workspace, a: Action): Workspace {
  switch (a.type) {
    case 'load':
      return a.ws;
    case 'create':
      return addMap(
        ws,
        createMindmap({ id: newId(), title: a.title, rootText: a.rootText, at: nextMapPosition(ws) }),
      );
    case 'merge':
      return importExceedsImageBudget(ws, a.maps) ? ws : mergeImported(ws, a.maps);
    case 'replaceAll':
      return replaceAllMaps(ws, a.maps);
    case 'remove':
      return removeMap(ws, a.mapId);
    case 'activate':
      return { ...ws, activeMapId: a.mapId };
    case 'rename':
      return replaceMap(ws, { ...(ws.maps.find((m) => m.id === a.mapId) as Mindmap), title: a.title });
    case 'mutate': {
      const map = ws.maps.find((m) => m.id === a.mapId);
      if (!map) return ws;
      const next = a.fn(map);
      return exceedsImageBudget(ws, next) ? ws : replaceMap(ws, next);
    }
    case 'viewport':
      return { ...ws, viewport: a.viewport };
  }
}

export type LoadState = 'loading' | 'ready' | 'error';

export function useWorkspace() {
  const [ws, dispatch] = useReducer(reducer, undefined, emptyWorkspace);
  const [state, setState] = useState<LoadState>('loading');
  const [saveFailed, setSaveFailed] = useState(false);
  const loaded = useRef(false);
  const latest = useRef(ws);
  const saved = useRef(ws);
  const queue = useRef<ReturnType<typeof createSerialQueue> | null>(null);
  queue.current ??= createSerialQueue();

  useLayoutEffect(() => {
    latest.current = ws;
  }, [ws]);

  useEffect(() => {
    let alive = true;
    loadWorkspace()
      .then((stored) => {
        if (!alive) return;
        if (stored) {
          saved.current = stored;
          dispatch({ type: 'load', ws: stored });
        }
        loaded.current = true;
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        // Leave saving disabled so a failed read can never overwrite data that may still be recoverable.
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Writes the newest workspace to IndexedDB. Serialized, so an older snapshot can never land after a newer one. Never rejects. */
  const flush = useCallback(
    () =>
      (queue.current as ReturnType<typeof createSerialQueue>).run(async () => {
        if (!loaded.current) return;
        const snapshot = latest.current;
        if (snapshot === saved.current) return;
        try {
          await saveWorkspace(snapshot);
          saved.current = snapshot;
          setSaveFailed(false);
        } catch {
          setSaveFailed(true);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => void flush(), 250);
    return () => clearTimeout(timer);
  }, [ws, flush]);

  useEffect(() => {
    const id = setInterval(() => void flush(), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [flush]);

  /** True while map content exists that browser storage has not confirmed. Viewport-only changes do not count. */
  const unsaved = useCallback(() => loaded.current && latest.current.maps !== saved.current.maps, []);

  const mutate = useCallback((mapId: string, fn: (m: Mindmap) => Mindmap) => dispatch({ type: 'mutate', mapId, fn }), []);

  return {
    ws,
    state,
    saveFailed,
    flush,
    unsaved,
    dispatch,
    create: (title: string, rootText: string) => dispatch({ type: 'create', title, rootText }),
    mutate,
    addChild: (mapId: string, nodeId: string, text: string, side: Side = 'right') => {
      const id = newId();
      mutate(mapId, (m) => addChild(m, nodeId, id, text, side));
      return id;
    },
    addSibling: (mapId: string, nodeId: string, text: string) => {
      const id = newId();
      mutate(mapId, (m) => addSibling(m, nodeId, id, text));
      return id;
    },
    remove: (mapId: string, nodeId: string) => mutate(mapId, (m) => deleteNode(m, nodeId)),
    removeKeepChildren: (mapId: string, nodeId: string) => mutate(mapId, (m) => deleteNodeKeepChildren(m, nodeId)),
    toggle: (mapId: string, nodeId: string) => mutate(mapId, (m) => toggleCollapse(m, nodeId)),
    move: (mapId: string, nodeId: string, x: number, y: number) => mutate(mapId, (m) => moveSubtree(m, nodeId, x, y)),
    resize: (mapId: string, nodeId: string, size: NodeSizePatch | null) => mutate(mapId, (m) => resizeNode(m, nodeId, size)),
    update: (mapId: string, nodeId: string, patch: NodePatch): boolean => {
      const map = ws.maps.find((m) => m.id === mapId);
      if (map && exceedsImageBudget(ws, updateNode(map, nodeId, patch))) return false;
      mutate(mapId, (m) => updateNode(m, nodeId, patch));
      return true;
    },
    tidy: (mapId: string) => mutate(mapId, layoutTree),
  };
}
