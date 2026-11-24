import { DEFAULT_EDGE_WIDTH, MAX_EDGE_WIDTH, MAX_NODE_HEIGHT, MAX_NODE_WIDTH, MIN_NODE_WIDTH, NODE_HEIGHT, nodeSize, type MindNode, type NodePatch, type NodeSizePatch } from '../model/mindmap';
import { useEffect, useState } from 'react';
import { SWATCHES } from '../model/color';
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

type T = Props['t'];

/** Text of the selected node. Edits apply live; blank text is never saved and reverts on blur. */
function TextField({ node, t, onPatch }: { node: MindNode; t: T; onPatch(patch: NodePatch): boolean | void }) {
  const [draft, setDraft] = useState(node.text);
  useEffect(() => setDraft(node.text), [node.id, node.text]);
  return (
    <div className="field">
      <label htmlFor="node-text">{t('node.textField')}</label>
      <textarea
        id="node-text"
        className="node-text"
        rows={2}
        maxLength={2000}
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          const value = e.target.value.replace(/[\r\n]+/g, ' ');
          setDraft(value);
          if (value.trim() !== '') onPatch({ text: value });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        onBlur={() => setDraft(node.text)}
      />
    </div>
  );
}

function Swatches({ current, label, name, disabled, t, onPick }: { current: string | undefined; label: string; name: 'node.swatchFill' | 'node.swatchLine'; disabled?: boolean; t: T; onPick(hex: string): void }) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {SWATCHES.map((s) => {
        const color = t(`color.${s.id}`);
        return (
          <button
            key={s.id}
            type="button"
            className="swatch"
            style={{ background: s.hex }}
            disabled={disabled}
            aria-label={t(name, { color })}
            title={color}
            aria-pressed={current?.toLowerCase() === s.hex}
            onClick={() => onPick(s.hex)}
          />
        );
      })}
    </div>
  );
}

/** Floating panel for the selected node: text, appearance and note. */
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
        <TextField node={node} t={t} onPatch={onPatch} />

        <div className="field">
          <button type="button" className="primary action" disabled={isRoot} onClick={onAddSibling}>
            {t('node.addSibling')}
          </button>
        </div>

        <div className="field">
          <label htmlFor="node-fill">{t('node.fill')}</label>
          <Swatches current={node.color} label={t('node.fillPresets')} name="node.swatchFill" t={t} onPick={(hex) => onPatch({ color: hex })} />
          <div className="row">
            <input id="node-fill" type="color" value={node.color ?? '#ffffff'} onChange={(e) => onPatch({ color: e.target.value })} />
            <button type="button" onClick={() => onPatch({ color: undefined })} aria-pressed={node.color === undefined}>
              {t('node.transparent')}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="edge-color">{t('node.edgeColor')}</label>
          <Swatches current={node.edgeColor ?? '#000000'} label={t('node.linePresets')} name="node.swatchLine" disabled={isRoot} t={t} onPick={(hex) => onPatch({ edgeColor: hex })} />
          <div className="row">
            <input id="edge-color" type="color" disabled={isRoot} value={node.edgeColor ?? '#000000'} onChange={(e) => onPatch({ edgeColor: e.target.value })} />
            <button type="button" disabled={isRoot} onClick={() => onPatch({ edgeColor: undefined })} aria-pressed={node.edgeColor === undefined}>
              {t('node.black')}
            </button>
          </div>
        </div>

        <div className="slider-field">
          <label htmlFor="edge-width">{t('node.edgeWidth')}</label>
          <output htmlFor="edge-width">{node.edgeWidth ?? DEFAULT_EDGE_WIDTH}</output>
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
        </div>

        <div className="slider-field">
          <label htmlFor="node-width">{t('node.width')}</label>
          <output htmlFor="node-width">{size.width}</output>
          <input id="node-width" type="range" min={MIN_NODE_WIDTH} max={MAX_NODE_WIDTH} step={8} value={size.width} onChange={(e) => onResize({ width: Number(e.target.value) })} />
        </div>

        <div className="slider-field">
          <label htmlFor="node-height">{t('node.height')}</label>
          <output htmlFor="node-height">{size.height}</output>
          <input id="node-height" type="range" min={NODE_HEIGHT} max={MAX_NODE_HEIGHT} step={8} value={size.height} onChange={(e) => onResize({ height: Number(e.target.value) })} />
        </div>

        <div className="field">
          <button type="button" disabled={!resized} onClick={() => onResize(null)}>
            {t('node.resetSize')}
          </button>
        </div>

        <NoteEditor key={node.id} note={node.note} t={t} onChange={(note) => onPatch({ note }) !== false} />
      </div>
    </aside>
  );
}
