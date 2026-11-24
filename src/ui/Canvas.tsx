import { useEffect, useMemo, useRef, useState } from 'react';
import { readableTextColor } from '../model/color';
import {
  childrenOf,
  DEFAULT_EDGE_COLOR,
  DEFAULT_EDGE_WIDTH,
  edgePath,
  childrenOnSide,
  hiddenChildCount,
  LINE_HEIGHT,
  nodeLines,
  nodeSize,
  sideOf,
  visibleNodes,
  type MindNode,
  type Mindmap,
  type NodeSizePatch,
  type Side,
} from '../model/mindmap';
import { notePreview } from '../model/note';
import { pinchViewport, zoomAt } from '../model/viewport';
import type { Viewport } from '../model/workspace';
import type { MessageKey } from '../i18n';

export interface Selection {
  mapId: string;
  nodeId: string;
}

export interface CanvasActions {
  select(sel: Selection | null): void;
  move(mapId: string, nodeId: string, x: number, y: number): void;
  /** Called once when a node drag ends, to separate overlapping sibling blocks. */
  settle(mapId: string, nodeId: string): void;
  resize(mapId: string, nodeId: string, size: NodeSizePatch | null): void;
  setViewport(vp: Viewport): void;
  addChild(mapId: string, nodeId: string, side?: Side): void;
  addSibling(mapId: string, nodeId: string): void;
  remove(mapId: string, nodeId: string): void;
  toggle(mapId: string, nodeId: string): void;
  rename(sel: Selection): void;
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface Props {
  maps: Mindmap[];
  selected: Selection | null;
  viewport: Viewport;
  t: T;
  actions: CanvasActions;
  /** Node whose text is being edited in place. */
  editing: Selection | null;
  onEditCommit(text: string): void;
  onEditCancel(): void;
}

type Handle = 'e' | 'w' | 'n' | 's';

const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 64;

type Pt = { x: number; y: number };

type Drag =
  | { kind: 'resize'; id: number; mapId: string; nodeId: string; handle: Handle; startX: number; startY: number; width: number; height: number }
  | { kind: 'node'; id: number; mapId: string; nodeId: string; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'pan'; id: number; touch: boolean; startX: number; startY: number; originX: number; originY: number; last: Pt }
  /** Two touch fingers: `from` are their positions when the pinch began, `origin` the viewport then. */
  | { kind: 'pinch'; ids: [number, number]; from: [Pt, Pt]; now: [Pt, Pt]; origin: Viewport };

/**
 * Inline text editor laid over a node. Enter or blur saves, Escape cancels.
 * The caret starts after the existing text so typing continues it. The box tracks the typed text
 * with the same sizing and wrapping rule the saved node uses, so a long label wraps onto more lines
 * and a manual size is respected. Nodes on the left keep their right edge.
 */
function NodeEditor({ node, side, label, onCommit, onCancel }: { node: MindNode; side: Side; label: string; onCommit(text: string): void; onCancel(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState(node.text);
  const start = useRef(nodeSize(node).width);
  const draft = { ...node, text: value };
  const { width, height } = nodeSize(draft);
  const lines = nodeLines(draft).length;
  const x = side === 'left' ? node.x + start.current - width : node.x;
  // Centers the wrapped lines vertically; the 2px border is part of the box.
  const padTop = Math.max(0, (height - lines * LINE_HEIGHT) / 2 - 2);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value);
    else onCancel();
  };

  return (
    <foreignObject x={x} y={node.y} width={width} height={height} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="node-edit"
        rows={1}
        maxLength={2000}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        value={value}
        style={{ paddingTop: padTop, lineHeight: `${LINE_HEIGHT}px` }}
        onChange={(e) => setValue(e.target.value.replace(/[\r\n]+/g, ' '))}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          }
        }}
      />
    </foreignObject>
  );
}

const MINUS = 'M -4 0 H 4';
const PLUS = 'M -4 0 H 4 M 0 -4 V 4';

/**
 * The root offers a control on both sides. Any other node offers one on the side away from its
 * parent, plus any side that already holds children, so no child is left without a toggle.
 */
function sidesFor(map: Mindmap, node: MindNode): Side[] {
  if (node.parentId === null) return ['left', 'right'];
  const away = sideOf(map, node);
  const other: Side = away === 'right' ? 'left' : 'right';
  return childrenOnSide(map, node.id, other).length > 0 ? ['left', 'right'] : [away];
}

function MapLayer({ map, selected, editingId, t, onResizeDown, onResizeReset, onNodeDown, onNodeClick, onNodeKey, onNodeEdit, onToggle, onAddChild, onEditCommit, onEditCancel }: {
  map: Mindmap;
  selected: string | null;
  editingId: string | null;
  t: T;
  onResizeDown: (e: React.PointerEvent<SVGElement>, map: Mindmap, node: MindNode, handle: Handle) => void;
  onResizeReset: (map: Mindmap, node: MindNode) => void;
  onNodeDown: (e: React.PointerEvent<SVGGElement>, map: Mindmap, node: MindNode) => void;
  onNodeClick: (map: Mindmap, node: MindNode) => void;
  onNodeKey: (e: React.KeyboardEvent<SVGGElement>, map: Mindmap, node: MindNode) => void;
  onNodeEdit: (map: Mindmap, node: MindNode) => void;
  onToggle: (map: Mindmap, node: MindNode) => void;
  onAddChild: (map: Mindmap, node: MindNode, side: Side) => void;
  onEditCommit: (text: string) => void;
  onEditCancel: () => void;
}) {
  const nodes = useMemo(() => visibleNodes(map), [map]);
  return (
    <g>
      {nodes.map((n) => {
        if (n.parentId === null) return null;
        return (
          <path
            key={`e-${n.id}`}
            className="edge"
            d={edgePath(map.nodes[n.parentId], n)}
            fill="none"
            stroke={n.edgeColor ?? DEFAULT_EDGE_COLOR}
            strokeWidth={n.edgeWidth ?? DEFAULT_EDGE_WIDTH}
            strokeLinecap="round"
            data-default={n.edgeColor ? undefined : 'true'}
          />
        );
      })}
      {nodes.map((n) => {
        const { width, height } = nodeSize(n);
        const hasKids = childrenOf(map, n.id).length > 0;
        const folded = Boolean(n.collapsed) && hasKids;
        const editing = editingId === n.id;
        const lines = nodeLines(n);
        return (
          <g key={n.id} className="node-wrap" data-resized={n.width !== undefined || n.height !== undefined ? 'true' : undefined}>
            <g
              className="node"
              data-node-id={n.id}
              onClick={() => onNodeClick(map, n)}
              onDoubleClick={() => onNodeEdit(map, n)}
              role="button"
              tabIndex={0}
              aria-label={n.note ? t('node.labelNote', { text: n.text, preview: notePreview(n.note) }) : t('node.label', { text: n.text })}
              aria-pressed={selected === n.id}
              transform={`translate(${n.x} ${n.y})`}
              onPointerDown={(e) => onNodeDown(e, map, n)}
              onKeyDown={(e) => onNodeKey(e, map, n)}
            >
              {!editing && <rect className="node-box" width={width} height={height} rx={6} fill={n.color ?? 'none'} />}
              {/* Transparent nodes sit on the themed canvas: CSS swaps their ink (.node-label-auto); filled nodes keep computed contrast text. */}
              <rect width={width} height={height} fill="transparent" />
              {!editing && (
                <text className={n.color ? undefined : 'node-label-auto'} textAnchor="middle" dominantBaseline="central" fill={readableTextColor(n.color)}>
                  {lines.map((line, i) => (
                    <tspan key={i} x={width / 2} y={height / 2 + (i - (lines.length - 1) / 2) * LINE_HEIGHT}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
              {n.note && (
                <g className="note-indicator" transform={`translate(${width - 8} 0)`}>
                  <title>{notePreview(n.note, 200)}</title>
                  <circle r={9} cx={0} cy={0} />
                  <path d="M -4 -3 H 4 M -4 0 H 4 M -4 3 H 1" />
                </g>
              )}
            </g>
            {!editing && (
              <g className="resize-handles" aria-hidden="true" transform={`translate(${n.x} ${n.y})`} data-selected={selected === n.id ? 'true' : undefined}>
                {(
                  [
                    ['e', width, 0, width, height],
                    ['w', 0, 0, 0, height],
                    ['n', 0, 0, width, 0],
                    ['s', 0, height, width, height],
                  ] as const
                ).map(([handle, x1, y1, x2, y2]) => (
                  <line
                    key={handle}
                    className="resize-edge"
                    data-handle={handle}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    onPointerDown={(e) => onResizeDown(e, map, n, handle)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onResizeReset(map, n);
                    }}
                  >
                    <title>{t('node.resize')}</title>
                  </line>
                ))}
              </g>
            )}
            {editing && <NodeEditor node={n} side={sideOf(map, n)} label={t('node.text')} onCommit={onEditCommit} onCancel={onEditCancel} />}
            {sidesFor(map, n).map((side) => {
              const sideKids = childrenOnSide(map, n.id, side).length;
              const x = side === 'right' ? n.x + width + 16 : n.x - 16;
              const y = n.y + height / 2;
              const stop = (e: React.PointerEvent) => e.stopPropagation();
              if (sideKids === 0) {
                const act = () => onAddChild(map, n, side);
                return (
                  <g
                    key={side}
                    className="side-control add-toggle"
                    data-side={side}
                    role="button"
                    tabIndex={0}
                    aria-label={t(side === 'right' ? 'node.addChildRight' : 'node.addChildLeft')}
                    transform={`translate(${x} ${y})`}
                    onPointerDown={stop}
                    onClick={act}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        act();
                      }
                    }}
                  >
                    <circle className="hit" r={12} />
                    <circle r={9} />
                    <path d={PLUS} />
                  </g>
                );
              }
              return (
                <g
                  key={side}
                  className="side-control fold-toggle"
                  data-side={side}
                  role="button"
                  tabIndex={0}
                  aria-label={folded ? t('node.badge', { count: hiddenChildCount(map, n.id) }) : t('node.collapse')}
                  aria-expanded={!folded}
                  transform={`translate(${x} ${y})`}
                  onPointerDown={stop}
                  onClick={() => onToggle(map, n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggle(map, n);
                    }
                  }}
                >
                  <circle className="hit" r={12} />
                  <circle r={9} />
                  <path d={folded ? PLUS : MINUS} />
                  {folded && (
                    <text x={side === 'right' ? 16 : -16} textAnchor={side === 'right' ? 'start' : 'end'} dominantBaseline="central">
                      {hiddenChildCount(map, n.id)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export function Canvas({ maps, selected, viewport, t, actions, editing, onEditCommit, onEditCancel }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      actionsRef.current.setViewport(zoomAt(vpRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }, factor));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onNodeDown = (e: React.PointerEvent<SVGGElement>, map: Mindmap, node: MindNode) => {
    if (e.button !== 0) return;
    // A touch while another gesture runs belongs to that gesture: let it reach the canvas.
    if (e.pointerType === 'touch' && drag.current) return;
    e.stopPropagation();
    actions.select({ mapId: map.id, nodeId: node.id });
    drag.current = { kind: 'node', id: e.pointerId, mapId: map.id, nodeId: node.id, startX: e.clientX, startY: e.clientY, originX: node.x, originY: node.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onResizeDown = (e: React.PointerEvent<SVGElement>, map: Mindmap, node: MindNode, handle: Handle) => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch' && drag.current) return;
    e.stopPropagation();
    actions.select({ mapId: map.id, nodeId: node.id });
    const size = nodeSize(node);
    drag.current = { kind: 'resize', id: e.pointerId, mapId: map.id, nodeId: node.id, handle, startX: e.clientX, startY: e.clientY, ...size };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onNodeKey = (e: React.KeyboardEvent<SVGGElement>, map: Mindmap, node: MindNode) => {
    const sel = { mapId: map.id, nodeId: node.id };
    const hasKids = childrenOf(map, node.id).length > 0;
    // Alt + arrows resize from the keyboard, Alt+0 restores the automatic size.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const step = e.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
      const { width, height } = nodeSize(node);
      const keyed: Record<string, NodeSizePatch | null> = {
        ArrowRight: { width: width + step },
        ArrowLeft: { width: width - step },
        ArrowDown: { height: height + step },
        ArrowUp: { height: height - step },
        '0': null,
      };
      if (e.key in keyed) {
        e.preventDefault();
        e.stopPropagation();
        actions.resize(map.id, node.id, keyed[e.key]);
        return;
      }
    }
    switch (e.key) {
      case 'Tab':
        // Shift+Tab keeps moving focus backwards as usual.
        if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) break;
        e.preventDefault();
        actions.addChild(map.id, node.id, sideOf(map, node));
        break;
      case 'Enter':
        e.preventDefault();
        actions.select(sel);
        break;
      case 'Insert':
        e.preventDefault();
        actions.addChild(map.id, node.id, sideOf(map, node));
        break;
      case 'Delete':
        e.preventDefault();
        if (node.parentId !== null) actions.remove(map.id, node.id);
        break;
      case 'ArrowLeft':
        if (hasKids && !node.collapsed) {
          e.preventDefault();
          actions.toggle(map.id, node.id);
        }
        break;
      case 'ArrowRight':
        if (hasKids && node.collapsed) {
          e.preventDefault();
          actions.toggle(map.id, node.id);
        }
        break;
      case 'F2':
        e.preventDefault();
        actions.select(sel);
        actions.rename(sel);
        break;
    }
  };

  const local = (e: React.PointerEvent): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pinch') {
      const i = d.ids.indexOf(e.pointerId);
      if (i < 0) return;
      d.now[i] = local(e);
      actions.setViewport(pinchViewport(d.origin, d.from, d.now));
      return;
    }
    if (e.pointerId !== d.id) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.kind === 'resize') {
      const patch: NodeSizePatch = {};
      if (d.handle === 'e' || d.handle === 'w') {
        const west = d.handle === 'w';
        patch.width = d.width + (west ? -dx : dx) / viewport.zoom;
        patch.anchor = west ? 'right' : 'left';
      } else if (d.handle === 'n') {
        patch.height = d.height - dy / viewport.zoom;
        patch.anchorY = 'bottom';
      } else patch.height = d.height + dy / viewport.zoom;
      actions.resize(d.mapId, d.nodeId, patch);
    } else if (d.kind === 'node') actions.move(d.mapId, d.nodeId, d.originX + dx / viewport.zoom, d.originY + dy / viewport.zoom);
    else {
      d.last = local(e);
      actions.setViewport({ ...viewport, x: d.originX + dx, y: d.originY + dy });
    }
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    if (d.kind === 'pinch') {
      const i = d.ids.indexOf(e.pointerId);
      if (i < 0) return;
      // The finger left behind keeps panning from where it is, so the map does not jump.
      const rest = 1 - i;
      const vp = vpRef.current;
      drag.current = { kind: 'pan', id: d.ids[rest], touch: true, startX: d.now[rest].x, startY: d.now[rest].y, originX: vp.x, originY: vp.y, last: d.now[rest] };
      return;
    }
    if (e.pointerId === d.id) {
      drag.current = null;
      if (d.kind === 'node' && (e.clientX !== d.startX || e.clientY !== d.startY)) actions.settle(d.mapId, d.nodeId);
    }
  };

  const onCanvasDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const d = drag.current;
    if (e.pointerType === 'touch' && d) {
      // Second finger on a pan turns it into a pinch; any other running gesture, or a third finger, wins.
      if (d.kind === 'pan' && d.touch && d.id !== e.pointerId) {
        const vp = vpRef.current;
        drag.current = { kind: 'pinch', ids: [d.id, e.pointerId], from: [d.last, local(e)], now: [d.last, local(e)], origin: vp };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    actions.select(null);
    const at = local(e);
    drag.current = { kind: 'pan', id: e.pointerId, touch: e.pointerType === 'touch', startX: e.clientX, startY: e.clientY, originX: viewport.x, originY: viewport.y, last: at };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  return (
    <svg
      ref={svgRef}
      className="canvas"
      role="group"
      aria-label={t('canvas.label')}
      onPointerDown={onCanvasDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {maps.map((m) => (
          <MapLayer
            key={m.id}
            map={m}
            selected={selected?.mapId === m.id ? selected.nodeId : null}
            editingId={editing?.mapId === m.id ? editing.nodeId : null}
            t={t}
            onResizeDown={onResizeDown}
            onResizeReset={(m, n) => actions.resize(m.id, n.id, null)}
            onNodeDown={onNodeDown}
            onNodeClick={(m, n) => actions.select({ mapId: m.id, nodeId: n.id })}
            onNodeKey={onNodeKey}
            onNodeEdit={(m, n) => actions.rename({ mapId: m.id, nodeId: n.id })}
            onToggle={(m, n) => actions.toggle(m.id, n.id)}
            onAddChild={(m, n, side) => actions.addChild(m.id, n.id, side)}
            onEditCommit={onEditCommit}
            onEditCancel={onEditCancel}
          />
        ))}
      </g>
    </svg>
  );
}
