import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { translate, type MessageKey } from '../i18n';
import { downloadBlob, safeFileName } from '../io/download';
import { exportFreeMind, importFreeMind } from '../io/freemind';
import { assertImportSize, exportJson, ImportError, importJson } from '../io/json';
import { ensureWritable, pickOpenHandle, supportsOpenPicker, supportsSavePicker, type FileHandleLike } from '../io/mmFile';
import { mapToJpg, mapToPdf, mapToPng, mapToSvg } from '../io/raster';
import { createStickyNote, deleteStickyNote, descendantIds, mapBounds, moveStickyNote, newId, updateStickyNote, visibleNodes, type Bounds, type Mindmap, type Side } from '../model/mindmap';
import { fitViewport, zoomAt } from '../model/viewport';
import { importExceedsImageBudget } from '../model/workspace';
import { applyTheme, loadPrefs, resolveTheme, savePrefs, type Prefs } from '../prefs';
import { Canvas, type Selection } from './Canvas';
import { ConfirmDelete } from './ConfirmDelete';
import { Dropdown } from './Dropdown';
import { FullscreenToggle } from './FullscreenToggle';
import { Inspector } from './Inspector';
import { StickyNoteEditor } from './StickyNoteEditor';
import { MapTitle } from './MapTitle';
import { ThemeToggle } from './ThemeToggle';
import { useMmFile } from './useMmFile';
import { useWorkspace } from './useWorkspace';

type Notice = { kind: 'info' | 'error'; text: string } | null;

type IconName = 'new' | 'open' | 'save' | 'note' | 'mindmaps' | 'export' | 'fit' | 'tidy';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    new: <><path d="M14 2H5v20h14V7l-5-5Z M14 2v5h5" /><path d="M12 11v7m-3.5-3.5h7" /></>,
    open: <><path d="M3 6h7l2 2h9v11H3z" /><path d="M3 19l3-8h16l-3 8z" /></>,
     save: <><path d="M4 3h14l3 3v15H3V3z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
     note: <><path d="M5 3h14v18H5z" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
    mindmaps: <><rect x="2" y="9" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="16" y="15" width="6" height="6" rx="1" /><path d="M8 12h4m0-6v12m0-12h4m-4 12h4" /></>,
    export: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 17v4h16v-4" /></>,
    fit: <><rect x="2" y="3" width="20" height="15" rx="1" /><path d="M8 21h8m-4-3v3M8 10 5 7m0 0h3M5 7v3m11 1 3 3m0 0h-3m3 0v-3" /></>,
    tidy: <><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /><path d="M12 7v5M5 17v-5h14v5" /></>,
  };
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImportError('File could not be read'));
    reader.readAsText(file);
  });
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function unionBounds(maps: Mindmap[]): Bounds | null {
  if (maps.length === 0) return null;
  return maps.map(mapBounds).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function App() {
  const store = useWorkspace();
  const { ws, dispatch } = store;
  const mm = useMmFile(ws.maps);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<Selection | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Selection | null>(null);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [openSticky, setOpenSticky] = useState<{ mapId: string; noteId: string } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFit = useRef<'active' | 'all' | null>(null);

  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(key, vars), []);

  useEffect(() => {
    applyTheme(prefs.theme);
    document.documentElement.lang = 'en';
    savePrefs(prefs);
  }, [prefs]);

  const stageSize = () => {
    const r = stageRef.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null;
  };

  const fit = useCallback(
    (what: 'active' | 'all') => {
      const size = stageSize();
      const maps = what === 'all' ? ws.maps : ws.maps.filter((m) => m.id === ws.activeMapId);
      const bounds = unionBounds(maps);
      if (size && bounds) dispatch({ type: 'viewport', viewport: fitViewport(bounds, size, 48) });
    },
    [ws.maps, ws.activeMapId, dispatch],
  );

  useEffect(() => {
    if (!pendingFit.current) return;
    const what = pendingFit.current;
    pendingFit.current = null;
    fit(what);
  }, [ws.maps, ws.activeMapId, fit]);

  useEffect(() => {
    if (!focusNode) return;
    const el = document.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(focusNode)}"]`);
    el?.focus();
    setFocusNode(null);
  }, [focusNode, ws.maps]);

  const activeMap = ws.maps.find((m) => m.id === ws.activeMapId) ?? null;
  const selectedNode =
    selected && activeMap && selected.mapId === activeMap.id && visibleNodes(activeMap).some((n) => n.id === selected.nodeId)
      ? activeMap.nodes[selected.nodeId]
      : null;

  const select = useCallback(
    (sel: Selection | null) => {
      setSelected(sel);
      if (sel) dispatch({ type: 'activate', mapId: sel.mapId });
    },
    [dispatch],
  );

  const createMap = () => {
    pendingFit.current = 'active';
    store.create(`${t('maps.defaultTitle')} ${ws.maps.length + 1}`, t('maps.defaultRoot'));
    setSelected(null);
    setEditing(null);
  };

  const addChild = (mapId: string, nodeId: string, side: Side = 'right') => {
    const id = store.addChild(mapId, nodeId, t('node.default'), side);
    setSelected({ mapId, nodeId: id });
    setFocusNode(id);
  };

  const addSibling = (mapId: string, nodeId: string) => {
    const id = store.addSibling(mapId, nodeId, t('node.default'));
    setSelected({ mapId, nodeId: id });
    setFocusNode(id);
  };

  const afterDelete = (mapId: string, parent: string | null) => {
    setSelected(parent ? { mapId, nodeId: parent } : null);
    if (parent) setFocusNode(parent);
  };

  /** A leaf is removed at once. A node with children asks whether they go too. */
  const remove = (mapId: string, nodeId: string) => {
    const map = ws.maps.find((m) => m.id === mapId);
    const node = map?.nodes[nodeId];
    if (!map || !node || node.parentId === null) return;
    if (descendantIds(map, nodeId).length > 0) {
      setPendingDelete({ mapId, nodeId });
      return;
    }
    if (!window.confirm(t('node.deleteConfirm'))) return;
    store.remove(mapId, nodeId);
    afterDelete(mapId, node.parentId);
  };

  const confirmDelete = (keepChildren: boolean) => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    const parent = ws.maps.find((m) => m.id === target.mapId)?.nodes[target.nodeId]?.parentId ?? null;
    if (keepChildren) store.removeKeepChildren(target.mapId, target.nodeId);
    else store.remove(target.mapId, target.nodeId);
    afterDelete(target.mapId, parent);
  };

  const cancelDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target) setFocusNode(target.nodeId);
  };

  const commitEdit = (text: string) => {
    const target = editing;
    setEditing(null);
    if (!target) return;
    if (text.trim() !== '') store.update(target.mapId, target.nodeId, { text });
    setFocusNode(target.nodeId);
  };

  const cancelEdit = () => {
    const target = editing;
    setEditing(null);
    if (target) setFocusNode(target.nodeId);
  };

  const addStickyNote = () => {
    if (!activeMap) return;
    const noteId = newId();
    const x = -ws.viewport.x / ws.viewport.zoom + 80;
    const y = -ws.viewport.y / ws.viewport.zoom + 80;
    store.mutate(activeMap.id, (map) => createStickyNote(map, noteId, x, y));
    setOpenSticky({ mapId: activeMap.id, noteId });
  };

  const sticky = openSticky ? ws.maps.find((map) => map.id === openSticky.mapId)?.stickyNotes?.[openSticky.noteId] : undefined;
  const updateOpenSticky = useCallback((text: string) => {
    if (openSticky) store.mutate(openSticky.mapId, (map) => updateStickyNote(map, openSticky.noteId, text));
  }, [openSticky, store.mutate]);
  const saveSticky = (text: string) => {
    updateOpenSticky(text);
    setOpenSticky(null);
  };
  const closeSticky = () => setOpenSticky(null);
  const deleteSticky = () => {
    if (!openSticky || !window.confirm(t('sticky.deleteConfirm'))) return;
    store.mutate(openSticky.mapId, (map) => deleteStickyNote(map, openSticky.noteId));
    setOpenSticky(null);
  };

  const zoomBy = (factor: number) => {
    const size = stageSize() ?? { width: 0, height: 0 };
    dispatch({ type: 'viewport', viewport: zoomAt(ws.viewport, { x: size.width / 2, y: size.height / 2 }, factor) });
  };

  /** `handle` is set when the file came from the File System Access picker, so a .mm file can be saved back in place. */
  const onImport = async (file: File | undefined, handle?: FileHandleLike) => {
    if (!file) return;
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.mm') || name.endsWith('.json')) assertImportSize(file.size);
      let maps: Mindmap[];
      if (name.endsWith('.mm')) maps = [importFreeMind(await readFile(file))];
      else if (name.endsWith('.json')) maps = importJson(await readFile(file));
      else {
        setNotice({ kind: 'error', text: t('import.failed', { reason: t('import.unsupported') }) });
        return;
      }
      if (importExceedsImageBudget(ws, maps)) throw new ImportError('Images would exceed the workspace limit (max 20 MB)');
      pendingFit.current = 'active';
      dispatch({ type: 'merge', maps });
      setSelected(null);
      if (handle && name.endsWith('.mm')) {
        if (await ensureWritable(handle)) {
          mm.attach(handle, maps[0]);
          setNotice({ kind: 'info', text: t('import.done', { count: maps.length }) });
        } else {
          setNotice({ kind: 'info', text: t('io.openedNoAutosave', { file: handle.name }) });
        }
      } else {
        setNotice({ kind: 'info', text: t('import.done', { count: maps.length }) });
      }
    } catch (e) {
      setNotice({ kind: 'error', text: t('import.failed', { reason: reason(e) }) });
    }
  };

  const openFile = async () => {
    if (!supportsOpenPicker()) {
      fileRef.current?.click();
      return;
    }
    try {
      const handle = await pickOpenHandle();
      if (handle) await onImport(await handle.getFile(), handle);
    } catch (e) {
      setNotice({ kind: 'error', text: t('import.failed', { reason: reason(e) }) });
    }
  };

  const noticeSaved = (file: string) => setNotice({ kind: 'info', text: t('io.saved', { file }) });

  /** Browser storage always gets the newest data. The selected file is written when there is one. */
  const saveNow = async () => {
    await store.flush();
    if (!activeMap) return;
    if (mm.isBound()) {
      if (await mm.save()) noticeSaved(mm.fileName() ?? '');
    } else if (supportsSavePicker()) {
      await saveAs();
    } else {
      await exportAs('mm');
    }
  };

  const saveAs = async () => {
    if (!activeMap) return;
    try {
      const file = await mm.saveAs(activeMap);
      if (file) noticeSaved(file);
    } catch (e) {
      setNotice({ kind: 'error', text: t('io.exportFailed', { reason: reason(e) }) });
    }
  };

  const unsaved = () => store.unsaved() || store.saveFailed || mm.unsaved();
  const shortcut = useRef(saveNow);
  const guard = useRef(unsaved);
  useLayoutEffect(() => {
    shortcut.current = saveNow;
    guard.current = unsaved;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 's' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      e.preventDefault();
      void shortcut.current();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!guard.current()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  const exportAs = async (kind: 'json' | 'mm' | 'png' | 'jpg' | 'svg' | 'pdf') => {
    if (!activeMap) return;
    try {
      const file = (ext: string) => safeFileName(activeMap.title, ext);
      if (kind === 'json') downloadBlob(new Blob([exportJson([activeMap])], { type: 'application/json' }), file('json'));
      else if (kind === 'mm') downloadBlob(new Blob([exportFreeMind(activeMap)], { type: 'application/xml' }), file('mm'));
      else if (kind === 'svg') downloadBlob(mapToSvg(activeMap), file('svg'));
      else if (kind === 'png') downloadBlob(await mapToPng(activeMap), file('png'));
      else if (kind === 'jpg') downloadBlob(await mapToJpg(activeMap), file('jpg'));
      else downloadBlob(await mapToPdf(activeMap), file('pdf'));
    } catch (e) {
      setNotice({ kind: 'error', text: t('io.exportFailed', { reason: reason(e) }) });
    }
  };

  const actions = useMemo(
    () => ({
      select,
      move: store.move,
      settle: store.settle,
      resize: store.resize,
      setViewport: (viewport: typeof ws.viewport) => dispatch({ type: 'viewport', viewport }),
      addChild,
      addSibling,
      remove,
      toggle: store.toggle,
       rename: (sel: Selection) => {
         select(sel);
         setEditing(sel);
       },
       moveStickyNote: (mapId: string, noteId: string, x: number, y: number) => store.mutate(mapId, (map) => moveStickyNote(map, noteId, x, y)),
       openStickyNote: (mapId: string, noteId: string) => setOpenSticky({ mapId, noteId }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [select, store.move, store.settle, store.resize, store.toggle, store.mutate, dispatch, ws.maps, t],
  );

  const exportItems: [Parameters<typeof exportAs>[0], MessageKey][] = [
    ['json', 'io.exportJson'],
    ['mm', 'io.exportMm'],
    ['png', 'io.exportPng'],
    ['jpg', 'io.exportJpg'],
    ['svg', 'io.exportSvg'],
    ['pdf', 'io.exportPdf'],
  ];

  const pendingNode = pendingDelete ? ws.maps.find((m) => m.id === pendingDelete.mapId)?.nodes[pendingDelete.nodeId] : undefined;
  const pendingMap = pendingDelete ? ws.maps.find((m) => m.id === pendingDelete.mapId) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="sr-only">{t('app.title')}</h1>
        <div className="row">
          <button type="button" className="primary" onClick={createMap} aria-label={t('maps.new')} title={t('maps.new')}>
            <Icon name="new" />
          </button>
          <button type="button" onClick={() => void openFile()} aria-label={t('io.open')} title={t('io.open')}>
            <Icon name="open" />
          </button>
          <button type="button" disabled={!activeMap} onClick={() => void saveNow()} aria-label={t('io.save')} title={t('io.save')}>
            <Icon name="save" />
          </button>
          <button type="button" className="icon" disabled={!activeMap} onClick={addStickyNote} aria-label={t('sticky.add')} title={t('sticky.add')}>
            <Icon name="note" />
          </button>
          {supportsSavePicker() && (
            <button type="button" disabled={!activeMap} onClick={() => void saveAs()}>
              {t('io.saveAs')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.mm,application/json,text/xml"
            hidden
            aria-label={t('io.importHint')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              void onImport(file);
              e.target.value = '';
            }}
          />
          <Dropdown label={t('maps.list')} icon={<Icon name="tidy" />} menu={false} align="left" disabled={ws.maps.length === 0}>
            {(close) => (
              <>
                {ws.maps.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-current={m.id === ws.activeMapId ? 'true' : undefined}
                    onClick={() => {
                      pendingFit.current = 'active';
                      dispatch({ type: 'activate', mapId: m.id });
                      close();
                    }}
                  >
                    {m.title}
                  </button>
                ))}
                <button
                  type="button"
                  className="danger"
                  disabled={!activeMap}
                  onClick={() => {
                    close();
                    if (activeMap && window.confirm(t('maps.deleteConfirm'))) {
                      dispatch({ type: 'remove', mapId: activeMap.id });
                      setSelected(null);
                    }
                  }}
                >
                  {t('maps.delete')}
                </button>
              </>
            )}
          </Dropdown>
        </div>
        {activeMap && (
          <MapTitle mapId={activeMap.id} title={activeMap.title} t={t} onRename={(title) => dispatch({ type: 'rename', mapId: activeMap.id, title })} />
        )}
        <div className="row topbar-right">
          <ThemeToggle
            label={t('theme.dark')}
            theme={resolveTheme(prefs.theme)}
            onToggle={(next) => setPrefs({ theme: next })}
          />
          <FullscreenToggle t={t} onError={(text) => setNotice({ kind: 'error', text })} />
          <Dropdown label={t('io.exportMenu')} icon={<Icon name="export" />} disabled={!activeMap}>
            {(close) =>
              exportItems.map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void exportAs(kind);
                  }}
                >
                  {t(label)}
                </button>
              ))
            }
          </Dropdown>
        </div>
      </header>

      {(notice || mm.error || store.saveFailed || store.state === 'error') && (
        <div className="notices">
          {store.state === 'error' && <p role="alert" className="notice error">{t('maps.loadError')}</p>}
          {store.saveFailed && <p role="alert" className="notice error">{t('maps.saveError')}</p>}
          {mm.error && <p role="alert" className="notice error">{t('io.fileSaveFailed', { file: mm.error.file, reason: mm.error.reason })}</p>}
          {notice && (
            <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`notice ${notice.kind}`}>
              <span>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label={t('notice.dismiss')}>
                ×
              </button>
            </p>
          )}
        </div>
      )}

      <main className="stage" ref={stageRef}>
        <Canvas
          maps={ws.maps}
          selected={selected}
          viewport={ws.viewport}
          t={t}
          actions={actions}
          editing={editing}
          onEditCommit={commitEdit}
           onEditCancel={cancelEdit}
           onStickyNoteOpen={(mapId, noteId) => setOpenSticky({ mapId, noteId })}
         />
        {store.state === 'loading' && <p className="overlay muted">{t('maps.loading')}</p>}
        {store.state !== 'loading' && ws.maps.length === 0 && (
          <div className="overlay empty">
            <h2>{t('maps.empty.title')}</h2>
            <p>{t('maps.empty.body')}</p>
            <button type="button" className="primary" onClick={createMap}>
              {t('maps.new')}
            </button>
          </div>
        )}
        <div className="zoombar" role="group" aria-label={t('view.zoomLevel', { percent: Math.round(ws.viewport.zoom * 100) })}>
          <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={t('view.zoomOut')}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="10" cy="10" r="7" /><path d="M15 15l5 5M7 10h6" />
            </svg>
          </button>
          <span>{Math.round(ws.viewport.zoom * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.25)} aria-label={t('view.zoomIn')}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="10" cy="10" r="7" /><path d="M15 15l5 5M7 10h6M10 7v6" />
            </svg>
          </button>
          <button type="button" onClick={() => fit('all')} disabled={ws.maps.length === 0} aria-label={t('view.fit')} title={t('view.fit')}>
            <Icon name="fit" />
          </button>
          <button type="button" onClick={() => activeMap && store.tidy(activeMap.id)} disabled={!activeMap} aria-label={t('view.autoLayout')} title={t('view.autoLayout')}>
            <Icon name="mindmaps" />
          </button>
        </div>
        {selectedNode && activeMap && (
          <Inspector
            node={selectedNode}
            t={t}
            onClose={() => setSelected(null)}
            onAddSibling={() => addSibling(activeMap.id, selectedNode.id)}
            onPatch={(patch) => store.update(activeMap.id, selectedNode.id, patch)}
            onResize={(size) => store.resize(activeMap.id, selectedNode.id, size)}
          />
        )}
      </main>
       {sticky && openSticky && (
         <StickyNoteEditor text={sticky.text} t={t} onSave={saveSticky} onAutoSave={updateOpenSticky} onClose={closeSticky} onDelete={deleteSticky} />
       )}
       {pendingDelete && pendingNode && pendingMap && (

        <ConfirmDelete
          text={pendingNode.text}
          count={descendantIds(pendingMap, pendingNode.id).length}
          t={t}
          onNodeOnly={() => confirmDelete(true)}
          onSubtree={() => confirmDelete(false)}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
}
