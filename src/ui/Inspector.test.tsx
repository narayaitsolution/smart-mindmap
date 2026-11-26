import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Inspector } from './Inspector';
import type { MindNode } from '../model/mindmap';
import { readFileSync } from 'node:fs';

const styles = readFileSync('src/styles.css', 'utf8');

const node: MindNode = { id: 'a', parentId: 'root', text: 'Node', x: 0, y: 0, note: '<p>Existing</p>' };
const t = (key: string) => key;
const setup = (selected = node) => {
  const onPatch = vi.fn();
  const result = render(<Inspector node={selected} t={t} onPatch={onPatch} onClose={() => {}} onAddSibling={() => {}} onResize={() => {}} />);
  return { onPatch, ...result };
};

it('assigns and clears a node URL without inserting it into the note', () => {
  const { onPatch } = setup();
  fireEvent.change(screen.getByLabelText('note.url'), { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByText('note.insertLink'));
  expect(onPatch).toHaveBeenCalledWith({ url: 'https://example.com' });
  expect(screen.getByRole('textbox', { name: 'note.label' }).innerHTML).not.toContain('example.com');
  expect(screen.queryByText('note.insertImageUrl')).toBeNull();
  fireEvent.change(screen.getByLabelText('note.url'), { target: { value: '' } });
  fireEvent.click(screen.getByText('note.insertLink'));
  expect(onPatch).toHaveBeenCalledWith({ url: undefined });
  fireEvent.change(screen.getByLabelText('note.url'), { target: { value: 'javascript:alert(1)' } });
  fireEvent.click(screen.getByText('note.insertLink'));
  expect(screen.getByRole('alert').textContent).toBe('note.badUrl');
});

it('shows node URL across rerenders and switching nodes', () => {
  const first = { ...node, url: 'https://example.com' };
  const { rerender } = setup(first);
  const view = (selected: MindNode) => <Inspector node={selected} t={t} onPatch={() => {}} onClose={() => {}} onAddSibling={() => {}} onResize={() => {}} />;
  expect((screen.getByLabelText('note.url') as HTMLInputElement).value).toBe(first.url);
  rerender(view({ ...first, text: 'Updated' }));
  expect((screen.getByLabelText('note.url') as HTMLInputElement).value).toBe(first.url);
  rerender(view({ ...node, id: 'b', url: 'https://other.example' }));
  rerender(view(first));
  expect((screen.getByLabelText('note.url') as HTMLInputElement).value).toBe(first.url);
  rerender(view({ ...first, url: 'https://assigned.example' }));
  expect((screen.getByLabelText('note.url') as HTMLInputElement).value).toBe('https://assigned.example');
});

it('saves changed URL on Enter without changing note', () => {
  const { onPatch } = setup({ ...node, url: 'https://example.com' });
  const input = screen.getByLabelText('note.url');
  fireEvent.change(input, { target: { value: 'https://new.example' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPatch).toHaveBeenCalledWith({ url: 'https://new.example' });
  expect(screen.getByRole('textbox', { name: 'note.label' }).innerHTML).toBe('<p>Existing</p>');
});

it('clears URL on empty Enter', () => {
  const { onPatch } = setup({ ...node, url: 'https://example.com' });
  const input = screen.getByLabelText('note.url');
  fireEvent.change(input, { target: { value: '  ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPatch).toHaveBeenCalledWith({ url: undefined });
});

it('rejects invalid URL on Enter and preserves previous URL', () => {
  const { onPatch } = setup({ ...node, url: 'https://example.com' });
  const input = screen.getByLabelText('note.url');
  fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPatch).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('note.badUrl');
  expect(screen.getByRole('button', { name: 'node.openUrl' })).toBeTruthy();
});

it('lays out URL actions equally without changing the single root action', () => {
  const { rerender } = setup({ ...node, url: 'https://example.com' });
  const sibling = screen.getByRole('button', { name: 'node.addSibling' });
  const open = screen.getByRole('button', { name: 'node.openUrl' });
  expect(sibling.parentElement).toBe(open.parentElement);
  expect(sibling.parentElement?.classList.contains('node-actions')).toBe(true);
  expect(styles).toMatch(/\.node-actions\s*\{[^}]*flex-wrap:\s*nowrap/s);
  expect(styles).toMatch(/\.node-actions button\s*\{[^}]*flex:\s*1 1 0/s);
  expect(styles).toMatch(/button\.open-url\s*\{[^}]*background:\s*var\(--field\)/s);

  rerender(<Inspector node={{ ...node, parentId: null }} t={t} onPatch={() => {}} onClose={() => {}} onAddSibling={() => {}} onResize={() => {}} />);
  expect(screen.queryByRole('button', { name: 'node.openUrl' })).toBeNull();
  expect((screen.getByRole('button', { name: 'node.addSibling' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps the URL input and insert button alone in a shrinkable row', () => {
  setup();
  const input = screen.getByLabelText('note.url');
  const button = screen.getByRole('button', { name: 'note.insertLink' });
  expect(input.parentElement).toBe(button.parentElement);
  expect(Array.from(input.parentElement!.children)).toEqual([input, button]);
  expect(styles).toMatch(/\.note-actions input\s*\{[^}]*min-width:\s*0/s);
  expect(styles).toMatch(/\.note-actions button\s*\{[^}]*flex:\s*0 0 auto/s);
});

it('keeps clear full width and compact and shows five editor lines', () => {
  setup();
  expect(screen.getByRole('textbox', { name: 'note.label' }).getAttribute('contenteditable')).toBe('true');
  expect(styles).toMatch(/button\.note-clear\s*\{[^}]*width:\s*100%[^}]*padding:\s*4px 6px/s);
  expect(styles).toMatch(/\.note-editor\s*\{[^}]*min-height:\s*calc\(5 \* 1\.5em \+ 18px\)[^}]*line-height:\s*1\.5/s);
});

it('opens only a safe selected node URL', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { rerender } = setup();
  expect(screen.queryByText('node.openUrl')).toBeNull();
  rerender(<Inspector node={{ ...node, url: 'javascript:alert(1)' } as MindNode} t={t} onPatch={() => {}} onClose={() => {}} onAddSibling={() => {}} onResize={() => {}} />);
  expect(screen.queryByText('node.openUrl')).toBeNull();
  rerender(<Inspector node={{ ...node, url: 'https://example.com' } as MindNode} t={t} onPatch={() => {}} onClose={() => {}} onAddSibling={() => {}} onResize={() => {}} />);
  fireEvent.click(screen.getByText('node.openUrl'));
  expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  open.mockRestore();
});
