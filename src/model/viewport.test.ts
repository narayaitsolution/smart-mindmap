import { describe, expect, it } from 'vitest';
import { fitViewport, screenToWorld, worldToScreen, zoomAt } from './viewport';

describe('viewport math', () => {
  it('converts between screen and world space', () => {
    const vp = { x: 100, y: 50, zoom: 2 };
    expect(screenToWorld(vp, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(vp, { x: 100, y: 100 })).toEqual({ x: 300, y: 250 });
  });

  it('keeps the world point under the cursor fixed when zooming', () => {
    const vp = { x: 40, y: -20, zoom: 1 };
    const cursor = { x: 200, y: 150 };
    const before = screenToWorld(vp, cursor);
    const next = zoomAt(vp, cursor, 1.5);
    expect(next.zoom).toBeCloseTo(1.5);
    const after = screenToWorld(next, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom to the allowed range', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 3.9 }, { x: 0, y: 0 }, 10).zoom).toBe(4);
    expect(zoomAt({ x: 0, y: 0, zoom: 0.11 }, { x: 0, y: 0 }, 0.01).zoom).toBe(0.1);
  });

  it('fits bounds inside the screen with padding and centers them', () => {
    const vp = fitViewport({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, { width: 800, height: 600 }, 40);
    expect(vp.zoom).toBeCloseTo(0.72);
    const topLeft = worldToScreen(vp, { x: 0, y: 0 });
    const bottomRight = worldToScreen(vp, { x: 1000, y: 500 });
    expect(topLeft.x).toBeCloseTo(40);
    expect(800 - bottomRight.x).toBeCloseTo(40);
    expect(topLeft.y).toBeCloseTo(600 - bottomRight.y);
  });

  it('never zooms in past 1 when fitting a tiny map', () => {
    expect(fitViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 800, height: 600 }, 40).zoom).toBe(1);
  });
});
