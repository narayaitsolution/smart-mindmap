/** Node notes are untrusted HTML. Everything that stores, imports or renders one goes through this module. */

export const MAX_NOTE_BYTES = 100 * 1024;
/** Limit on the decoded size of one data image. */
export const MAX_NOTE_IMAGE_BYTES = 1024 * 1024;
const MAX_DATA_URL_CHARS = 4 * Math.ceil(MAX_NOTE_IMAGE_BYTES / 3) + 64;
export const MAX_NOTE_DATA_IMAGES = 5;

const ALLOWED = new Set(['p', 'br', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'blockquote', 'code']);
const ALIASES: Record<string, string> = { strong: 'b', em: 'i', strike: 's', del: 's' };
/** Dropped together with their content. Any other unknown element is unwrapped. */
const DROPPED = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math', 'template', 'noscript',
  'textarea', 'select', 'option', 'title', 'head', 'audio', 'video', 'canvas', 'link', 'meta', 'base', 'form', 'input', 'button',
]);
const MAX_DEPTH = 24;
const MAX_MARKUP_TAGS = 5000;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/;
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export type NoteMode = 'store' | 'render' | 'xhtml';

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');
const byteLength = (s: string) => new TextEncoder().encode(s).length;

function dataImageBytes(url: string): number {
  const payload = url.slice(url.indexOf(',') + 1);
  const pad = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - pad;
}

export function isSafeNoteUrl(raw: string, kind: 'link' | 'image'): boolean {
  return safeUrl(raw, kind) !== null;
}

function safeUrl(raw: string, kind: 'link' | 'image'): string | null {
  const value = raw.trim();
  if (!value || CONTROL.test(value)) return null;
  if (kind === 'image' && value.toLowerCase().startsWith('data:')) {
    return value.length <= MAX_DATA_URL_CHARS && DATA_IMAGE.test(value) && dataImageBytes(value) <= MAX_NOTE_IMAGE_BYTES ? value : null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (kind === 'link') return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : null;
  if (url.protocol !== 'https:' || /\.svg$/i.test(url.pathname)) return null;
  return value;
}

interface Walk {
  out: string;
  hasContent: boolean;
  /** Characters of accepted data images, excluded from the markup budget. */
  dataChars: number;
  dataImages: number;
}

function walk(node: Node, mode: NoteMode, w: Walk, depth = 0, inLink = false): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      const text = child.nodeValue ?? '';
      if (/\S/.test(text)) w.hasContent = true;
      w.out += escText(text.replace(INVALID_XML_CHARS, ''));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const raw = el.localName.toLowerCase();
    if (DROPPED.has(raw)) continue;
    const tag = ALIASES[raw] ?? raw;
    if (!ALLOWED.has(tag)) {
      walk(el, mode, w, depth, inLink);
      continue;
    }
    if (depth >= MAX_DEPTH) {
      walk(el, mode, w, depth, inLink);
      continue;
    }
    if (tag === 'img') {
      const src = safeUrl(el.getAttribute('src') ?? '', 'image');
      if (!src) continue;
      const isData = src.startsWith('data:');
      if (!isData) {
        // Remote images would let any note author track readers (IP, time, referrer). Keep a plain link instead.
        const label = (el.getAttribute('alt') ?? '').replace(INVALID_XML_CHARS, '').trim() || 'image';
        const extra = mode === 'render' ? ' target="_blank" rel="noopener noreferrer"' : '';
        w.out += inLink ? escText(label) : `<a href="${escAttr(src)}"${extra}>${escText(label)}</a>`;
        w.hasContent = true;
        continue;
      }
      if (w.dataImages >= MAX_NOTE_DATA_IMAGES) continue;
      w.dataImages += 1;
      w.dataChars += src.length;
      const alt = el.getAttribute('alt');
      const extra = mode === 'render' ? ' loading="lazy" referrerpolicy="no-referrer"' : '';
      w.out += `<img src="${escAttr(src)}"${alt ? ` alt="${escAttr(alt.replace(INVALID_XML_CHARS, ''))}"` : ''}${extra}${mode === 'xhtml' ? '/>' : '>'}`;
      w.hasContent = true;
      continue;
    }
    if (tag === 'br') {
      w.out += mode === 'xhtml' ? '<br/>' : '<br>';
      continue;
    }
    if (tag === 'a') {
      const href = safeUrl(el.getAttribute('href') ?? '', 'link');
      if (!href) {
        walk(el, mode, w, depth, inLink);
        continue;
      }
      const extra = mode === 'render' ? ' target="_blank" rel="noopener noreferrer"' : '';
      w.out += `<a href="${escAttr(href)}"${extra}>`;
      walk(el, mode, w, depth + 1, true);
      w.out += '</a>';
      continue;
    }
    w.out += `<${tag}>`;
    walk(el, mode, w, depth + 1, inLink);
    w.out += `</${tag}>`;
  }
}

export interface CleanNote {
  html: string | undefined;
  tooLarge: boolean;
}

/** Sanitize an already-parsed HTML or XML subtree (children of `root` are the note). */
export function cleanNoteTree(root: Node, mode: NoteMode = 'store'): CleanNote {
  const w: Walk = { out: '', hasContent: false, dataChars: 0, dataImages: 0 };
  walk(root, mode, w);
  if (!w.hasContent) return { html: undefined, tooLarge: false };
  if (byteLength(w.out) - w.dataChars > MAX_NOTE_BYTES) return { html: undefined, tooLarge: true };
  return { html: w.out, tooLarge: false };
}

const MAX_RAW_CHARS = MAX_NOTE_BYTES + MAX_NOTE_DATA_IMAGES * (MAX_DATA_URL_CHARS + 1024);

export function cleanNote(input: string, mode: NoteMode = 'store'): CleanNote {
  if (input.length > MAX_RAW_CHARS) return { html: undefined, tooLarge: true };
  // The document is inert: scripts never run and images never load while parsing.
  if (input.split('<').length > MAX_MARKUP_TAGS) return { html: undefined, tooLarge: true };
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${input.replace(INVALID_XML_CHARS, '')}`, 'text/html');
  return cleanNoteTree(doc.body, mode);
}

/** Returns clean HTML, or undefined when the note is empty, invalid or over the size limit. */
export function sanitizeNote(input: unknown): string | undefined {
  return typeof input === 'string' ? cleanNote(input).html : undefined;
}

const DATA_IMAGE_TAG = /<img src="(data:image\/[a-z]+;base64,[A-Za-z0-9+/]*={0,2})"/g;

/** Decoded bytes of the data images in an already sanitized note. */
export function noteImageBytes(note: string): number {
  if (!note.includes('data:image/')) return 0;
  let total = 0;
  for (const m of note.matchAll(DATA_IMAGE_TAG)) total += dataImageBytes(m[1]);
  return total;
}

const PLAIN_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li']);

/** Readable plain text of a note, one line per block. Links keep their URL, images become a marker. */
export function noteToPlainText(input: string): string {
  const clean = cleanNote(input).html;
  if (!clean) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${clean}`, 'text/html');
  const lines: string[] = [];
  let cur = '';
  const flush = () => {
    const line = cur.replace(/\s+/g, ' ').trim();
    if (line && line !== '•') lines.push(line);
    cur = '';
  };
  const visit = (node: Node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        cur += c.nodeValue ?? '';
        continue;
      }
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      const tag = el.localName;
      if (tag === 'br') flush();
      else if (tag === 'img') cur += ' [image] ';
      else if (tag === 'a') {
        const start = cur.length;
        visit(el);
        const href = el.getAttribute('href') ?? '';
        if (href && cur.slice(start).trim() !== href) cur += ` (${href}) `;
      } else if (PLAIN_BLOCKS.has(tag)) {
        flush();
        if (tag === 'li') cur = '• ';
        visit(el);
        flush();
      } else visit(el);
    }
  };
  visit(doc.body);
  flush();
  return lines.join('\n');
}

/** Safe markup for display: links open in a new tab without referrer, images send no referrer. */
export function renderNote(input: string): string {
  return cleanNote(input, 'render').html ?? '';
}

export function noteToXhtml(input: string): string {
  return cleanNote(input, 'xhtml').html ?? '';
}

export function notePreview(input: string, max = 120): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${renderNote(input).replace(/<\/(p|li|h[1-3]|blockquote)>|<br>/g, ' ')}`, 'text/html');
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}
