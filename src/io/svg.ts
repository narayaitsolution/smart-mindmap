import { isHexColor } from '../model/color';
import {
  childrenOf,
  DEFAULT_EDGE_COLOR,
  DEFAULT_EDGE_WIDTH,
  edgePath,
  fitText,
  LINE_HEIGHT,
  nodeLines,
  hiddenChildCount,
  mapBounds,
  nodeSize,
  visibleNodes,
  type Mindmap,
} from '../model/mindmap';
import { readableTextColor } from '../model/color';
import { noteToPlainText } from '../model/note';

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const PADDING = 32;
const MIN_WIDTH = 480;
const NOTE_LINE_HEIGHT = 18;
const NOTE_CHAR_WIDTH = 7;
const MAX_NOTE_LINES = 200;
const NOTE_GAP = 24;

function wrapLine(line: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(' ')) {
    let w = word;
    while (w.length > max) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface NoteLine {
  text: string;
  head: boolean;
}

/** Notes of the nodes that are visible in the export, as wrapped plain-text lines. Capped so huge notes cannot blow up the image. */
function noteLines(nodes: ReturnType<typeof visibleNodes>, max: number): NoteLine[] {
  const lines: NoteLine[] = [];
  let truncated = false;
  for (const n of nodes) {
    if (!n.note || truncated) continue;
    const body = noteToPlainText(n.note);
    if (!body) continue;
    const block: NoteLine[] = [{ text: fitText(n.text) || '-', head: true }];
    for (const l of body.split('\n')) for (const w of wrapLine(l, max)) block.push({ text: w, head: false });
    for (const l of block) {
      if (lines.length >= MAX_NOTE_LINES) {
        truncated = true;
        break;
      }
      lines.push(l);
    }
  }
  if (truncated) lines.push({ text: '…', head: false });
  return lines;
}
export const EXPORT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function renderMapSvg(map: Mindmap, opts: { background: string | null }): { svg: string; width: number; height: number } {
  const b = mapBounds(map);
  const nodes = visibleNodes(map);
  const width = Math.max(MIN_WIDTH, Math.ceil(b.maxX - b.minX + PADDING * 2));
  const mapHeight = Math.ceil(b.maxY - b.minY + PADDING * 2);
  const notes = noteLines(nodes, Math.floor((width - PADDING * 2) / NOTE_CHAR_WIDTH));
  const notesHeight = notes.length ? NOTE_GAP + (notes.length + 1) * NOTE_LINE_HEIGHT + PADDING : 0;
  const height = mapHeight + notesHeight;
  const ox = PADDING - b.minX;
  const oy = PADDING - b.minY;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];
  if (opts.background && isHexColor(opts.background)) parts.push(`<rect width="100%" height="100%" fill="${opts.background}"/>`);
  parts.push(`<g transform="translate(${ox} ${oy})">`);

  for (const n of nodes) {
    if (n.parentId === null) continue;
    const parent = map.nodes[n.parentId];
    const stroke = n.edgeColor ?? DEFAULT_EDGE_COLOR;
    parts.push(
      `<path d="${edgePath(parent, n)}" fill="none" stroke="${stroke}" stroke-width="${n.edgeWidth ?? DEFAULT_EDGE_WIDTH}" stroke-linecap="round"/>`,
    );
  }
  for (const n of nodes) {
    const { width: w, height: h } = nodeSize(n);
    const fill = n.color ?? 'none';
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="#595959" stroke-width="1"/>`);
    const lines = nodeLines(n);
    lines.forEach((line, i) => {
      const y = n.y + h / 2 + (i - (lines.length - 1) / 2) * LINE_HEIGHT;
      parts.push(
        `<text x="${n.x + w / 2}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family='${EXPORT_FONT}' font-size="14" fill="${readableTextColor(n.color ?? '#ffffff')}">${escapeXml(line)}</text>`,
      );
    });
    if (n.collapsed && childrenOf(map, n.id).length) {
      const cx = n.x + w + 10;
      const cy = n.y + h / 2;
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="9" fill="#ffffff" stroke="#595959"/><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family='${EXPORT_FONT}' font-size="10" fill="#000000">${hiddenChildCount(map, n.id)}</text>`,
      );
    }
  }
  parts.push('</g>');
  if (notes.length) {
    const font = `font-family='${EXPORT_FONT}' font-size="12" fill="#000000"`;
    let y = mapHeight + NOTE_GAP;
    parts.push(`<line x1="${PADDING}" y1="${y - 12}" x2="${width - PADDING}" y2="${y - 12}" stroke="#595959"/>`);
    parts.push(`<text x="${PADDING}" y="${y}" ${font} font-weight="bold" data-note="title">Notes</text>`);
    for (const l of notes) {
      y += NOTE_LINE_HEIGHT;
      parts.push(`<text x="${l.head ? PADDING : PADDING + 12}" y="${y}" ${font}${l.head ? ' font-weight="bold"' : ''} data-note="line">${escapeXml(l.text)}</text>`);
    }
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}
