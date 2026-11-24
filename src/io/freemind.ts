import { isHexColor } from '../model/color';
import { childrenOf, createMindmap, layoutTree, MAX_EDGE_WIDTH, newId, type MindNode, type Mindmap } from '../model/mindmap';
import { cleanNoteTree, noteToXhtml } from '../model/note';
import { assertImportImages, assertImportSize, ImportError } from './json';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');

export function exportFreeMind(map: Mindmap): string {
  const lines: string[] = ['<map version="1.0.1">'];
  const walk = (node: MindNode, depth: number) => {
    const pad = '  '.repeat(depth);
    const attrs = [`ID="${esc(node.id)}"`, `TEXT="${esc(node.text)}"`];
    if (node.color) attrs.push(`BACKGROUND_COLOR="${node.color}"`);
    if (node.collapsed) attrs.push('FOLDED="true"');
    const kids = childrenOf(map, node.id);
    const note = node.note ? noteToXhtml(node.note) : '';
    const richNote = note ? `<richcontent TYPE="NOTE"><html><head></head><body>${note}</body></html></richcontent>` : '';
    const edge =
      node.edgeColor || node.edgeWidth
        ? `<edge${node.edgeColor ? ` COLOR="${node.edgeColor}"` : ''}${node.edgeWidth ? ` WIDTH="${node.edgeWidth}"` : ''}/>`
        : '';
    if (!kids.length && !edge && !richNote) {
      lines.push(`${pad}<node ${attrs.join(' ')}/>`);
      return;
    }
    lines.push(`${pad}<node ${attrs.join(' ')}>`);
    if (edge) lines.push(`${pad}  ${edge}`);
    if (richNote) lines.push(`${pad}  ${richNote}`);
    for (const k of kids) walk(k, depth + 1);
    lines.push(`${pad}</node>`);
  };
  walk(map.nodes[map.rootId], 1);
  lines.push('</map>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${lines.join('\n')}\n`;
}

const directChildren = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.tagName === tag);

function nodeText(el: Element): string {
  const attr = el.getAttribute('TEXT');
  if (attr !== null) return attr;
  const rich = directChildren(el, 'richcontent').find((c) => c.getAttribute('TYPE') !== 'NOTE');
  return rich?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function parseWidth(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (raw === 'thin') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_EDGE_WIDTH, n) : undefined;
}

function readNote(el: Element): string | undefined {
  const rich = directChildren(el, 'richcontent').find((c) => c.getAttribute('TYPE') === 'NOTE');
  const body = rich && Array.from(rich.getElementsByTagName('*')).find((c) => c.localName === 'body');
  // Oversized notes are dropped; the rest of the map still imports.
  return body ? cleanNoteTree(body).html : undefined;
}

const MAX_XML_DEPTH = 256;
const MAX_XML_ELEMENTS = 100_000;
const TAG = /<(\/)?[^\s/>!?][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*>/y;

/** Linear pre-scan that bounds element depth and count before the DOM parser can allocate anything. */
function assertXmlShape(xml: string): void {
  let depth = 0;
  let elements = 0;
  let i = xml.indexOf('<');
  while (i !== -1) {
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      i = end === -1 ? -1 : xml.indexOf('<', end + 3);
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      i = end === -1 ? -1 : xml.indexOf('<', end + 3);
      continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(xml);
    if (m) {
      if (m[1]) depth -= 1;
      else {
        if (++elements > MAX_XML_ELEMENTS) throw new ImportError('Too many elements');
        if (!m[0].endsWith('/>')) {
          depth += 1;
          if (depth > MAX_XML_DEPTH) throw new ImportError('File is nested too deep');
        }
      }
      i = xml.indexOf('<', i + m[0].length);
    } else i = xml.indexOf('<', i + 1);
  }
}

export function importFreeMind(xml: string): Mindmap {
  assertImportSize(xml.length);
  assertXmlShape(xml);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    throw new ImportError('Not valid XML');
  }
  if (doc.querySelector('parsererror')) throw new ImportError('Not valid XML');
  const root = doc.documentElement;
  if (root.tagName !== 'map') throw new ImportError('Not a FreeMind file');
  const rootEl = directChildren(root, 'node')[0];
  if (!rootEl) throw new ImportError('FreeMind file has no root node');

  const title = nodeText(rootEl).slice(0, 200) || 'Mindmap';
  const map = createMindmap({ id: newId(), title, rootText: title, at: { x: 0, y: 0 } });
  const nodes: Record<string, MindNode> = { ...map.nodes };
  let count = 0;

  const read = (el: Element, id: string, parentId: string | null) => {
    if (++count > 20000) throw new ImportError('Too many nodes');
    const node: MindNode = { id, parentId, text: nodeText(el).slice(0, 2000), x: 0, y: 0 };
    const bg = el.getAttribute('BACKGROUND_COLOR');
    if (isHexColor(bg)) node.color = bg;
    if (el.getAttribute('FOLDED') === 'true') node.collapsed = true;
    const note = readNote(el);
    if (note !== undefined) node.note = note;
    const edge = directChildren(el, 'edge')[0];
    if (edge && parentId !== null) {
      const c = edge.getAttribute('COLOR');
      if (isHexColor(c)) node.edgeColor = c;
      const w = parseWidth(edge.getAttribute('WIDTH'));
      if (w !== undefined) node.edgeWidth = w;
    }
    nodes[id] = node;
    for (const child of directChildren(el, 'node')) read(child, newId(), id);
  };
  read(rootEl, map.rootId, null);

  const folded = Object.values(nodes).filter((n) => n.collapsed);
  // Lay out fully expanded so hidden subtrees get real positions, then restore folds.
  const expanded: Record<string, MindNode> = {};
  for (const [k, n] of Object.entries(nodes)) {
    const { collapsed: _folded, ...rest } = n;
    expanded[k] = rest;
  }
  const laid = layoutTree({ ...map, nodes: expanded });
  for (const n of folded) laid.nodes[n.id] = { ...laid.nodes[n.id], collapsed: true };
  return assertImportImages(laid);
}
