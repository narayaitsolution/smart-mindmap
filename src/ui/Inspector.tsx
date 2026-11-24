import { DEFAULT_EDGE_WIDTH, MAX_EDGE_WIDTH, MAX_NODE_HEIGHT, MAX_NODE_WIDTH, MIN_NODE_WIDTH, NODE_HEIGHT, nodeSize, type MindNode, type NodePatch, type NodeSizePatch } from '../model/mindmap';
import type { MessageKey } from '../i18n';
import { NoteEditor } from './NoteEditor';

interface Props {
  node: MindNode;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  onClose(): void;
  onAddSibling(): void;
  onPatch(patch: NodePatch): boolean | void;
  onResize(size: NodeSizePatch | null): void;
}

/** Floating panel for the selected node: appearance and note. Text is edited in place on the canvas. */
export function Inspector({ node, t, onClose, onAddSibling, onPatch, onResize }: Props) {
  const isRoot = node.parentId === null;
  const size = nodeSize(node);
  const resized = node.width !== undefined || node.height !== undefined;

  return (
    <aside className="inspector" aria-label={t('inspector.title')}>
      <div className="inspector-head">
        <h2>{t('inspector.title')}</h2>
        <button type="button" className="icon" aria-label={t('inspector.close')} onClick={onClose}>
          ×
        </button>
      </div>

      <div className="inspector-body">
        <div className="field">
          <button type="button" disabled={isRoot} onClick={onAddSibling}>
            {t('node.addSibling')}
          </button>
        </div>

        <div className="field">
          <label htmlFor="node-fill">{t('node.fill')}</label>
          <div className="row">
            <input id="node-fill" type="color" value={node.color ?? '#ffffff'} onChange={(e) => onPatch({ color: e.target.value })} />
            <button type="button" onClick={() => onPatch({ color: undefined })} aria-pressed={node.color === undefined}>
              {t('node.transparent')}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="edge-color">{t('node.edgeColor')}</label>
          <div className="row">
            <input id="edge-color" type="color" disabled={isRoot} value={node.edgeColor ?? '#000000'} onChange={(e) => onPatch({ edgeColor: e.target.value })} />
            <button type="button" disabled={isRoot} onClick={() => onPatch({ edgeColor: undefined })} aria-pressed={node.edgeColor === undefined}>
              {t('node.black')}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="edge-width">{t('node.edgeWidth')}</label>
          <div className="row">
            <input
              id="edge-width"
              type="range"
              min={1}
              max={MAX_EDGE_WIDTH}
              step={1}
              disabled={isRoot}
              value={node.edgeWidth ?? DEFAULT_EDGE_WIDTH}
              onChange={(e) => onPatch({ edgeWidth: Number(e.target.value) })}
            />
            <output htmlFor="edge-width">{node.edgeWidth ?? DEFAULT_EDGE_WIDTH}</output>
          </div>
        </div>

        <div className="field">
          <label htmlFor="node-width">{t('node.width')}</label>
          <div className="row">
            <input id="node-width" type="range" min={MIN_NODE_WIDTH} max={MAX_NODE_WIDTH} step={8} value={size.width} onChange={(e) => onResize({ width: Number(e.target.value) })} />
            <output htmlFor="node-width">{size.width}</output>
          </div>
        </div>

        <div className="field">
          <label htmlFor="node-height">{t('node.height')}</label>
          <div className="row">
            <input id="node-height" type="range" min={NODE_HEIGHT} max={MAX_NODE_HEIGHT} step={8} value={size.height} onChange={(e) => onResize({ height: Number(e.target.value) })} />
            <output htmlFor="node-height">{size.height}</output>
          </div>
          <div className="row">
            <button type="button" disabled={!resized} onClick={() => onResize(null)}>
              {t('node.resetSize')}
            </button>
          </div>
        </div>

        <NoteEditor key={node.id} note={node.note} t={t} onChange={(note) => onPatch({ note }) !== false} />
      </div>
    </aside>
  );
}
