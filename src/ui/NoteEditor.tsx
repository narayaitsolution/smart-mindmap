import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '../i18n';
import { cleanNote, isSafeNoteUrl, MAX_NOTE_IMAGE_BYTES, renderNote } from '../model/note';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface Props {
  note: string | undefined;
  nodeUrl: string | undefined;
  t: T;
  /** Return false when the change was refused (image budget). */
  onChange(note: string | undefined): boolean | void;
  onUrlChange(url: string | undefined): void;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const COMMANDS: { cmd: string; label: MessageKey; face: string }[] = [
  { cmd: 'bold', label: 'note.bold', face: 'B' },
  { cmd: 'italic', label: 'note.italic', face: 'I' },
  { cmd: 'underline', label: 'note.underline', face: 'U' },
  { cmd: 'strikeThrough', label: 'note.strike', face: 'S' },
  { cmd: 'insertUnorderedList', label: 'note.bullets', face: '•' },
  { cmd: 'insertOrderedList', label: 'note.numbers', face: '1.' },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(file);
  });
}

/** Simple contenteditable note editor. Everything it emits has been through cleanNote. */
export function NoteEditor({ note, nodeUrl, t, onChange, onUrlChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(nodeUrl ?? '');

  useEffect(() => setUrl(nodeUrl ?? ''), [nodeUrl]);

  // Reload the editor only for changes that did not come from typing in it.
  useEffect(() => {
    const el = ref.current;
    if (!el || (el.dataset.ready === 'true' && note === emitted.current)) return;
    el.innerHTML = note ? renderNote(note) : '';
    el.dataset.ready = 'true';
    emitted.current = note;
  }, [note]);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const cleaned = cleanNote(el.innerHTML);
    if (cleaned.tooLarge) {
      setError(t('note.tooLarge'));
      return;
    }
    if (onChange(cleaned.html) === false) {
      setError(t('note.imagesTooLarge'));
      el.innerHTML = note ? renderNote(note) : '';
      emitted.current = note;
      return;
    }
    setError(null);
    emitted.current = cleaned.html;
  };

  const insert = (html: string) => {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (range && el.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      const frag = range.createContextualFragment(html);
      const last = frag.lastChild;
      range.insertNode(frag);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } else {
      el.insertAdjacentHTML('beforeend', html);
    }
    sync();
  };

  const run = (cmd: string) => {
    ref.current?.focus();
    if (typeof document.execCommand === 'function') document.execCommand(cmd);
    sync();
  };

  const addLink = () => {
    const href = url.trim();
    if (href && !isSafeNoteUrl(href, 'link')) return setError(t('note.badUrl'));
    onUrlChange(href || undefined);
    setError(null);
    setUrl(href);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setError(t('note.badImageType'));
    if (file.size > MAX_NOTE_IMAGE_BYTES) return setError(t('note.imageTooLarge'));
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!isSafeNoteUrl(dataUrl, 'image')) return setError(t('note.badImageType'));
      insert(`<img src="${esc(dataUrl)}" alt="${esc(file.name.replace(/\.[^.]+$/, '').slice(0, 100))}">`);
    } catch {
      setError(t('note.badImageType'));
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const safe = html ? (cleanNote(html).html ?? '') : esc(text).replace(/\n/g, '<br>');
    if (safe) insert(safe);
  };

  return (
    <div className="field note-field">
      <span id="note-label" className="field-label">
        {t('note.label')}
      </span>
      <div className="note-toolbar row" role="group" aria-label={t('note.toolbar')}>
        {COMMANDS.map((c) => (
          <button key={c.cmd} type="button" aria-label={t(c.label)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c.cmd)}>
            {c.face}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="note-editor"
        role="textbox"
        aria-multiline="true"
        aria-labelledby="note-label"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={sync}
        onPaste={onPaste}
        onDrop={(e) => e.preventDefault()}
        onBlur={() => {
          const el = ref.current;
          if (!el) return;
          const cleaned = cleanNote(el.innerHTML);
          if (!cleaned.tooLarge) el.innerHTML = cleaned.html ? renderNote(cleaned.html) : '';
        }}
      />
      <label htmlFor="note-url">{t('note.url')}</label>
      <div className="row note-actions">
        <input id="note-url" type="text" inputMode="url" maxLength={2048} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} placeholder="https://" />
        <button type="button" onClick={addLink}>
          {t('note.insertLink')}
        </button>
      </div>
      <label htmlFor="note-upload">{t('note.upload')}</label>
      <input
        id="note-upload"
        type="file"
        accept={IMAGE_TYPES.join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void upload(file);
        }}
      />
      {error && (
        <p role="alert" className="note-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="danger note-clear"
        disabled={!note}
        onClick={() => {
          if (ref.current) ref.current.innerHTML = '';
          setError(null);
          emitted.current = undefined;
          onChange(undefined);
        }}
      >
        {t('note.clear')}
      </button>
    </div>
  );
}
