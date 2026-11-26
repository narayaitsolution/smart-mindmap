import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJson } from '../io/json';
import { addChild, createMindmap } from '../model/mindmap';
import { clearWorkspace, loadWorkspace } from '../storage/persistence';
import { App } from './App';

beforeEach(async () => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  // These tests check final state; the enter/leave animation is covered in Canvas.motion.test.tsx.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  await clearWorkspace();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ready = async () => {
  render(<App />);
  await screen.findByText('No mindmaps yet');
};

const createMap = async () => {
  await ready();
  fireEvent.click(screen.getAllByRole('button', { name: 'New mindmap' })[0]);
  return screen.findByRole('button', { name: 'Node: Core idea' });
};

describe('App', () => {
  it('shows accessible icon controls and a numeric zoom percentage', async () => {
    await ready();
    for (const name of ['New mindmap', 'Open', 'Save', 'Mindmaps', 'Export', 'Fit to screen', 'Tidy layout']) {
      const button = within(name === 'New mindmap' ? screen.getByRole('banner') : document.body).getByRole('button', { name });
      expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      expect(button.getAttribute('title')).toBe(name);
    }
    const zoom = screen.getByRole('group', { name: /Zoom/ });
    expect(zoom.textContent).toContain('100%');
    expect(zoom.textContent).not.toContain('Zoom');
    for (const name of ['Zoom out', 'Zoom in']) {
      expect(within(zoom).getByRole('button', { name }).querySelector('svg[aria-hidden="true"] circle')).toBeTruthy();
    }
  });

  it('shows the tidy icon on Mindmaps and the mindmaps icon on Tidy layout', async () => {
    await ready();
    const mindmaps = screen.getByRole('button', { name: 'Mindmaps' });
    const tidy = screen.getByRole('button', { name: 'Tidy layout' });
    expect(mindmaps.querySelector('svg path')?.getAttribute('d')).toBe('M12 7v5M5 17v-5h14v5');
    expect(tidy.querySelector('svg path')?.getAttribute('d')).toBe('M8 12h4m0-6v12m0-12h4m-4 12h4');
  });

  it('shows an empty state with no Login button and no Google Drive menu', async () => {
    await ready();
    const header = within(screen.getByRole('banner'));
    expect(header.queryByRole('button', { name: 'Google Drive' })).toBeNull();
    expect(header.queryByRole('button', { name: /^(Login|Logout)$/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'New mindmap' }).length).toBeGreaterThan(0);
  });

  it('opens the local file picker from the Open button and accepts .mm and .json', async () => {
    await ready();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const accept = input.accept.split(',');
    expect(accept).toContain('.mm');
    expect(accept).toContain('.json');
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });

  it('disables Save without a mindmap and downloads the active map as a .mm file', async () => {
    await ready();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'New mindmap' })[0]);
    await screen.findByRole('button', { name: 'Node: Core idea' });
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:save';
      }),
      revokeObjectURL: vi.fn(),
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(names).toEqual(['Mindmap-1.mm']));
    const xml = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
    expect(xml).toContain('<map version="1.0.1">');
    expect(xml).toContain('TEXT="Core idea"');
  });

  it('creates a mindmap with a transparent root node', async () => {
    const root = await createMap();
    const rect = root.querySelector('rect.node-box') as SVGRectElement;
    expect(rect.getAttribute('fill')).toBe('none');
  });

  it('keeps the root from being deleted', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Node: Core idea' })).toBeTruthy();
  });

  it('collapses and expands a subtree', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    await screen.findByRole('button', { name: 'Node: Topic' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByRole('button', { name: 'Node: Topic' })).toBeNull();
    expect(document.querySelectorAll('path.edge')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden' }));
    expect(screen.getByRole('button', { name: 'Node: Topic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy();
  });

  it('applies fill, edge color and edge width, with black as the default edge', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    const edge = () => document.querySelector('path.edge') as SVGPathElement;
    expect(edge().getAttribute('data-default')).toBe('true');

    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#ffcc00' } });
    expect((child.querySelector('rect.node-box') as SVGRectElement).getAttribute('fill')).toBe('#ffcc00');
    fireEvent.change(screen.getByLabelText('Line color'), { target: { value: '#ff0000' } });
    expect(edge().getAttribute('stroke')).toBe('#ff0000');
    fireEvent.change(screen.getByLabelText('Line width'), { target: { value: '6' } });
    expect(edge().getAttribute('stroke-width')).toBe('6');

    fireEvent.click(screen.getByRole('button', { name: 'Line: Black' }));
    expect(edge().getAttribute('data-default')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Fill: Transparent' }));
    expect((child.querySelector('rect.node-box') as SVGRectElement).getAttribute('fill')).toBe('none');
  });

  it('renames a node inline on double click and commits with Enter', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    const input = screen.getByLabelText('Text') as HTMLInputElement;
    expect(input.value).toBe('Core idea');
    fireEvent.change(input, { target: { value: 'Belajar' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Node: Belajar' })).toBeTruthy();
    expect(screen.queryByLabelText('Text')).toBeNull();
  });

  it('opens inline edit with the caret after the text and grows the box while typing', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    const input = screen.getByLabelText('Text') as HTMLInputElement;
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
    const box = input.closest('foreignObject')!;
    const before = Number(box.getAttribute('width'));
    fireEvent.change(input, { target: { value: 'Core idea with a much longer label' } });
    expect(Number(box.getAttribute('width'))).toBeGreaterThan(before);
    fireEvent.change(input, { target: { value: 'x' } });
    expect(Number(box.getAttribute('width'))).toBe(96);
  });

  it('wraps a long label into several lines in the node and the editor', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    const input = screen.getByLabelText('Text') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Teks yang cukup panjang supaya terbagi menjadi beberapa baris' } });
    const box = input.closest('foreignObject')!;
    expect(Number(box.getAttribute('height'))).toBeGreaterThan(40);
    fireEvent.keyDown(input, { key: 'Enter' });
    const node = await screen.findByRole('button', { name: /^Node: Teks yang/ });
    expect(node.querySelectorAll('text tspan').length).toBeGreaterThan(1);
    expect(Number(node.querySelector('rect.node-box')!.getAttribute('height'))).toBeGreaterThan(40);
  });

  it('captures resize pointers on the canvas so resizing survives moving borders', async () => {
    const root = await createMap();
    const svg = document.querySelector('svg.canvas')!;
    const capture = vi.fn();
    svg.setPointerCapture = capture;
    const edge = root.parentElement!.querySelector('.resize-edge[data-handle="e"]')!;
    fireEvent.pointerDown(edge, { clientX: 500, clientY: 300, pointerId: 7, button: 0 });
    expect(capture).toHaveBeenCalledWith(7);
  });

  it('resizes a node by dragging its border and resets with a double click', async () => {
    const root = await createMap();
    const box = () => root.querySelector('rect.node-box') as SVGRectElement;
    const w0 = Number(box().getAttribute('width'));
    const edge = root.parentElement!.querySelector('.resize-edge[data-handle="e"]') as SVGElement;
    fireEvent.pointerDown(edge, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(edge, { clientX: 560, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(edge, { clientX: 560, clientY: 300, pointerId: 1 });
    expect(Number(box().getAttribute('width'))).toBe(w0 + 60);
    const south = root.parentElement!.querySelector('.resize-edge[data-handle="s"]') as SVGElement;
    fireEvent.pointerDown(south, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(south, { clientX: 500, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(south, { clientX: 500, clientY: 360, pointerId: 1 });
    expect(Number(box().getAttribute('height'))).toBe(100);
    const y0 = root.getAttribute('transform');
    const north = root.parentElement!.querySelector('.resize-edge[data-handle="n"]') as SVGElement;
    fireEvent.pointerDown(north, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(north, { clientX: 500, clientY: 280, pointerId: 1 });
    fireEvent.pointerUp(north, { clientX: 500, clientY: 280, pointerId: 1 });
    expect(Number(box().getAttribute('height'))).toBe(120);
    expect(root.getAttribute('transform')).not.toBe(y0);
    fireEvent.doubleClick(north);
    expect(Number(box().getAttribute('width'))).toBe(w0);
    expect(Number(box().getAttribute('height'))).toBe(40);
  });

  it('keeps pointer priority: edge drag neither moves the node nor pans the canvas', async () => {
    const root = await createMap();
    const wrap = root.parentElement!;
    const pos = root.getAttribute('transform');
    const vp = () => document.querySelector('svg.canvas > g')!.getAttribute('transform');
    const vp0 = vp();
    const edge = wrap.querySelector('.resize-edge[data-handle="w"]') as SVGElement;
    fireEvent.pointerDown(edge, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(edge, { clientX: 470, clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(edge, { clientX: 470, clientY: 340, pointerId: 1 });
    expect(vp()).toBe(vp0);
    expect(root.getAttribute('transform')).not.toBe(pos);
    expect(Number(root.querySelector('rect.node-box')!.getAttribute('height'))).toBe(40);
  });

  it('separates overlapping siblings only when a node drag ends', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    const first = await screen.findByRole('button', { name: 'Node: Topic' });
    fireEvent.keyDown(root, { key: 'Tab' });
    const second = (await screen.findAllByRole('button', { name: 'Node: Topic' }))[1];
    const y = (el: Element) => Number(/translate\([-\d.e]+[ ,]([-\d.e]+)\)/.exec(el.getAttribute('transform') ?? '')?.[1]);
    const firstY = y(first);
    const secondY = y(second);
    fireEvent.pointerDown(second, { pointerId: 1, button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(second, { pointerId: 1, clientX: 300, clientY: 300 - (secondY - firstY) });
    expect(y(first)).toBe(firstY);
    expect(y(second)).toBe(firstY);
    fireEvent.pointerUp(second, { pointerId: 1, clientX: 300, clientY: 300 - (secondY - firstY) });
    expect(y(second)).toBe(firstY);
    expect(y(first)).toBeGreaterThan(firstY);
  });

  describe('touch gestures', () => {
    const vpOf = () => {
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(document.querySelector('svg.canvas > g')!.getAttribute('transform')!)!;
      return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
    };
    const touch = (pointerId: number, x: number, y: number) => ({ pointerId, pointerType: 'touch', clientX: x, clientY: y, button: 0, isPrimary: pointerId === 1 });
    const svg = () => document.querySelector('svg.canvas') as SVGSVGElement;

    it('keeps touch-action none on the canvas', () => {
      expect(readFileSync('src/styles.css', 'utf8')).toMatch(/\.canvas\s*\{[^}]*touch-action:\s*none/);
    });

    it('pans the background with one finger', async () => {
      await createMap();
      const v0 = vpOf();
      fireEvent.pointerDown(svg(), touch(1, 300, 300));
      fireEvent.pointerMove(svg(), touch(1, 340, 280));
      fireEvent.pointerUp(svg(), touch(1, 340, 280));
      expect(vpOf()).toEqual({ x: v0.x + 40, y: v0.y - 20, zoom: v0.zoom });
      fireEvent.pointerMove(svg(), touch(1, 400, 400));
      expect(vpOf()).toEqual({ x: v0.x + 40, y: v0.y - 20, zoom: v0.zoom });
    });

    it('pinch-zooms around the midpoint between the fingers', async () => {
      await createMap();
      const v0 = vpOf();
      fireEvent.pointerDown(svg(), touch(1, 250, 300));
      fireEvent.pointerDown(svg(), touch(2, 350, 300));
      fireEvent.pointerMove(svg(), touch(1, 200, 300));
      fireEvent.pointerMove(svg(), touch(2, 400, 300));
      const v = vpOf();
      expect(v.zoom).toBeCloseTo(v0.zoom * 2);
      expect(v.x).toBeCloseTo(300 - (300 - v0.x) * 2);
      expect(v.y).toBeCloseTo(300 - (300 - v0.y) * 2);
    });

    it('translates with the midpoint while pinching', async () => {
      await createMap();
      const v0 = vpOf();
      fireEvent.pointerDown(svg(), touch(1, 250, 300));
      fireEvent.pointerDown(svg(), touch(2, 350, 300));
      fireEvent.pointerMove(svg(), touch(1, 280, 320));
      fireEvent.pointerMove(svg(), touch(2, 380, 320));
      const v = vpOf();
      expect(v.zoom).toBeCloseTo(v0.zoom);
      expect(v.x).toBeCloseTo(v0.x + 30);
      expect(v.y).toBeCloseTo(v0.y + 20);
    });

    it('resumes panning with the remaining finger without a jump after one lifts', async () => {
      await createMap();
      fireEvent.pointerDown(svg(), touch(1, 250, 300));
      fireEvent.pointerDown(svg(), touch(2, 350, 300));
      fireEvent.pointerMove(svg(), touch(2, 450, 300));
      const zoomed = vpOf();
      fireEvent.pointerUp(svg(), touch(1, 250, 300));
      expect(vpOf()).toEqual(zoomed);
      fireEvent.pointerMove(svg(), touch(2, 460, 310));
      expect(vpOf()).toEqual({ x: zoomed.x + 10, y: zoomed.y + 10, zoom: zoomed.zoom });
      fireEvent.pointerUp(svg(), touch(2, 460, 310));
      fireEvent.pointerMove(svg(), touch(2, 600, 600));
      expect(vpOf().x).toBe(zoomed.x + 10);
    });

    it('ends the gesture on pointercancel and ignores a third finger', async () => {
      await createMap();
      fireEvent.pointerDown(svg(), touch(1, 250, 300));
      fireEvent.pointerDown(svg(), touch(2, 350, 300));
      fireEvent.pointerDown(svg(), touch(3, 300, 100));
      fireEvent.pointerMove(svg(), touch(3, 300, 0));
      const v = vpOf();
      fireEvent.pointerCancel(svg(), touch(1, 250, 300));
      fireEvent.pointerCancel(svg(), touch(2, 350, 300));
      fireEvent.pointerCancel(svg(), touch(3, 300, 0));
      fireEvent.pointerMove(svg(), touch(2, 500, 500));
      expect(vpOf()).toEqual(v);
      fireEvent.pointerDown(svg(), touch(4, 100, 100));
      fireEvent.pointerMove(svg(), touch(4, 110, 100));
      expect(vpOf().x).toBe(v.x + 10);
    });

    it('drags a node with one finger without panning, and ignores a second finger on the background', async () => {
      const root = await createMap();
      const v0 = vpOf();
      const pos = root.getAttribute('transform');
      fireEvent.pointerDown(root, touch(1, 300, 300));
      fireEvent.pointerDown(svg(), touch(2, 100, 100));
      fireEvent.pointerMove(svg(), touch(2, 50, 100));
      fireEvent.pointerMove(root, touch(1, 330, 320));
      fireEvent.pointerUp(root, touch(1, 330, 320));
      expect(vpOf()).toEqual(v0);
      expect(root.getAttribute('transform')).not.toBe(pos);
    });

    it('does not start a node drag or resize with a second finger while a gesture is active', async () => {
      const root = await createMap();
      const pos = root.getAttribute('transform');
      const edge = root.parentElement!.querySelector('.resize-edge[data-handle="e"]')!;
      const v0 = vpOf();
      fireEvent.pointerDown(svg(), touch(1, 250, 300));
      fireEvent.pointerDown(root, touch(2, 350, 300));
      fireEvent.pointerDown(edge, touch(3, 350, 300));
      fireEvent.pointerMove(root, touch(2, 450, 300));
      expect(root.getAttribute('transform')).toBe(pos);
      expect(vpOf().zoom).toBeGreaterThan(v0.zoom);
    });

    it('resizes from an edge with one finger and ignores a second finger', async () => {
      const root = await createMap();
      const box = () => Number(root.querySelector('rect.node-box')!.getAttribute('width'));
      const w0 = box();
      const v0 = vpOf();
      const edge = root.parentElement!.querySelector('.resize-edge[data-handle="e"]')!;
      fireEvent.pointerDown(edge, touch(1, 500, 300));
      fireEvent.pointerDown(svg(), touch(2, 100, 100));
      fireEvent.pointerMove(svg(), touch(2, 40, 100));
      fireEvent.pointerMove(svg(), touch(1, 540, 300));
      fireEvent.pointerUp(svg(), touch(1, 540, 300));
      expect(box()).toBeCloseTo(w0 + 40 / v0.zoom);
      expect(vpOf()).toEqual(v0);
    });

    it('stops a node drag on pointercancel', async () => {
      const root = await createMap();
      fireEvent.pointerDown(root, touch(1, 300, 300));
      fireEvent.pointerMove(root, touch(1, 320, 300));
      const pos = root.getAttribute('transform');
      fireEvent.pointerCancel(root, touch(1, 320, 300));
      fireEvent.pointerMove(svg(), touch(1, 400, 300));
      expect(root.getAttribute('transform')).toBe(pos);
    });

    it('leaves the inline editor alone: touching it neither pans nor pinches', async () => {
      const root = await createMap();
      fireEvent.doubleClick(root);
      const input = screen.getByLabelText('Text');
      const v0 = vpOf();
      fireEvent.pointerDown(input, touch(1, 300, 300));
      fireEvent.pointerMove(input, touch(1, 360, 300));
      fireEvent.pointerUp(input, touch(1, 360, 300));
      expect(vpOf()).toEqual(v0);
      expect(screen.getByLabelText('Text')).toBe(input);
    });

    it('keeps mouse panning working and independent of touch state', async () => {
      await createMap();
      const v0 = vpOf();
      fireEvent.pointerDown(svg(), { pointerId: 9, pointerType: 'mouse', clientX: 300, clientY: 300, button: 0 });
      fireEvent.pointerMove(svg(), { pointerId: 9, pointerType: 'mouse', clientX: 320, clientY: 310 });
      fireEvent.pointerUp(svg(), { pointerId: 9, pointerType: 'mouse', clientX: 320, clientY: 310 });
      expect(vpOf()).toEqual({ x: v0.x + 20, y: v0.y + 10, zoom: v0.zoom });
    });
  });

  it('shows long text in full, wrapped, without an ellipsis', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    const input = screen.getByLabelText('Text') as HTMLTextAreaElement;
    const text = 'Satu kalimat yang sangat panjang '.repeat(12).trim();
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const node = await screen.findByRole('button', { name: /^Node: Satu kalimat/ });
    const lines = [...node.querySelectorAll('text tspan')].map((t) => t.textContent);
    expect(lines.join(' ')).toBe(text);
    expect(lines.join('')).not.toContain('…');
  });

  it('resizes from the keyboard with Alt+arrows and Alt+0', async () => {
    const root = await createMap();
    const box = () => root.querySelector('rect.node-box') as SVGRectElement;
    const w0 = Number(box().getAttribute('width'));
    fireEvent.keyDown(root, { key: 'ArrowRight', altKey: true });
    expect(Number(box().getAttribute('width'))).toBe(w0 + 16);
    fireEvent.keyDown(root, { key: 'ArrowDown', altKey: true, shiftKey: true });
    expect(Number(box().getAttribute('height'))).toBe(104);
    fireEvent.keyDown(root, { key: '0', altKey: true });
    expect(Number(box().getAttribute('width'))).toBe(w0);
  });

  it('keeps Enter save and Escape cancel on a resized node', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'ArrowRight', altKey: true, shiftKey: true });
    const width = Number(root.querySelector('rect.node-box')!.getAttribute('width'));
    fireEvent.doubleClick(root);
    let input = screen.getByLabelText('Text');
    expect(Number(input.closest('foreignObject')!.getAttribute('width'))).toBe(width);
    fireEvent.change(input, { target: { value: 'Batal' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Node: Core idea' })).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Node: Core idea' }));
    input = screen.getByLabelText('Text');
    fireEvent.change(input, { target: { value: 'Simpan' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const saved = screen.getByRole('button', { name: 'Node: Simpan' });
    expect(Number(saved.querySelector('rect.node-box')!.getAttribute('width'))).toBe(width);
  });

  it('starts inline edit with F2 and cancels with Escape', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'F2' });
    const input = screen.getByLabelText('Text');
    fireEvent.change(input, { target: { value: 'Batal' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Text')).toBeNull();
    expect(screen.getByRole('button', { name: 'Node: Core idea' })).toBeTruthy();
  });

  it('keeps the old text when the inline edit is emptied', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    const input = screen.getByLabelText('Text');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Node: Core idea' })).toBeTruthy();
  });

  it('shows the floating inspector only while a node is selected', async () => {
    const root = await createMap();
    expect(screen.queryByRole('complementary', { name: 'Selected node' })).toBeNull();
    expect(screen.queryByLabelText('Fill color')).toBeNull();
    fireEvent.click(root);
    const panel = screen.getByRole('complementary', { name: 'Selected node' });
    expect(within(panel).getByLabelText('Fill color')).toBeTruthy();
    expect(within(panel).getByRole('textbox', { name: 'Note' })).toBeTruthy();
    expect(screen.queryByLabelText('Text')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Selected node' })).toBeNull();
  });

  it('shows the clicked node text in the sidebar and edits it there', async () => {
    const root = await createMap();
    fireEvent.click(root);
    const panel = screen.getByRole('complementary', { name: 'Selected node' });
    const field = within(panel).getByLabelText('Node text') as HTMLTextAreaElement;
    expect(field.value).toBe('Core idea');
    fireEvent.change(field, { target: { value: 'Belajar' } });
    expect(screen.getByRole('button', { name: 'Node: Belajar' })).toBeTruthy();
    expect((within(panel).getByLabelText('Node text') as HTMLTextAreaElement).value).toBe('Belajar');
  });

  it('follows the selection and ignores blank text in the sidebar', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    const text = () => screen.getByLabelText('Node text') as HTMLTextAreaElement;
    expect(text().value).toBe('Topic');
    fireEvent.click(root);
    expect(text().value).toBe('Core idea');
    fireEvent.change(text(), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Node: Core idea' })).toBeTruthy();
    fireEvent.blur(text());
    expect(text().value).toBe('Core idea');
    fireEvent.click(child);
    expect(text().value).toBe('Topic');
  });

  it('keeps the sidebar text in sync after an inline rename', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Inline' } });
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Enter' });
    expect((screen.getByLabelText('Node text') as HTMLTextAreaElement).value).toBe('Inline');
  });

  it('labels the width slider "Line width" and keeps each slider label, value and control on one row', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    await screen.findByRole('button', { name: 'Node: Topic' });
    expect(screen.queryByLabelText('Edge width')).toBeNull();
    for (const name of ['Line width', 'Width', 'Height']) {
      const slider = screen.getByLabelText(name) as HTMLInputElement;
      const row = slider.closest('.slider-field')!;
      expect(row).toBeTruthy();
      expect(row.querySelector('label')!.textContent).toBe(name);
      expect(row.querySelector('output')!.textContent).toBe(slider.value);
      expect(Array.from(row.children).map((c) => c.tagName)).toEqual(['LABEL', 'OUTPUT', 'INPUT']);
    }
  });

  it('picks default fill and line colors from labelled swatches next to the custom picker', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    const fills = within(screen.getByRole('group', { name: 'Fill color presets' }));
    const lines = within(screen.getByRole('group', { name: 'Line color presets' }));
    expect(fills.getAllByRole('button').length).toBeGreaterThanOrEqual(6);

    fireEvent.click(fills.getByRole('button', { name: 'Fill: Light red' }));
    expect((child.querySelector('rect.node-box') as SVGRectElement).getAttribute('fill')).toBe('#fca5a5');
    expect(fills.getByRole('button', { name: 'Fill: Light red' }).getAttribute('aria-pressed')).toBe('true');
    expect(fills.getByRole('button', { name: 'Fill: Light blue' }).getAttribute('aria-pressed')).toBe('false');
    expect(fills.getByRole('button', { name: 'Fill: Transparent' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Fill color') as HTMLInputElement).value).toBe('#fca5a5');

    fireEvent.click(lines.getByRole('button', { name: 'Line: Blue' }));
    expect((document.querySelector('path.edge') as SVGPathElement).getAttribute('stroke')).toBe('#2563eb');
    expect(lines.getByRole('button', { name: 'Line: Blue' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#123456' } });
    expect((child.querySelector('rect.node-box') as SVGRectElement).getAttribute('fill')).toBe('#123456');
    expect(fills.getByRole('button', { name: 'Fill: Light red' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows fill and line presets as one row each, transparent and black first, with no separate reset buttons', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    await screen.findByRole('button', { name: 'Node: Topic' });
    const inspector = within(screen.getByRole('complementary', { name: 'Selected node' }));
    expect(inspector.queryByRole('button', { name: 'Transparent' })).toBeNull();
    expect(inspector.queryByRole('button', { name: 'Black' })).toBeNull();
    const fills = inspector.getByRole('group', { name: 'Fill color presets' });
    const lines = inspector.getByRole('group', { name: 'Line color presets' });
    const names = (g: HTMLElement) => within(g).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names(fills)[0]).toBe('Fill: Transparent');
    expect(names(lines)[0]).toBe('Line: Black');
    expect(fills.parentElement!.querySelectorAll('input[type="color"]')).toHaveLength(1);
    expect(lines.parentElement!.querySelectorAll('input[type="color"]')).toHaveLength(1);
    expect(fills.contains(fills.parentElement!.querySelector('input[type="color"]'))).toBe(true);
    expect(lines.contains(lines.parentElement!.querySelector('input[type="color"]'))).toBe(true);
    const hex = (g: HTMLElement) => within(g).getAllByRole('button').map((b) => (b as HTMLElement).style.background).filter(Boolean);
    const all = [...hex(fills), ...hex(lines)];
    expect(new Set(all).size).toBe(all.length);
    expect(lines.querySelector('button[aria-pressed="true"]')!.getAttribute('aria-label')).toBe('Line: Black');
    expect(fills.querySelector('button[aria-pressed="true"]')!.getAttribute('aria-label')).toBe('Fill: Transparent');
  });

  it('keeps Clear note as a full-width action after the other note controls', async () => {
    const root = await createMap();
    fireEvent.click(root);
    const clear = screen.getByRole('button', { name: 'Clear note' });
    expect(clear.classList.contains('note-clear')).toBe(true);
    const field = clear.closest('.note-field')!;
    expect(field.lastElementChild).toBe(clear);
    const insert = screen.getByRole('button', { name: 'Insert link' });
    expect(screen.queryByRole('button', { name: 'Insert image from URL' })).toBeNull();
    expect(insert.parentElement!.classList.contains('note-actions')).toBe(true);
  });

  it('disables line swatches for the root, which has no incoming line', async () => {
    const root = await createMap();
    fireEvent.click(root);
    const lines = within(screen.getByRole('group', { name: 'Line color presets' }));
    for (const b of lines.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders Add sibling as a filled action button', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    await screen.findByRole('button', { name: 'Node: Topic' });
    const button = within(screen.getByRole('complementary', { name: 'Selected node' })).getByRole('button', { name: 'Add sibling' });
    expect(button.classList.contains('primary')).toBe(true);
    expect(button.classList.contains('action')).toBe(true);
  });

  it('labels the sidebar controls in English', async () => {
    await createMap();
    fireEvent.click(screen.getByRole('button', { name: 'Node: Core idea' }));
    expect((screen.getByLabelText('Node text') as HTMLTextAreaElement).value).toBe('Core idea');
    expect(screen.getByLabelText('Line width')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Fill color presets' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fill: Light red' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Line: Blue' })).toBeTruthy();
  });

  it('has no sidebar, no footer and an editable title above the map', async () => {
    await createMap();
    expect(document.querySelector('aside.side')).toBeNull();
    expect(document.querySelector('footer')).toBeNull();
    const title = screen.getByLabelText('Rename mindmap') as HTMLInputElement;
    expect(title.value).toBe('Mindmap 1');
    fireEvent.change(title, { target: { value: 'Rencana' } });
    expect((screen.getByLabelText('Rename mindmap') as HTMLInputElement).value).toBe('Rencana');
    fireEvent.change(title, { target: { value: '' } });
    fireEvent.blur(title);
    expect((screen.getByLabelText('Rename mindmap') as HTMLInputElement).value).toBe('Rencana');
  });

  it('drags a node and its edge follows', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    const before = child.getAttribute('transform');
    const pathBefore = document.querySelector('path.edge')?.getAttribute('d');
    fireEvent.pointerDown(child, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(child, { clientX: 340, clientY: 380, pointerId: 1 });
    fireEvent.pointerUp(child, { clientX: 340, clientY: 380, pointerId: 1 });
    expect(child.getAttribute('transform')).not.toBe(before);
    expect(document.querySelector('path.edge')?.getAttribute('d')).not.toBe(pathBefore);
  });

  it('zooms with the toolbar buttons', async () => {
    await createMap();
    const level = () => screen.getByText(/^\d+%$/).textContent;
    expect(level()).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(level()).not.toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(Number(/(\d+)/.exec(level() ?? '')?.[1])).toBeLessThan(100);
  });

  it('saves to IndexedDB and restores after a reload', async () => {
    const root = await createMap();
    fireEvent.doubleClick(root);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Tersimpan' } });
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Enter' });
    await waitFor(async () => {
      const ws = await loadWorkspace();
      expect(Object.values(ws?.maps[0].nodes ?? {}).map((n) => n.text)).toContain('Tersimpan');
    }, { timeout: 3000 });

    document.body.innerHTML = '';
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Node: Tersimpan' })).toBeTruthy();
  });

  it('is English-only: no language selector, an old Indonesian preference is migrated away', async () => {
    localStorage.setItem('smart-mindmap:prefs', JSON.stringify({ theme: 'dark', lang: 'id' }));
    await ready();
    expect(screen.queryByLabelText('Language')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.documentElement.lang).toBe('en');
    expect(JSON.parse(localStorage.getItem('smart-mindmap:prefs') ?? '{}')).toEqual({ theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('toggles the theme with a sun/moon icon button and persists it', async () => {
    await ready();
    expect(screen.queryByLabelText('Theme')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Dark theme' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.querySelector('svg.icon-sun')).toBeTruthy();
    expect(toggle.querySelector('svg.icon-moon')).toBeNull();
    expect(toggle.textContent).toBe('');
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.querySelector('svg.icon-moon')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('smart-mindmap:prefs') ?? '{}').theme).toBe('dark');
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem('smart-mindmap:prefs') ?? '{}').theme).toBe('light');
  });

  describe('fullscreen toggle', () => {
    let current: Element | null = null;
    const stubFullscreen = (request: () => Promise<void>, exit: () => Promise<void>) => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
      document.documentElement.requestFullscreen = vi.fn(request);
      document.exitFullscreen = vi.fn(exit);
    };
    const flip = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    afterEach(() => {
      current = null;
      for (const k of ['fullscreenEnabled', 'fullscreenElement']) Reflect.deleteProperty(document, k);
      Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
      Reflect.deleteProperty(document, 'exitFullscreen');
    });

    it('sits next to the theme toggle and enters then exits fullscreen, following fullscreenchange', async () => {
      stubFullscreen(async () => flip(document.documentElement), async () => flip(null));
      await ready();
      const header = within(screen.getByRole('banner'));
      const enter = header.getByRole('button', { name: 'Enter fullscreen' });
      expect(enter.textContent).toBe('');
      expect(enter.querySelector('svg.icon-expand')).toBeTruthy();
      expect(enter.previousElementSibling).toBe(header.getByRole('button', { name: 'Dark theme' }));
      fireEvent.click(enter);
      expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
      const exit = await header.findByRole('button', { name: 'Exit fullscreen' });
      expect(exit.querySelector('svg.icon-collapse')).toBeTruthy();
      fireEvent.click(exit);
      expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
      await header.findByRole('button', { name: 'Enter fullscreen' });
    });

    it('syncs the button when the browser leaves fullscreen on its own (Esc)', async () => {
      stubFullscreen(async () => undefined, async () => undefined);
      current = document.documentElement;
      await ready();
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
      act(() => flip(null));
      expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeTruthy();
    });

    it('reports a rejected request without crashing and stays in the enter state', async () => {
      stubFullscreen(() => Promise.reject(new Error('denied')), async () => undefined);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
      expect((await screen.findByRole('alert')).textContent).toContain('The browser blocked fullscreen.');
      expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeTruthy();
    });

    it('disables the button with an explanation when the API is unsupported', async () => {
      await ready();
      const button = screen.getByRole('button', { name: 'Fullscreen is not available in this browser' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('starts from the system color scheme and leaves the theme attribute unset until toggled', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await ready();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    const toggle = screen.getByRole('button', { name: 'Dark theme' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('imports a JSON file and shows it on the canvas', async () => {
    await ready();
    let map = createMindmap({ id: 'imp', title: 'Impor', rootText: 'Dari file', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'Anak file');
    const file = new File([exportJson([map])], 'peta.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('button', { name: 'Node: Dari file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Node: Anak file' })).toBeTruthy();
  });

  it('reports a clear error for an invalid import without crashing', async () => {
    await ready();
    const file = new File(['{bad'], 'rusak.json', { type: 'application/json' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Import failed/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New mindmap' }).length).toBeGreaterThan(0);
  });

  it('imports a FreeMind file', async () => {
    await ready();
    const xml = '<map version="1.0.1"><node TEXT="Akar mm"><node TEXT="Daun mm"/></node></map>';
    const file = new File([xml], 'peta.mm', { type: 'text/xml' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    expect(await screen.findByRole('button', { name: 'Node: Akar mm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Node: Daun mm' })).toBeTruthy();
  });

  it('exposes every export format from the header dropdown only', async () => {
    await createMap();
    expect(screen.queryByRole('menuitem', { name: 'Export JSON' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Export' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu');
    expect(within(screen.getByRole('banner')).getByRole('menu')).toBe(menu);
    for (const name of ['Export JSON', 'Export FreeMind (.mm)', 'Export PNG', 'Export JPG', 'Export SVG', 'Export PDF']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeTruthy();
    }
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('downloads JSON from the export dropdown', async () => {
    await createMap();
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export JSON' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    click.mockRestore();
  });

  it('disables export while there is no mindmap', async () => {
    await ready();
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a child with Tab and a sibling only through the sidebar button', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Tab' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    expect(child.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(child, { key: 'Enter' });
    expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Selected node' })).getByRole('button', { name: 'Add sibling' }));
    expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(2);
    expect(document.querySelectorAll('path.edge')).toHaveLength(2);
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Node: Topic' })[1], { key: 'Tab' });
    expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(3);
  });

  it('offers + controls on both sides of a leaf and creates the child on the clicked side', async () => {
    const root = await createMap();
    expect(screen.getByRole('button', { name: 'Add child on the left' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add child on the left' }));
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    const rootX = Number(/translate\(([-\d.]+)/.exec(root.getAttribute('transform') ?? '')?.[1]);
    expect(Number(/translate\(([-\d.]+)/.exec(child.getAttribute('transform') ?? '')?.[1])).toBeLessThan(rootX);
    // Left side now holds a child, so that control is a collapse (-); the right side still adds.
    const collapse = screen.getByRole('button', { name: 'Collapse' });
    expect(collapse.getAttribute('data-side')).toBe('left');
    expect(screen.getByRole('button', { name: 'Add child on the right' })).toBeTruthy();
    fireEvent.click(collapse);
    expect(screen.queryByRole('button', { name: 'Node: Topic' })).toBeNull();
  });

  it('shows the map name only in the top toolbar', async () => {
    await createMap();
    const bar = screen.getByRole('banner');
    expect(within(bar).getByLabelText('Rename mindmap')).toBeTruthy();
    expect(screen.getAllByLabelText('Rename mindmap')).toHaveLength(1);
  });

  it('lets Shift+Tab move focus normally', async () => {
    const root = await createMap();
    const proceed = fireEvent.keyDown(root, { key: 'Tab', shiftKey: true });
    expect(proceed).toBe(true);
    expect(screen.queryByRole('button', { name: 'Node: Topic' })).toBeNull();
  });

  it('keeps the Insert shortcut and confirms before deleting a leaf', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Insert' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.keyDown(child, { key: 'Delete' });
    expect(confirm).toHaveBeenCalledWith('Delete this node?');
    expect(screen.getByRole('button', { name: 'Node: Topic' })).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(child, { key: 'Delete' });
    expect(screen.queryByRole('button', { name: 'Node: Topic' })).toBeNull();
  });

  describe('deleting a node with children', () => {
    const setup = async () => {
      const root = await createMap();
      fireEvent.keyDown(root, { key: 'Tab' });
      const child = await screen.findByRole('button', { name: 'Node: Topic' });
      fireEvent.keyDown(child, { key: 'Tab' });
      expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(2);
      return screen.getAllByRole('button', { name: 'Node: Topic' })[0];
    };

    it('asks first and deletes only the node, promoting its children', async () => {
      const child = await setup();
      fireEvent.keyDown(child, { key: 'Delete' });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete node only (children move up)' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(1);
      expect(document.querySelectorAll('path.edge')).toHaveLength(1);
    });

    it('deletes the node together with its subtree', async () => {
      const child = await setup();
      fireEvent.keyDown(child, { key: 'Delete' });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete node and all children' }));
      expect(screen.queryByRole('button', { name: 'Node: Topic' })).toBeNull();
      expect(document.querySelectorAll('path.edge')).toHaveLength(0);
    });

    it('cancels without changes and closes on Escape', async () => {
      const child = await setup();
      fireEvent.keyDown(child, { key: 'Delete' });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(2);
      fireEvent.keyDown(child, { key: 'Delete' });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Node: Topic' })).toHaveLength(2);
    });
  });

  it('shows a +/- toggle next to the parent-child line', async () => {
    const root = await createMap();
    expect(screen.queryByRole('button', { name: 'Collapse' })).toBeNull();
    fireEvent.keyDown(root, { key: 'Tab' });
    await screen.findByRole('button', { name: 'Node: Topic' });
    const toggle = screen.getByRole('button', { name: 'Collapse' });
    expect(toggle.querySelector('path')?.getAttribute('d')).not.toContain('V');
    fireEvent.click(toggle);
    const plus = screen.getByRole('button', { name: 'Show 1 hidden' });
    expect(plus.querySelector('path')?.getAttribute('d')).toContain('V');
  });

  describe('notes', () => {
    const editor = () => screen.getByRole('textbox', { name: 'Note' });
    const typeNote = (html: string) => {
      editor().innerHTML = html;
      fireEvent.input(editor());
    };
    const selectRoot = async () => {
      const root = await createMap();
      fireEvent.click(root);
      return root;
    };

    it('edits a note in the inspector, shows an indicator and persists it', async () => {
      const root = await selectRoot();
      expect(root.querySelector('.note-indicator')).toBeNull();
      typeNote('<p>Halo <b>dunia</b></p>');
      // Editing shows only the editor controls, never a separate preview block.
      expect(document.querySelector('.note-preview')).toBeNull();
      expect(document.querySelector('.note-preview-body')).toBeNull();
      expect(screen.queryByText('Preview')).toBeNull();
      await waitFor(() => expect(screen.getByRole('button', { name: /^Node: Core idea\. Note: Halo dunia$/ }).querySelector('.note-indicator')).not.toBeNull());
      await waitFor(async () => {
        const ws = await loadWorkspace();
        expect(Object.values(ws?.maps[0].nodes ?? {})[0].note).toBe('<p>Halo <b>dunia</b></p>');
      }, { timeout: 3000 });

      document.body.innerHTML = '';
      render(<App />);
      const again = await screen.findByRole('button', { name: /^Node: Core idea/ });
      fireEvent.click(again);
      expect(editor().innerHTML).toBe('<p>Halo <b>dunia</b></p>');
    });

    it('sanitizes pasted or typed markup before it is stored', async () => {
      await selectRoot();
      typeNote('<p onclick="x()">ok</p><img src="javascript:x"><script>1</script>');
      await waitFor(() => expect(screen.getByRole('button', { name: /Note: ok$/ })).toBeTruthy());
      fireEvent.blur(editor());
      expect(editor().innerHTML).toBe('<p>ok</p>');
    });

    it('shows a decorative link indicator only while the node has a URL', async () => {
      const root = await selectRoot();
      expect(root.querySelector('.link-indicator')).toBeNull();
      typeNote('<p>teks</p>');
      const url = screen.getByLabelText('Node URL');
      fireEvent.change(url, { target: { value: 'https://example.com/a' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      const indicator = root.querySelector('.link-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator?.getAttribute('aria-hidden')).toBe('true');
      expect(root.querySelector('.note-indicator')).not.toBeNull();
      expect(root.textContent).not.toContain('https://example.com/a');
      fireEvent.change(url, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      expect(root.querySelector('.link-indicator')).toBeNull();
    });

    it('assigns a node URL without changing the note and rejects unsafe URLs', async () => {
      await selectRoot();
      typeNote('<p>teks</p>');
      const url = screen.getByLabelText('Node URL');
      fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      expect(screen.getByRole('alert').textContent).toMatch(/not allowed/i);
      expect(editor().innerHTML).toBe('<p>teks</p>');

      fireEvent.change(url, { target: { value: 'https://example.com/a?b=1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      expect(editor().innerHTML).toBe('<p>teks</p>');
      expect(screen.getByRole('button', { name: 'Open URL' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Insert image from URL' })).toBeNull();
    });

    it('uploads a small image as a data URL and refuses wrong types and big files', async () => {
      await selectRoot();
      const input = screen.getByLabelText('Upload image') as HTMLInputElement;
      const png = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
      fireEvent.change(input, { target: { files: [png] } });
      await waitFor(() => expect(editor().querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/));

      const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
      fireEvent.change(input, { target: { files: [svg] } });
      expect((await screen.findByRole('alert')).textContent).toMatch(/PNG, JPEG, WebP or GIF/);

      const big = new File([new Uint8Array(1024 * 1024 + 1)], 'b.png', { type: 'image/png' });
      fireEvent.change(input, { target: { files: [big] } });
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/1 MB/));
      expect(editor().querySelectorAll('img')).toHaveLength(1);
    });

    it('refuses a note over 100 KB and keeps the old one', async () => {
      await selectRoot();
      typeNote('<p>kecil</p>');
      typeNote(`<p>${'x'.repeat(100 * 1024 + 1)}</p>`);
      expect(screen.getByRole('alert').textContent).toMatch(/100 KB/);
      expect(screen.getByRole('button', { name: /Note: kecil$/ })).toBeTruthy();
    });

    it('clears a note', async () => {
      await selectRoot();
      typeNote('<p>hapus</p>');
      await screen.findByRole('button', { name: /Note: hapus$/ });
      fireEvent.click(screen.getByRole('button', { name: 'Clear note' }));
      expect(screen.getByRole('button', { name: 'Node: Core idea' })).toBeTruthy();
      expect(editor().innerHTML).toBe('');
    });

    it('imports notes from JSON and keeps them when exporting', async () => {
      await ready();
      let map = createMindmap({ id: 'imp', title: 'Impor', rootText: 'Akar', at: { x: 0, y: 0 } });
      map = { ...map, nodes: { ...map.nodes, [map.rootId]: { ...map.nodes[map.rootId], note: '<p>dari file</p>' } } };
      const file = new File([exportJson([map])], 'peta.json', { type: 'application/json' });
      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
      fireEvent.click(await screen.findByRole('button', { name: /^Node: Akar\. Note: dari file$/ }));
      expect(editor().innerHTML).toBe('<p>dari file</p>');
    });

    it('rejects an import file over 10 MB without reading it', async () => {
      await ready();
      const read = vi.spyOn(FileReader.prototype, 'readAsText');
      for (const name of ['besar.json', 'besar.mm']) {
        const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], name, { type: 'application/json' });
        fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
        expect((await screen.findByRole('alert')).textContent).toMatch(/too large/i);
      }
      expect(read).not.toHaveBeenCalled();
      read.mockRestore();
    });

    it('refuses a note edit that would exceed the image budget and keeps the old note', async () => {
      const root = await selectRoot();
      const png = `data:image/png;base64,${'A'.repeat(1_398_100)}`;
      const five = `<img src="${png}">`.repeat(5);
      typeNote(`<p>raksasa</p>${five}`);
      await screen.findByRole('button', { name: /Note: raksasa$/ });
      fireEvent.keyDown(root, { key: 'Insert' });
      fireEvent.click(await screen.findByRole('button', { name: 'Node: Topic' }));
      typeNote(`<p>kedua</p>${five}`);
      expect((await screen.findByRole('alert')).textContent).toMatch(/images/i);
      expect(screen.getByRole('button', { name: 'Node: Topic' })).toBeTruthy();
      expect(editor().querySelector('img')).toBeNull();
    }, 30_000);
  });
});
