import { describe, expect, it } from 'vitest';
import { fitViewport, pinchViewport, screenToWorld, worldToScreen, zoomAt } from './viewport';

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

  describe('pinchViewport', () => {
    const start = { x: 40, y: -20, zoom: 1 };

    it('scales by finger distance and keeps the world point under the midpoint', () => {
      const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
      const to: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 50, y: 100 }, { x: 250, y: 100 }];
      const world = screenToWorld(start, { x: 150, y: 100 });
      const next = pinchViewport(start, from, to);
      expect(next.zoom).toBeCloseTo(2);
      const back = worldToScreen(next, world);
      expect(back.x).toBeCloseTo(150);
      expect(back.y).toBeCloseTo(100);
    });

    it('translates with the midpoint when the distance is unchanged', () => {
      const next = pinchViewport(start, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 130, y: 120 }, { x: 230, y: 120 }]);
      expect(next).toEqual({ x: 70, y: 0, zoom: 1 });
    });

    it('clamps zoom and ignores fingers starting on the same spot', () => {
      expect(pinchViewport(start, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }]).zoom).toBe(4);
      expect(pinchViewport(start, [{ x: 5, y: 5 }, { x: 5, y: 5 }], [{ x: 0, y: 0 }, { x: 90, y: 0 }]).zoom).toBe(1);
    });
  });
});
