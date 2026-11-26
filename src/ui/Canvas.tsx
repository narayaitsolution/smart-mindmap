import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readableTextColor } from '../model/color';
import {
  childrenOf,
  descendantIds,
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
  type StickyNote,
  type NodeSizePatch,
  type Side,
} from '../model/mindmap';
import { frameAt, MOTION_MS, planMotion, prefersReducedMotion, type MotionFrame, type MotionPlan } from '../model/motion';
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
  reparent?(mapId: string, nodeId: string, parentId: string): void;
  resize(mapId: string, nodeId: string, size: NodeSizePatch | null): void;
  setViewport(vp: Viewport): void;
  addChild(mapId: string, nodeId: string, side?: Side): void;
  addSibling(mapId: string, nodeId: string): void;
  remove(mapId: string, nodeId: string): void;
  toggle(mapId: string, nodeId: string): void;
  rename(sel: Selection): void;
  moveStickyNote?(mapId: string, noteId: string, x: number, y: number): void;
  openStickyNote?(mapId: string, noteId: string): void;
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
  onStickyNoteOpen?(mapId: string, noteId: string): void;
}

type Handle = 'e' | 'w' | 'n' | 's';

const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 64;

type Pt = { x: number; y: number };

type Drag =
  | { kind: 'resize'; id: number; mapId: string; nodeId: string; handle: Handle; startX: number; startY: number; width: number; height: number }
  | { kind: 'node'; id: number; mapId: string; nodeId: string; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'sticky'; id: number; mapId: string; noteId: string; startX: number; startY: number; originX: number; originY: number }
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

const NO_FRAME: MotionFrame = { nodes: {}, ghosts: [], opacity: {} };

/**
 * Short enter/leave animation. Only nodes that appear or disappear between two renders of a map
 * are animated; the layout stays the source of truth and nothing here reaches the model or saves.
 * With prefers-reduced-motion the change is applied at once.
 */
function useMapMotion(maps: Mindmap[]): Record<string, MotionFrame> {
  const prev = useRef<Mindmap[]>(maps);
  const run = useRef<{ plans: Record<string, MotionPlan>; start: number; raf: number } | null>(null);
  const [anim, setAnim] = useState<{ plans: Record<string, MotionPlan>; t: number } | null>(null);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = maps;
    if (before === maps) return;
    const plans: Record<string, MotionPlan> = {};
    for (const m of maps) {
      const plan = planMotion(before.find((b) => b.id === m.id), m);
      if (plan) plans[m.id] = plan;
    }
    if (run.current) {
      cancelAnimationFrame(run.current.raf);
      run.current = null;
    }
    if (Object.keys(plans).length === 0 || prefersReducedMotion()) {
      setAnim(null);
      return;
    }
    const state = { plans, start: performance.now(), raf: 0 };
    run.current = state;
    const step = () => {
      const t = (performance.now() - state.start) / MOTION_MS;
      if (t >= 1) {
        if (run.current === state) run.current = null;
        setAnim(null);
        return;
      }
      setAnim({ plans, t });
      state.raf = requestAnimationFrame(step);
    };
    setAnim({ plans, t: 0 });
    state.raf = requestAnimationFrame(step);
  }, [maps]);

  useEffect(
    () => () => {
      if (run.current) cancelAnimationFrame(run.current.raf);
    },
    [],
  );

  return useMemo(() => {
    const out: Record<string, MotionFrame> = {};
    if (!anim) return out;
    for (const m of maps) {
      const plan = anim.plans[m.id];
      if (plan) out[m.id] = frameAt(m, plan, anim.t);
    }
    return out;
  }, [anim, maps]);
}

/** A node that just left: drawn without controls or events while it contracts toward its parent. */
function GhostNode({ node, opacity }: { node: MindNode; opacity: number }) {
  const { width, height } = nodeSize(node);
  const lines = nodeLines(node);
  return (
    <g className="node-wrap node-ghost" data-ghost-id={node.id} aria-hidden="true" pointerEvents="none" opacity={opacity}>
      <g className="node" transform={`translate(${node.x} ${node.y})`}>
        <rect className="node-box" width={width} height={height} rx={6} fill={node.color ?? 'none'} />
        <text className={node.color ? undefined : 'node-label-auto'} textAnchor="middle" dominantBaseline="central" fill={readableTextColor(node.color)}>
          {lines.map((line, i) => (
            <tspan key={i} x={width / 2} y={height / 2 + (i - (lines.length - 1) / 2) * LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </g>
  );
}

function MapLayer({ map, frame, selected, editingId, t, onResizeDown, onResizeReset, onNodeDown, onNodeClick, onNodeKey, onNodeEdit, onToggle, onAddChild, onEditCommit, onEditCancel, onStickyDown, onStickyOpen }: {
  map: Mindmap;
  frame: MotionFrame;
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
  onStickyDown: (e: React.PointerEvent<SVGGElement>, map: Mindmap, note: StickyNote) => void;
  onStickyOpen: (map: Mindmap, note: StickyNote) => void;
}) {
  const nodes = useMemo(() => visibleNodes(map), [map]);
  // Displayed position: entering nodes are mid-flight, every other node sits where the layout put it.
  const shown = (n: MindNode): MindNode => (frame.nodes[n.id] ? { ...n, ...frame.nodes[n.id] } : n);
  const ghostById = new Map(frame.ghosts.map((g) => [g.id, g]));
  const edgeOf = (n: MindNode, parent: MindNode) => (
    <path
      key={`e-${n.id}`}
      className="edge"
      d={edgePath(parent, n)}
      fill="none"
      stroke={n.edgeColor ?? DEFAULT_EDGE_COLOR}
      strokeWidth={n.edgeWidth ?? DEFAULT_EDGE_WIDTH}
      strokeLinecap="round"
      data-default={n.edgeColor ? undefined : 'true'}
      opacity={frame.opacity[n.id]}
    />
  );
  return (
    <g>
      {nodes.map((n) => {
        if (n.parentId === null) return null;
        return edgeOf(shown(n), shown(map.nodes[n.parentId]));
      })}
      {frame.ghosts.map((g) => {
        const parent = g.parentId === null ? undefined : (ghostById.get(g.parentId) ?? map.nodes[g.parentId]);
        return parent ? edgeOf(g, parent) : null;
      })}
      {frame.ghosts.map((g) => (
        <GhostNode key={`g-${g.id}`} node={g} opacity={frame.opacity[g.id] ?? 1} />
      ))}
      {Object.values(map.stickyNotes ?? {}).map((note) => (
        <g key={note.id} className="sticky-note" transform={`translate(${note.x} ${note.y})`} role="button" tabIndex={0} aria-label={t('sticky.item')} onPointerDown={(e) => onStickyDown(e, map, note)} onClick={() => onStickyOpen(map, note)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStickyOpen(map, note); } }}>
          <rect width="180" height="140" rx="3" />
          <path d="M 148 140 H 180 V 108" />
          <text x="12" y="24">{note.text.split(/\\s+/).slice(0, 8).join(' ') || t('sticky.empty')}</text>
        </g>
      ))}
      {nodes.map((orig) => {
        const n = shown(orig);
        const { width, height } = nodeSize(n);
        const hasKids = childrenOf(map, n.id).length > 0;
        const folded = Boolean(n.collapsed) && hasKids;
        const editing = editingId === n.id;
        const lines = nodeLines(n);
        return (
          <g key={n.id} className="node-wrap" opacity={frame.opacity[n.id]} data-resized={n.width !== undefined || n.height !== undefined ? 'true' : undefined}>
            <g
              className="node"
              data-node-id={n.id}
              onClick={() => onNodeClick(map, orig)}
              onDoubleClick={() => onNodeEdit(map, orig)}
              role="button"
              tabIndex={0}
              aria-label={n.note ? t('node.labelNote', { text: n.text, preview: notePreview(n.note) }) : t('node.label', { text: n.text })}
              aria-pressed={selected === n.id}
              transform={`translate(${n.x} ${n.y})`}
              onPointerDown={(e) => onNodeDown(e, map, orig)}
              onKeyDown={(e) => onNodeKey(e, map, orig)}
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
              {n.url && (
                <g className="link-indicator" aria-hidden="true" transform={`translate(${n.note ? width - 28 : width - 8} 0)`}>
                  <circle r={9} cx={0} cy={0} />
                  <path d="M -1 -4 L 1 -6 A 3 3 0 0 1 5 -2 L 2 1 A 3 3 0 0 1 -2 1 M 1 4 L -1 6 A 3 3 0 0 1 -5 2 L -2 -1 A 3 3 0 0 1 2 -1" />
                </g>
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
                    onPointerDown={(e) => onResizeDown(e, map, orig, handle)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onResizeReset(map, orig);
                    }}
                  >
                    <title>{t('node.resize')}</title>
                  </line>
                ))}
              </g>
            )}
            {editing && <NodeEditor node={n} side={sideOf(map, orig)} label={t('node.text')} onCommit={onEditCommit} onCancel={onEditCancel} />}
            {sidesFor(map, orig).map((side) => {
              const sideKids = childrenOnSide(map, n.id, side).length;
              const x = side === 'right' ? n.x + width + 16 : n.x - 16;
              const y = n.y + height / 2;
              const stop = (e: React.PointerEvent) => e.stopPropagation();
              if (sideKids === 0) {
                const act = () => onAddChild(map, orig, side);
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
                  onClick={() => onToggle(map, orig)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggle(map, orig);
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

export function Canvas({ maps, selected, viewport, t, actions, editing, onEditCommit, onEditCancel, onStickyNoteOpen }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const frames = useMapMotion(maps);

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

  const onStickyDown = (e: React.PointerEvent<SVGGElement>, map: Mindmap, note: StickyNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { kind: 'sticky', id: e.pointerId, mapId: map.id, noteId: note.id, startX: e.clientX, startY: e.clientY, originX: note.x, originY: note.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

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
    else if (d.kind === 'sticky') actions.moveStickyNote?.(d.mapId, d.noteId, d.originX + dx / viewport.zoom, d.originY + dy / viewport.zoom);
    else {
      d.last = local(e);
      actions.setViewport({ ...viewport, x: d.originX + dx, y: d.originY + dy });
    }
  };

  const dropParent = (map: Mindmap, node: MindNode, clientX: number, clientY: number): MindNode | undefined => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom;
    const y = (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom;
    return visibleNodes(map).find((candidate) => {
      if (candidate.id === node.id || candidate.id === node.parentId || descendantIds(map, node.id).includes(candidate.id)) return false;
      const size = nodeSize(candidate);
      return x >= candidate.x && x <= candidate.x + size.width && y >= candidate.y && y <= candidate.y + size.height;
    });
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
      if (d.kind === 'node' && (e.clientX !== d.startX || e.clientY !== d.startY)) {
        const map = maps.find((candidate) => candidate.id === d.mapId);
        const node = map?.nodes[d.nodeId];
        const parent = map && node ? dropParent(map, node, e.clientX, e.clientY) : undefined;
        if (map && node && parent) actions.reparent?.(map.id, node.id, parent.id);
        else actions.settle(d.mapId, d.nodeId);
      }
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
            frame={frames[m.id] ?? NO_FRAME}
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
             onStickyDown={onStickyDown}
             onStickyOpen={(m, n) => onStickyNoteOpen?.(m.id, n.id)}
           />
        ))}
      </g>
    </svg>
  );
}
