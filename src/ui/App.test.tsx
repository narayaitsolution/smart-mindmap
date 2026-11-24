import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJson } from '../io/json';
import { addChild, createMindmap } from '../model/mindmap';
import { clearWorkspace, loadWorkspace } from '../storage/persistence';
import { App } from './App';

beforeEach(async () => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  await clearWorkspace();
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
  it('shows an empty state and a non-blocking Google notice when no client id is set', async () => {
    await ready();
    expect(screen.queryByText(/VITE_GOOGLE_CLIENT_ID/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Google Drive' }));
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Google Drive' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'New mindmap' }).length).toBeGreaterThan(0);
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
    fireEvent.change(screen.getByLabelText('Edge color'), { target: { value: '#ff0000' } });
    expect(edge().getAttribute('stroke')).toBe('#ff0000');
    fireEvent.change(screen.getByLabelText('Edge width'), { target: { value: '6' } });
    expect(edge().getAttribute('stroke-width')).toBe('6');

    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    expect(edge().getAttribute('data-default')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Transparent' }));
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
    const level = () => screen.getByText(/^Zoom \d+%$/).textContent;
    expect(level()).toBe('Zoom 100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(level()).not.toBe('Zoom 100%');
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

  it('switches to Indonesian, persists it and sets the document language', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'id' } });
    expect(await screen.findByText('Belum ada mindmap')).toBeTruthy();
    expect(document.documentElement.lang).toBe('id');
    expect(JSON.parse(localStorage.getItem('smart-mindmap:prefs') ?? '{}').lang).toBe('id');
  });

  it('defaults to the system theme and lets the user force one', async () => {
    await ready();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('system');
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
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

  it('keeps the Insert shortcut and deletes a leaf without asking', async () => {
    const root = await createMap();
    fireEvent.keyDown(root, { key: 'Insert' });
    const child = await screen.findByRole('button', { name: 'Node: Topic' });
    fireEvent.keyDown(child, { key: 'Delete' });
    expect(screen.queryByRole('dialog')).toBeNull();
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

    it('inserts a link and an image URL, rejecting unsafe ones', async () => {
      await selectRoot();
      typeNote('<p>teks</p>');
      const url = screen.getByLabelText('Link or image URL');
      fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      expect(screen.getByRole('alert').textContent).toMatch(/not allowed/i);
      expect(editor().innerHTML).toBe('<p>teks</p>');

      fireEvent.change(url, { target: { value: 'https://example.com/a?b=1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
      expect(editor().querySelector('a')?.getAttribute('href')).toBe('https://example.com/a?b=1');

      fireEvent.change(url, { target: { value: 'http://example.com/p.png' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert image from URL' }));
      expect(editor().querySelector('img')).toBeNull();
      fireEvent.change(url, { target: { value: 'https://example.com/p.png' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert image from URL' }));
      // Remote images are never loaded: the URL is kept as a plain link.
      expect(editor().querySelector('img')).toBeNull();
      expect(editor().querySelector('a[href="https://example.com/p.png"]')).not.toBeNull();
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
