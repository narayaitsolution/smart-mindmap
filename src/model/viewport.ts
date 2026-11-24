import type { Bounds, Point } from './mindmap';
import { clampZoom, type Viewport } from './workspace';

export const screenToWorld = (vp: Viewport, p: Point): Point => ({ x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom });
export const worldToScreen = (vp: Viewport, p: Point): Point => ({ x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y });

export function zoomAt(vp: Viewport, cursor: Point, factor: number): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  const world = screenToWorld(vp, cursor);
  return { zoom, x: cursor.x - world.x * zoom, y: cursor.y - world.y * zoom };
}

type Pair = readonly [Point, Point];

const midpoint = (p: Pair): Point => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
const gap = (p: Pair) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);

/**
 * Two-finger gesture: the world point under the starting midpoint follows the current midpoint,
 * and zoom scales with the change in finger distance. Fingers that began on one spot only pan.
 */
export function pinchViewport(vp: Viewport, from: Pair, to: Pair): Viewport {
  const d0 = gap(from);
  const zoom = clampZoom(d0 > 0 ? vp.zoom * (gap(to) / d0) : vp.zoom);
  const world = screenToWorld(vp, midpoint(from));
  const m = midpoint(to);
  return { zoom, x: m.x - world.x * zoom, y: m.y - world.y * zoom };
}

export function fitViewport(b: Bounds, size: { width: number; height: number }, padding: number): Viewport {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const zoom = clampZoom(Math.min(1, (size.width - padding * 2) / w, (size.height - padding * 2) / h));
  return {
    zoom,
    x: (size.width - w * zoom) / 2 - b.minX * zoom,
    y: (size.height - h * zoom) / 2 - b.minY * zoom,
  };
}
