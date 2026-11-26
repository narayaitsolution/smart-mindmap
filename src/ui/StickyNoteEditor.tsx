import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '../i18n';

interface Props {
  text: string;
  t: (key: MessageKey) => string;
  onSave(text: string): void;
  onAutoSave(text: string): void;
  onClose(): void;
  onDelete(): void;
}

export function StickyNoteEditor({ text, t, onSave, onAutoSave, onClose, onDelete }: Props) {
  const [draft, setDraft] = useState(text);
  const first = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    first.current?.focus();
    const timer = window.setInterval(() => onAutoSave(draftRef.current), 2000);
    return () => window.clearInterval(timer);
  }, [onAutoSave]);

  return (
    <div className="modal-backdrop">
      <div className="modal sticky-note-modal" role="dialog" aria-modal="true" aria-labelledby="sticky-note-title" onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}>
        <div className="modal-head">
          <h2 id="sticky-note-title">{t('sticky.title')}</h2>
          <button type="button" className="icon" aria-label={t('sticky.close')} onClick={() => onSave(draft)}>×</button>
        </div>
        <label htmlFor="sticky-note-text">{t('sticky.label')}</label>
        <textarea ref={first} id="sticky-note-text" className="sticky-note-text" value={draft} maxLength={10000} onChange={(e) => setDraft(e.target.value)} />
        <div className="modal-actions sticky-note-actions">
          <button type="button" className="primary" onClick={() => onSave(draft)}>{t('sticky.save')}</button>
          <button type="button" className="danger" onClick={onDelete}>{t('sticky.delete')}</button>
        </div>
      </div>
    </div>
  );
}
