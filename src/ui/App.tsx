import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translate, type MessageKey } from '../i18n';
import { downloadBlob, safeFileName } from '../io/download';
import { exportFreeMind, importFreeMind } from '../io/freemind';
import { assertImportSize, exportJson, ImportError, importJson } from '../io/json';
import { mapToJpg, mapToPdf, mapToPng, mapToSvg } from '../io/raster';
import { descendantIds, mapBounds, visibleNodes, type Bounds, type Mindmap, type Side } from '../model/mindmap';
import { fitViewport, zoomAt } from '../model/viewport';
import { importExceedsImageBudget } from '../model/workspace';
import { applyTheme, loadPrefs, resolveTheme, savePrefs, type Prefs } from '../prefs';
import { Canvas, type Selection } from './Canvas';
import { ConfirmDelete } from './ConfirmDelete';
import { Dropdown } from './Dropdown';
import { Inspector } from './Inspector';
import { MapTitle } from './MapTitle';
import { ThemeToggle } from './ThemeToggle';
import { useWorkspace } from './useWorkspace';

type Notice = { kind: 'info' | 'error'; text: string } | null;

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
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [loggedIn, setLoggedIn] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<Selection | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Selection | null>(null);
  const [focusNode, setFocusNode] = useState<string | null>(null);
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

  const zoomBy = (factor: number) => {
    const size = stageSize() ?? { width: 0, height: 0 };
    dispatch({ type: 'viewport', viewport: zoomAt(ws.viewport, { x: size.width / 2, y: size.height / 2 }, factor) });
  };

  const onImport = async (files: FileList | null) => {
    const file = files?.[0];
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
      setNotice({ kind: 'info', text: t('import.done', { count: maps.length }) });
    } catch (e) {
      setNotice({ kind: 'error', text: t('import.failed', { reason: reason(e) }) });
    }
  };

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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [select, store.move, store.resize, store.toggle, dispatch, ws.maps, t],
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
          <button type="button" className="primary" onClick={createMap}>
            {t('maps.new')}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            {t('io.open')}
          </button>
          <button type="button" disabled={!activeMap} onClick={() => void exportAs('mm')}>
            {t('io.save')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.mm,application/json,text/xml"
            hidden
            aria-label={t('io.importHint')}
            onChange={(e) => {
              const files = e.target.files;
              void onImport(files);
              e.target.value = '';
            }}
          />
          <Dropdown label={t('maps.list')} menu={false} align="left" disabled={ws.maps.length === 0}>
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
          <Dropdown label={t('io.exportMenu')} disabled={!activeMap}>
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
          <button type="button" onClick={() => setLoggedIn((v) => !v)}>
            {loggedIn ? t('auth.logout') : t('auth.login')}
          </button>
        </div>
      </header>

      {(notice || store.saveFailed || store.state === 'error') && (
        <div className="notices">
          {store.state === 'error' && <p role="alert" className="notice error">{t('maps.loadError')}</p>}
          {store.saveFailed && <p role="alert" className="notice error">{t('maps.saveError')}</p>}
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
            −
          </button>
          <span>{t('view.zoomLevel', { percent: Math.round(ws.viewport.zoom * 100) })}</span>
          <button type="button" onClick={() => zoomBy(1.25)} aria-label={t('view.zoomIn')}>
            +
          </button>
          <button type="button" onClick={() => fit('all')} disabled={ws.maps.length === 0}>
            {t('view.fit')}
          </button>
          <button type="button" onClick={() => activeMap && store.tidy(activeMap.id)} disabled={!activeMap}>
            {t('view.autoLayout')}
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
